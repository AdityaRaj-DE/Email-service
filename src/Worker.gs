/**
 * Worker.gs - Scheduled queue processor and safe email delivery engine.
 * Implements bounded batching, exponential backoff with jitter, stale processing recovery,
 * daily quota checking, and strict kill-switch verification.
 */

var Worker = (function() {
  /**
   * Exponential backoff calculation in seconds.
   * delay = min(MAX_DELAY, INITIAL_DELAY * 2^(attempts-1)) + jitter
   */
  function calculateNextAttemptDelaySec(attemptNumber) {
    var initial = Config.DEFAULTS.INITIAL_RETRY_DELAY_SEC;
    var maxDelay = Config.DEFAULTS.MAX_RETRY_DELAY_SEC;
    var exp = Math.min(attemptNumber - 1, 8);
    var baseDelay = initial * Math.pow(2, exp);
    // Add 10-25% jitter
    var jitter = Math.floor(baseDelay * (0.1 + Math.random() * 0.15));
    var totalDelay = Math.min(baseDelay + jitter, maxDelay);
    return totalDelay;
  }

  /**
   * Classifies an error into transient (retryable) or permanent (dead letter).
   */
  function classifyError(err) {
    var msg = (err && err.message ? err.message : String(err)).toLowerCase();

    // Quota exhaustion
    if (msg.indexOf('quota') !== -1 || msg.indexOf('limit exceeded') !== -1) {
      return { retryable: true, code: 'QUOTA_EXHAUSTED', deferLonger: true };
    }

    // Temporary Apps Script / Google backend network errors
    if (msg.indexOf('service invoked too many times') !== -1 ||
        msg.indexOf('internal error') !== -1 ||
        msg.indexOf('timed out') !== -1 ||
        msg.indexOf('temporary error') !== -1) {
      return { retryable: true, code: 'TRANSIENT_SERVICE_ERROR', deferLonger: false };
    }

    // Permanent errors (invalid address, syntax, template rejection)
    if (msg.indexOf('invalid email') !== -1 ||
        msg.indexOf('unsupported template') !== -1 ||
        msg.indexOf('recipient missing') !== -1) {
      return { retryable: false, code: 'PERMANENT_PAYLOAD_ERROR' };
    }

    // Default to transient for initial attempts, with backoff
    return { retryable: true, code: 'GENERAL_DELIVERY_ERROR', deferLonger: false };
  }

  /**
   * Main worker execution function.
   * Processes a bounded batch of jobs.
   */
  function processQueue() {
    var startTime = new Date().getTime();
    var maxExecutionMs = 240000; // 4 minutes max (safe margin within Apps Script 6m limit)

    // 1. Check Global Sending Kill Switch
    if (!Config.isSendingEnabled()) {
      Queue.logEvent('WORKER_EXECUTION_SKIPPED', '', '', 'SKIPPED', 'SENDING_DISABLED', 'Global sending switch is disabled.');
      return { status: 'SKIPPED', reason: 'SENDING_DISABLED' };
    }

    // 2. Check Daily MailApp Quota
    var remainingQuota = 0;
    try {
      remainingQuota = MailApp.getRemainingDailyQuota();
    } catch (e) {
      remainingQuota = 0;
    }

    if (remainingQuota <= 0) {
      Queue.logEvent('WORKER_EXECUTION_HALTED', '', '', 'HALTED', 'QUOTA_EXHAUSTED', 'Daily email quota is exhausted (0 remaining).');
      return { status: 'HALTED', reason: 'QUOTA_EXHAUSTED', remainingQuota: 0 };
    }

    var destinationEmail = Config.getDestinationEmail();
    if (!destinationEmail || destinationEmail.trim() === '') {
      Queue.logEvent('WORKER_CONFIG_ERROR', '', '', 'ERROR', 'NO_DESTINATION_EMAIL', 'DESTINATION_EMAIL is not configured in Script Properties.');
      return { status: 'ERROR', reason: 'NO_DESTINATION_EMAIL' };
    }

    // 3. Acquire Short Lock to select and claim batch
    var lock = LockService.getScriptLock();
    var hasLock = lock.tryLock(Config.getLockTimeoutMs());
    if (!hasLock) {
      return { status: 'LOCK_BUSY', reason: 'Another worker instance is currently claiming jobs.' };
    }

    var claimedJobs = [];
    var ss = Queue.getSpreadsheet();
    var queueSheet = ss.getSheetByName(Queue.QUEUE_SHEET_NAME);
    if (!queueSheet) {
      lock.releaseLock();
      return { status: 'NO_QUEUE', count: 0 };
    }

    try {
      var batchLimit = Config.getBatchSize();
      var maxAttempts = Config.getMaxAttempts();
      var now = new Date();
      var nowIso = now.toISOString();
      var nowTime = now.getTime();

      var stats = Queue.inspectQueueWindow(queueSheet);
      var rows = stats.rows;

      // Identify eligible jobs and recover stale PROCESSING jobs (stale > 15 minutes)
      var STALE_THRESHOLD_MS = 15 * 60 * 1000;

      for (var i = 0; i < rows.length; i++) {
        if (claimedJobs.length >= batchLimit) break;

        var job = rows[i];
        var status = String(job.status);
        var attempts = parseInt(job.attempts, 10) || 0;
        var updatedAtMs = job.updated_at ? new Date(job.updated_at).getTime() : 0;
        var nextAttemptMs = job.next_attempt_at ? new Date(job.next_attempt_at).getTime() : 0;

        var isStale = (status === Queue.STATUS.PROCESSING && (nowTime - updatedAtMs) > STALE_THRESHOLD_MS);
        var isEligiblePending = (status === Queue.STATUS.PENDING);
        var isEligibleRetry = (status === Queue.STATUS.RETRY_WAIT && nowTime >= nextAttemptMs);

        if (isEligiblePending || isEligibleRetry || isStale) {
          if (attempts >= maxAttempts) {
            // Mark DEAD_LETTER if max attempts exceeded
            queueSheet.getRange(job._rowIndex, Queue.QUEUE_COLUMNS.indexOf('status') + 1).setValue(Queue.STATUS.DEAD_LETTER);
            queueSheet.getRange(job._rowIndex, Queue.QUEUE_COLUMNS.indexOf('updated_at') + 1).setValue(nowIso);
            queueSheet.getRange(job._rowIndex, Queue.QUEUE_COLUMNS.indexOf('last_error_code') + 1).setValue('MAX_ATTEMPTS_EXCEEDED');
            continue;
          }

          // Claim job by updating status to PROCESSING
          job.status = Queue.STATUS.PROCESSING;
          job.attempts = attempts + 1;
          job.updated_at = nowIso;

          queueSheet.getRange(job._rowIndex, Queue.QUEUE_COLUMNS.indexOf('status') + 1).setValue(Queue.STATUS.PROCESSING);
          queueSheet.getRange(job._rowIndex, Queue.QUEUE_COLUMNS.indexOf('attempts') + 1).setValue(job.attempts);
          queueSheet.getRange(job._rowIndex, Queue.QUEUE_COLUMNS.indexOf('updated_at') + 1).setValue(nowIso);

          claimedJobs.push(job);
        }
      }
    } finally {
      // Release lock immediately after claiming batch so other workers/API calls aren't blocked
      lock.releaseLock();
    }

    if (claimedJobs.length === 0) {
      return { status: 'IDLE', processed: 0 };
    }

    // 4. Deliver claimed jobs outside the lock
    var processedCount = 0;
    var successCount = 0;
    var failureCount = 0;

    for (var j = 0; j < claimedJobs.length; j++) {
      // Check runtime limit safety
      if (new Date().getTime() - startTime > maxExecutionMs) {
        break;
      }

      var currentJob = claimedJobs[j];

      // Re-verify global and per-project kill switch immediately before sending each message
      if (!Config.isSendingEnabled()) {
        Queue.logEvent('JOB_SEND_ABORTED', currentJob.project_id, currentJob.job_id, 'ABORTED', 'SENDING_DISABLED', 'Sending disabled during batch execution.');
        break;
      }

      var proj = ProjectRegistry.getProject(currentJob.project_id);
      if (proj && !proj.enabled) {
        // Project disabled - return to RETRY_WAIT or DEAD_LETTER
        updateJobStatus(queueSheet, currentJob._rowIndex, Queue.STATUS.RETRY_WAIT, 'PROJECT_DISABLED_DURING_DELIVERY', null);
        continue;
      }

      try {
        // Render template safely
        var rendered = Templates.render(currentJob);

        // MailApp delivery to fixed server-side destination email
        var mailOptions = {
          to: destinationEmail,
          subject: rendered.subject,
          body: rendered.textBody,
          htmlBody: rendered.htmlBody
        };
        if (rendered.replyTo) {
          mailOptions.replyTo = rendered.replyTo;
        }

        MailApp.sendEmail(mailOptions);

        // Delivery succeeded: update status to SENT
        var sentTimeIso = new Date().toISOString();
        updateJobStatus(queueSheet, currentJob._rowIndex, Queue.STATUS.SENT, '', sentTimeIso);
        successCount++;

        Queue.logEvent('EMAIL_DELIVERED', currentJob.project_id, currentJob.job_id, 'SUCCESS', '', {
          attempts: currentJob.attempts,
          to: destinationEmail
        });

      } catch (sendErr) {
        failureCount++;
        var classification = classifyError(sendErr);

        if (!classification.retryable || currentJob.attempts >= Config.getMaxAttempts()) {
          // Permanent failure or exhausted
          updateJobStatus(queueSheet, currentJob._rowIndex, Queue.STATUS.DEAD_LETTER, classification.code, null);
          Queue.logEvent('EMAIL_DELIVERY_FAILED_PERMANENT', currentJob.project_id, currentJob.job_id, 'DEAD_LETTER', classification.code, {
            error: sendErr.message,
            attempts: currentJob.attempts
          });
        } else {
          // Transient failure: schedule next retry with exponential backoff & jitter
          var delaySec = calculateNextAttemptDelaySec(currentJob.attempts);
          if (classification.deferLonger) {
            delaySec = Math.max(delaySec, 3600); // defer at least 1h if quota hit
          }
          var nextAttemptDate = new Date(new Date().getTime() + delaySec * 1000).toISOString();
          
          updateJobStatus(queueSheet, currentJob._rowIndex, Queue.STATUS.RETRY_WAIT, classification.code, null, nextAttemptDate);
          Queue.logEvent('EMAIL_DELIVERY_RETRY_SCHEDULED', currentJob.project_id, currentJob.job_id, 'RETRY_WAIT', classification.code, {
            error: sendErr.message,
            attempts: currentJob.attempts,
            nextAttemptAt: nextAttemptDate
          });
        }

        // If daily quota exhausted, halt batch immediately
        if (classification.code === 'QUOTA_EXHAUSTED') {
          break;
        }
      }

      processedCount++;
    }

    return {
      status: 'COMPLETED',
      claimed: claimedJobs.length,
      processed: processedCount,
      success: successCount,
      failures: failureCount
    };
  }

  /**
   * Helper to update status and attributes of a queue row.
   */
  function updateJobStatus(sheet, rowIndex, newStatus, errorCode, sentAtIso, nextAttemptIso) {
    try {
      var nowIso = new Date().toISOString();
      sheet.getRange(rowIndex, Queue.QUEUE_COLUMNS.indexOf('status') + 1).setValue(newStatus);
      sheet.getRange(rowIndex, Queue.QUEUE_COLUMNS.indexOf('updated_at') + 1).setValue(nowIso);
      if (errorCode !== undefined) {
        sheet.getRange(rowIndex, Queue.QUEUE_COLUMNS.indexOf('last_error_code') + 1).setValue(errorCode);
      }
      if (sentAtIso) {
        sheet.getRange(rowIndex, Queue.QUEUE_COLUMNS.indexOf('sent_at') + 1).setValue(sentAtIso);
      }
      if (nextAttemptIso) {
        sheet.getRange(rowIndex, Queue.QUEUE_COLUMNS.indexOf('next_attempt_at') + 1).setValue(nextAttemptIso);
      }
    } catch (e) {
      // Documented edge case: delivery can succeed while Sheet update fails
    }
  }

  return {
    calculateNextAttemptDelaySec: calculateNextAttemptDelaySec,
    classifyError: classifyError,
    processQueue: processQueue
  };
})();


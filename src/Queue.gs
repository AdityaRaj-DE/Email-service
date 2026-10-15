/**
 * Queue.gs - Google Sheets persistent queue and operational logging.
 * Manages atomic lock synchronization, idempotency, bounded capacity, and state transitions.
 */

var Queue = (function() {
  var QUEUE_SHEET_NAME = 'Queue';
  var LOGS_SHEET_NAME = 'SecurityLogs';

  // Explicit queue headers
  var QUEUE_COLUMNS = [
    'job_id',
    'project_id',
    'created_at',
    'updated_at',
    'sender_email',
    'sender_name',
    'subject',
    'message',
    'status',
    'attempts',
    'next_attempt_at',
    'sent_at',
    'last_error_code',
    'idempotency_key',
    'payload_hash',
    'type'
  ];

  var LOG_COLUMNS = [
    'timestamp',
    'event_type',
    'project_id',
    'job_id',
    'outcome',
    'error_code',
    'details'
  ];

  var STATUS = {
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    RETRY_WAIT: 'RETRY_WAIT',
    SENT: 'SENT',
    DEAD_LETTER: 'DEAD_LETTER',
    REJECTED: 'REJECTED'
  };

  /**
   * Helper to open the configured spreadsheet.
   */
  function getSpreadsheet() {
    var id = Config.getSpreadsheetId();
    if (!id || id.trim() === '') {
      throw new Error('SPREADSHEET_ID is not configured in Script Properties.');
    }
    return SpreadsheetApp.openById(id.trim());
  }

  /**
   * Initializes Queue and SecurityLogs sheets idempotently.
   */
  function initStorage() {
    var ss = getSpreadsheet();
    
    // Init Queue Sheet
    var queueSheet = ss.getSheetByName(QUEUE_SHEET_NAME);
    if (!queueSheet) {
      queueSheet = ss.insertSheet(QUEUE_SHEET_NAME);
      queueSheet.appendRow(QUEUE_COLUMNS);
      queueSheet.setFrozenRows(1);
    } else {
      // Ensure header row is intact
      if (queueSheet.getLastRow() === 0) {
        queueSheet.appendRow(QUEUE_COLUMNS);
        queueSheet.setFrozenRows(1);
      }
    }

    // Init SecurityLogs Sheet
    var logsSheet = ss.getSheetByName(LOGS_SHEET_NAME);
    if (!logsSheet) {
      logsSheet = ss.insertSheet(LOGS_SHEET_NAME);
      logsSheet.appendRow(LOG_COLUMNS);
      logsSheet.setFrozenRows(1);
    } else {
      if (logsSheet.getLastRow() === 0) {
        logsSheet.appendRow(LOG_COLUMNS);
        logsSheet.setFrozenRows(1);
      }
    }

    return { queueSheet: queueSheet, logsSheet: logsSheet };
  }

  /**
   * Logs a security or operational event safely without leaking sensitive data.
   */
  function logEvent(eventType, projectId, jobId, outcome, errorCode, details) {
    try {
      var ss = getSpreadsheet();
      var sheet = ss.getSheetByName(LOGS_SHEET_NAME);
      if (!sheet) {
        initStorage();
        sheet = ss.getSheetByName(LOGS_SHEET_NAME);
      }
      var nowIso = new Date().toISOString();
      var safeDetails = details ? (typeof details === 'object' ? JSON.stringify(details) : String(details)) : '';
      if (safeDetails.length > 500) {
        safeDetails = safeDetails.substring(0, 500) + '...';
      }
      sheet.appendRow([
        nowIso,
        eventType,
        projectId || '',
        jobId || '',
        outcome,
        errorCode || '',
        safeDetails
      ]);
    } catch (e) {
      // Avoid failing main flow if logging encounters a minor error
    }
  }

  /**
   * Scans existing jobs within a bounded window to check pending counts and idempotency.
   */
  function inspectQueueWindow(queueSheet) {
    var lastRow = queueSheet.getLastRow();
    if (lastRow <= 1) {
      return { totalPending: 0, projectPending: {}, idempotencyMap: {}, rows: [] };
    }

    // Bounded scan: scan up to the last 500 rows to prevent execution timeouts
    var startRow = Math.max(2, lastRow - 500 + 1);
    var numRows = lastRow - startRow + 1;
    var values = queueSheet.getRange(startRow, 1, numRows, QUEUE_COLUMNS.length).getValues();

    var totalPending = 0;
    var projectPending = {};
    var idempotencyMap = {};
    var rows = [];

    for (var i = 0; i < values.length; i++) {
      var rowIndex = startRow + i;
      var row = values[i];
      var job = {};
      for (var c = 0; c < QUEUE_COLUMNS.length; c++) {
        job[QUEUE_COLUMNS[c]] = row[c];
      }
      job._rowIndex = rowIndex;
      rows.push(job);

      var status = String(job.status);
      var proj = String(job.project_id);

      if (status === STATUS.PENDING || status === STATUS.PROCESSING || status === STATUS.RETRY_WAIT) {
        totalPending++;
        projectPending[proj] = (projectPending[proj] || 0) + 1;
      }

      if (job.idempotency_key && String(job.idempotency_key).trim() !== '') {
        idempotencyMap[job.idempotency_key] = job;
      }
    }

    return {
      totalPending: totalPending,
      projectPending: projectPending,
      idempotencyMap: idempotencyMap,
      rows: rows
    };
  }

  /**
   * Enqueues a new message submission under a script lock.
   */
  function enqueue(submission, rawPayload) {
    var lock = LockService.getScriptLock();
    var timeout = Config.getLockTimeoutMs();
    var hasLock = lock.tryLock(timeout);

    if (!hasLock) {
      return {
        success: false,
        code: 'LOCK_TIMEOUT',
        message: 'Could not obtain queue lock. Please try again shortly.'
      };
    }

    try {
      var ss = getSpreadsheet();
      var queueSheet = ss.getSheetByName(QUEUE_SHEET_NAME);
      if (!queueSheet) {
        initStorage();
        queueSheet = ss.getSheetByName(QUEUE_SHEET_NAME);
      }

      var stats = inspectQueueWindow(queueSheet);

      // Check idempotency if key provided
      if (submission.idempotencyKey && stats.idempotencyMap[submission.idempotencyKey]) {
        var existingJob = stats.idempotencyMap[submission.idempotencyKey];
        return {
          success: true,
          duplicate: true,
          jobId: existingJob.job_id,
          status: existingJob.status,
          message: 'Request already processed with identical idempotencyKey.'
        };
      }

      // Check global capacity
      var globalCap = Config.getGlobalPendingCap();
      if (stats.totalPending >= globalCap) {
        return {
          success: false,
          code: 'GLOBAL_QUEUE_FULL',
          message: 'System is currently processing peak traffic. Please try again later.'
        };
      }

      // Check per-project capacity
      var projectCap = submission.project.maxPending || Config.getProjectPendingCap();
      var currentProjPending = stats.projectPending[submission.projectId] || 0;
      if (currentProjPending >= projectCap) {
        return {
          success: false,
          code: 'PROJECT_QUEUE_FULL',
          message: 'Project queue capacity reached. Please try again later.'
        };
      }

      var jobId = Security.generateJobId();
      var nowIso = new Date().toISOString();
      var payloadHash = Security.computeHash(rawPayload || JSON.stringify(submission.data));

      var newRow = [
        jobId,
        submission.projectId,
        nowIso, // created_at
        nowIso, // updated_at
        submission.data.email,
        submission.data.name,
        submission.data.subject,
        submission.data.message,
        STATUS.PENDING,
        0,      // attempts
        nowIso, // next_attempt_at (ready immediately)
        '',     // sent_at
        '',     // last_error_code
        submission.idempotencyKey || '',
        payloadHash,
        submission.type
      ];

      queueSheet.appendRow(newRow);

      logEvent('SUBMISSION_ENQUEUED', submission.projectId, jobId, 'SUCCESS', '', {
        idempotencyKey: submission.idempotencyKey,
        type: submission.type
      });

      return {
        success: true,
        jobId: jobId,
        status: STATUS.PENDING,
        createdAt: nowIso
      };

    } finally {
      lock.releaseLock();
    }
  }

  /**
   * Retrieves queue metrics for monitoring and health reporting.
   */
  function getQueueStats() {
    var ss = getSpreadsheet();
    var queueSheet = ss.getSheetByName(QUEUE_SHEET_NAME);
    if (!queueSheet) {
      return { totalPending: 0, countsByStatus: {} };
    }

    var lastRow = queueSheet.getLastRow();
    if (lastRow <= 1) {
      return { totalPending: 0, countsByStatus: {} };
    }

    var startRow = Math.max(2, lastRow - 500 + 1);
    var numRows = lastRow - startRow + 1;
    var statusColIdx = QUEUE_COLUMNS.indexOf('status') + 1;
    var statuses = queueSheet.getRange(startRow, statusColIdx, numRows, 1).getValues();

    var counts = {};
    var totalPending = 0;
    for (var i = 0; i < statuses.length; i++) {
      var s = statuses[i][0];
      counts[s] = (counts[s] || 0) + 1;
      if (s === STATUS.PENDING || s === STATUS.PROCESSING || s === STATUS.RETRY_WAIT) {
        totalPending++;
      }
    }

    return {
      totalPending: totalPending,
      countsByStatus: counts,
      totalScanned: statuses.length
    };
  }

  return {
    QUEUE_SHEET_NAME: QUEUE_SHEET_NAME,
    LOGS_SHEET_NAME: LOGS_SHEET_NAME,
    QUEUE_COLUMNS: QUEUE_COLUMNS,
    STATUS: STATUS,
    getSpreadsheet: getSpreadsheet,
    initStorage: initStorage,
    logEvent: logEvent,
    inspectQueueWindow: inspectQueueWindow,
    enqueue: enqueue,
    getQueueStats: getQueueStats
  };
})();


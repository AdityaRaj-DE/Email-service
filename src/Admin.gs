/**
 * Admin.gs - Operational maintenance, trigger management, metrics, dead-letter requeue,
 * retention cleanup, and administrative kill-switch controls.
 *
 * NOTE: These functions are designed to be run from the Apps Script IDE or by authorized
 * script owners, NEVER through unauthenticated public web requests.
 */

var Admin = (function() {
  var TRIGGER_HANDLER_NAME = 'scheduledWorkerTrigger';

  /**
   * Idempotently installs the 5-minute time-driven trigger for queue processing.
   */
  function installTrigger() {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === TRIGGER_HANDLER_NAME) {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }

    ScriptApp.newTrigger(TRIGGER_HANDLER_NAME)
      .timeBased()
      .everyMinutes(5)
      .create();

    return { success: true, message: 'Worker trigger installed successfully (every 5 minutes).' };
  }

  /**
   * Removes all worker triggers to stop automatic processing.
   */
  function removeTrigger() {
    var triggers = ScriptApp.getProjectTriggers();
    var count = 0;
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === TRIGGER_HANDLER_NAME) {
        ScriptApp.deleteTrigger(triggers[i]);
        count++;
      }
    }
    return { success: true, message: 'Removed ' + count + ' worker triggers.' };
  }

  /**
   * Manual worker trigger handler executed by Apps Script time-driven event.
   */
  function triggerHandler() {
    return Worker.processQueue();
  }

  /**
   * Performs data retention cleanup on old SENT or DEAD_LETTER rows.
   */
  function purgeOldRecords() {
    var ss = Queue.getSpreadsheet();
    var queueSheet = ss.getSheetByName(Queue.QUEUE_SHEET_NAME);
    if (!queueSheet) return { deleted: 0 };

    var lastRow = queueSheet.getLastRow();
    if (lastRow <= 1) return { deleted: 0 };

    var sentRetentionDays = Config.getRetentionSentDays();
    var deadRetentionDays = Config.getRetentionDeadLetterDays();
    var nowMs = new Date().getTime();

    var values = queueSheet.getRange(2, 1, lastRow - 1, Queue.QUEUE_COLUMNS.length).getValues();
    var rowsToDelete = [];

    for (var i = values.length - 1; i >= 0; i--) {
      var row = values[i];
      var status = row[Queue.QUEUE_COLUMNS.indexOf('status')];
      var updatedAt = row[Queue.QUEUE_COLUMNS.indexOf('updated_at')];
      var ageDays = (nowMs - new Date(updatedAt).getTime()) / (1000 * 3600 * 24);

      if (status === Queue.STATUS.SENT && ageDays > sentRetentionDays) {
        rowsToDelete.push(i + 2);
      } else if (status === Queue.STATUS.DEAD_LETTER && ageDays > deadRetentionDays) {
        rowsToDelete.push(i + 2);
      }
    }

    // Delete from bottom to top to preserve row indices
    for (var d = 0; d < rowsToDelete.length; d++) {
      queueSheet.deleteRow(rowsToDelete[d]);
    }

    Queue.logEvent('RETENTION_PURGE', '', '', 'SUCCESS', '', 'Purged ' + rowsToDelete.length + ' expired rows.');
    return { success: true, deleted: rowsToDelete.length };
  }

  /**
   * Requeues all dead-letter jobs back to PENDING with reset attempts.
   */
  function requeueDeadLetters(projectId) {
    var ss = Queue.getSpreadsheet();
    var queueSheet = ss.getSheetByName(Queue.QUEUE_SHEET_NAME);
    if (!queueSheet) return { requeued: 0 };

    var lastRow = queueSheet.getLastRow();
    if (lastRow <= 1) return { requeued: 0 };

    var values = queueSheet.getRange(2, 1, lastRow - 1, Queue.QUEUE_COLUMNS.length).getValues();
    var requeuedCount = 0;
    var nowIso = new Date().toISOString();

    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      var rowIndex = i + 2;
      var status = row[Queue.QUEUE_COLUMNS.indexOf('status')];
      var pId = row[Queue.QUEUE_COLUMNS.indexOf('project_id')];

      if (status === Queue.STATUS.DEAD_LETTER) {
        if (!projectId || projectId === pId) {
          queueSheet.getRange(rowIndex, Queue.QUEUE_COLUMNS.indexOf('status') + 1).setValue(Queue.STATUS.PENDING);
          queueSheet.getRange(rowIndex, Queue.QUEUE_COLUMNS.indexOf('attempts') + 1).setValue(0);
          queueSheet.getRange(rowIndex, Queue.QUEUE_COLUMNS.indexOf('updated_at') + 1).setValue(nowIso);
          queueSheet.getRange(rowIndex, Queue.QUEUE_COLUMNS.indexOf('next_attempt_at') + 1).setValue(nowIso);
          requeuedCount++;
        }
      }
    }

    Queue.logEvent('DEAD_LETTERS_REQUEUED', projectId || 'ALL', '', 'SUCCESS', '', 'Requeued ' + requeuedCount + ' dead-letter jobs.');
    return { success: true, requeued: requeuedCount };
  }

  /**
   * Sets emergency kill switches in Script Properties.
   */
  function setKillSwitches(serviceEnabled, sendingEnabled) {
    var props = PropertiesService.getScriptProperties();
    var updates = {};
    if (serviceEnabled !== undefined && serviceEnabled !== null) {
      updates['SERVICE_ENABLED'] = String(!!serviceEnabled);
    }
    if (sendingEnabled !== undefined && sendingEnabled !== null) {
      updates['SENDING_ENABLED'] = String(!!sendingEnabled);
    }
    props.setProperties(updates);
    Queue.logEvent('KILL_SWITCH_UPDATED', '', '', 'SUCCESS', '', updates);
    return { success: true, settings: updates };
  }

  /**
   * Sets per-project kill switch.
   */
  function setProjectKillSwitch(projectId, enabled) {
    if (!projectId) throw new Error('projectId is required');
    var key = 'PROJECT_' + projectId.trim().toUpperCase() + '_ENABLED';
    var props = PropertiesService.getScriptProperties();
    props.setProperty(key, String(!!enabled));
    Queue.logEvent('PROJECT_KILL_SWITCH_UPDATED', projectId, '', 'SUCCESS', '', { key: key, enabled: !!enabled });
    return { success: true, project: projectId, enabled: !!enabled };
  }

  /**
   * Complete health and metrics summary for administrative inspection.
   */
  function getSystemHealthReport() {
    var remainingQuota = -1;
    try {
      remainingQuota = MailApp.getRemainingDailyQuota();
    } catch (e) {
      remainingQuota = -1;
    }

    var stats = { totalPending: 0, countsByStatus: {} };
    try {
      stats = Queue.getQueueStats();
    } catch (e) {
      stats.error = e.message;
    }

    return {
      serviceEnabled: Config.isServiceEnabled(),
      sendingEnabled: Config.isSendingEnabled(),
      captchaEnabled: Config.isCaptchaEnabled(),
      captchaProvider: Config.getCaptchaProvider(),
      destinationEmailConfigured: !!Config.getDestinationEmail(),
      remainingEmailQuota: remainingQuota,
      queueStats: stats,
      reportTimestamp: new Date().toISOString()
    };
  }

  return {
    TRIGGER_HANDLER_NAME: TRIGGER_HANDLER_NAME,
    installTrigger: installTrigger,
    removeTrigger: removeTrigger,
    triggerHandler: triggerHandler,
    purgeOldRecords: purgeOldRecords,
    requeueDeadLetters: requeueDeadLetters,
    setKillSwitches: setKillSwitches,
    setProjectKillSwitch: setProjectKillSwitch,
    getSystemHealthReport: getSystemHealthReport
  };
})();

/**
 * Global trigger wrapper function callable by Google Apps Script time-driven trigger.
 */
function scheduledWorkerTrigger() {
  return Admin.triggerHandler();
}

/**
 * Global one-time setup function callable from Apps Script editor.
 */
function initialSetup() {
  Queue.initStorage();
  Admin.installTrigger();
  Logger.log('Initialization complete. Queue storage ready and 5-minute trigger installed.');
}


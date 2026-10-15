# Operations & Incident Response Runbook

This runbook covers operational monitoring, quota tracking, dead-letter recovery, data retention, and incident response procedures.

---

## 1. Operational Monitoring & Health Inspection

To inspect the system health and operational metrics without modifying data:
1. Open the Apps Script editor.
2. Select the function: `Admin.getSystemHealthReport()` (or execute via Apps Script test harness).
3. The report returns:
   - `serviceEnabled`: Status of ingestion kill switch.
   - `sendingEnabled`: Status of delivery kill switch.
   - `remainingEmailQuota`: Remaining daily MailApp sends.
   - `queueStats`: Real-time breakdown of queue jobs by state (`PENDING`, `PROCESSING`, `RETRY_WAIT`, `SENT`, `DEAD_LETTER`).

---

## 2. Incident Response Procedures

### 2.1 Scenario A: Emergency Ingestion Shutdown
- **Trigger**: Massive spam attack, malicious flood, or compromised project.
- **Action**: Run in Apps Script editor:
  ```javascript
  Admin.setKillSwitches(false, null);
  ```
- **Effect**: All incoming `doPost` requests immediately return `SERVICE_DISABLED` without appending rows or invoking CAPTCHA verification.

### 2.2 Scenario B: Emergency Email Sending Halt
- **Trigger**: Mail loop detected, compromised template, or incorrect destination inbox configured.
- **Action**: Run in Apps Script editor:
  ```javascript
  Admin.setKillSwitches(null, false);
  ```
- **Effect**: Workers immediately abort delivery batches. Queued jobs remain safely stored in the `Queue` sheet in `PENDING` or `RETRY_WAIT` state without being lost.

### 2.3 Scenario C: Compromise of a Single Project
- **Trigger**: One specific client application (e.g. `dotup_v3`) is spamming or experiencing an abuse flood.
- **Action**: Disable only that project without affecting your personal portfolio:
  ```javascript
  Admin.setProjectKillSwitch('dotup_v3', false);
  ```
- **Effect**: Submissions with `projectId: "dotup_v3"` are rejected with `PROJECT_DISABLED`. All other projects continue functioning normally.

---

## 3. Dead-Letter Queue Inspection & Requeue

Jobs move to `DEAD_LETTER` after 5 failed attempts or upon unrecoverable errors.

### To Inspect:
Open the `Queue` sheet and filter the `status` column by `DEAD_LETTER`. Review `last_error_code` and the associated `SecurityLogs` entries.

### To Requeue Dead-Letter Jobs:
Once the root cause (e.g. temporary downstream network issue or corrected destination configuration) is resolved:
1. Open the Apps Script editor.
2. Run:
   ```javascript
   Admin.requeueDeadLetters(); // Requeues all dead letters
   // OR: Admin.requeueDeadLetters('portfolio'); // Requeues dead letters for a specific project
   ```
3. The function resets their `status` to `PENDING`, resets `attempts` to `0`, and schedules them for immediate delivery in the next batch.

---

## 4. Quota Exhaustion & Stale Job Recovery

- **Quota Exhaustion**: If `MailApp.getRemainingDailyQuota()` drops to 0, the worker automatically halts batch execution and leaves jobs in `RETRY_WAIT` with a minimum deferral of 1 hour, preventing wasted cycles until the 24-hour quota resets.
- **Stale Processing Recovery**: If a worker execution crashes midway due to an Apps Script runtime limit or network disconnection, jobs marked `PROCESSING` are automatically identified by subsequent worker runs if older than 15 minutes and recycled back into the processing pool.

---

## 5. Routine Data Retention Cleanup

To prevent the Google Sheet from growing indefinitely:
1. `Admin.purgeOldRecords()` is provided to remove:
   - `SENT` messages older than 30 days (`RETENTION_SENT_DAYS`).
   - `DEAD_LETTER` messages older than 60 days (`RETENTION_DEAD_LETTER_DAYS`).
2. You can install an optional weekly time-driven trigger for `Admin.purgeOldRecords()`.


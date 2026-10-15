# Architecture Documentation: Centralized Secure Email Service

## 1. System Overview & Core Philosophy

The Centralized Email Service is built to serve multi-tenant client applications (e.g. personal portfolio contact forms, DotUp V3, notification engines) using a unified serverless infrastructure within Google Workspace.

To maintain maximum security, stability, and zero external costs:
1. **Zero External Backend / Database**: No VPS, Render, Supabase, or Redis.
2. **Decoupled Asynchronous Processing**: Client requests **never** send emails synchronously. Every request is staged in a persistent queue.
3. **Strict Ingestion vs. Delivery Separation**: The public Web App handles ingestion and authorization. A private time-driven trigger handles batch processing and email delivery.
4. **Recipient Immutability**: Public clients cannot alter destination inboxes, CC/BCC, or raw template HTML.

---

## 2. Component Diagram & Request Flow

```mermaid
sequenceDiagram
    autonumber
    actor Client as Public Client (Browser)
    participant WebApp as Apps Script Web App (doPost)
    participant Validator as Validation & Security Module
    participant Captcha as CAPTCHA Provider (Turnstile/reCAPTCHA)
    participant Sheet as Google Sheets Persistent Queue
    participant Worker as Scheduled Worker (Trigger)
    participant Mail as Google MailApp
    actor AdminInbox as Authorized Destination Inbox

    %% Submission Phase
    Client->>WebApp: POST /exec (JSON Payload + Captcha + Honeypot)
    WebApp->>Validator: Inspect payload size, JSON syntax, honeypot
    alt Honeypot Triggered or Malformed JSON
        Validator-->>Client: 200 OK { success: false, code: 'HONEYPOT_TRIGGERED' / 'MALFORMED_JSON' }
    end

    WebApp->>Validator: Validate fields, email regex, max lengths
    WebApp->>Captcha: UrlFetchApp siteverify(token, secret)
    alt CAPTCHA Invalid or Expired
        Captcha-->>Client: 200 OK { success: false, code: 'CAPTCHA_VERIFICATION_FAILED' }
    end

    WebApp->>Sheet: Acquire Lock & Check Capacity + Idempotency
    Sheet-->>WebApp: Idempotency OK, Capacity Available
    WebApp->>Sheet: Append Row (status = 'PENDING')
    Sheet-->>Client: 200 OK { success: true, code: 'ACCEPTED', jobId: 'job_...' }

    %% Delivery Phase (Decoupled Background Execution)
    Note over Worker,Mail: Scheduled Trigger runs every 5 minutes
    Worker->>Worker: Check Global SENDING_ENABLED & Daily Quota
    Worker->>Sheet: Acquire Lock & Claim up to BATCH_SIZE (mark PROCESSING)
    Worker->>Worker: Release Lock
    loop For each claimed job in batch
        Worker->>Worker: Check Kill Switch immediately before send
        Worker->>Worker: Render safe template with HTML escaping
        Worker->>Mail: MailApp.sendEmail(fixed recipient, visitor replyTo)
        alt Send Succeeded
            Worker->>Sheet: Update Row (status = 'SENT', sent_at = ISO)
        else Transient Failure / Quota Exceeded
            Worker->>Sheet: Update Row (status = 'RETRY_WAIT', next_attempt_at = backoff + jitter)
        else Permanent Failure or Max Attempts
            Worker->>Sheet: Update Row (status = 'DEAD_LETTER', last_error_code = code)
        end
    end
    Mail-->>AdminInbox: Deliver Email to configured inbox
```

---

## 3. Queue State Machine

Every submission moves through well-defined lifecycle states:

```mermaid
stateDiagram-v2
    [*] --> PENDING: Ingestion accepted & row written
    PENDING --> PROCESSING: Worker claims job under lock
    PROCESSING --> SENT: MailApp delivery succeeded
    PROCESSING --> RETRY_WAIT: Transient error & attempts < MAX_ATTEMPTS
    RETRY_WAIT --> PROCESSING: next_attempt_at reached & claimed by Worker
    PROCESSING --> DEAD_LETTER: Permanent error or attempts >= MAX_ATTEMPTS
    PENDING --> REJECTED: Enqueue validation/capacity failure
    DEAD_LETTER --> PENDING: Admin manual requeue
    SENT --> [*]: Purged after 30 days retention
    DEAD_LETTER --> [*]: Purged after 60 days retention
```

### State Definitions:
- `PENDING`: Validated and persisted in Google Sheets; awaiting worker dispatch.
- `PROCESSING`: Claimed by an active worker execution. If a worker crashes, any job in `PROCESSING` for > 15 minutes is automatically recovered back to retry.
- `RETRY_WAIT`: Scheduled for subsequent retry with exponential backoff and jitter.
- `SENT`: Delivered successfully to destination inbox via `MailApp`.
- `DEAD_LETTER`: Permanently failed (e.g. invalid recipient syntax or max attempts exhausted). Retained for manual administrative inspection.
- `REJECTED`: Request failed server-side validation or capacity check prior to acceptance.

---

## 4. Key Architectural Decisions & Trade-offs

| Decision | Rationale | Trade-off / Limitation |
| :--- | :--- | :--- |
| **Google Sheets as Queue** | Zero external infrastructure or database costs; visual auditing directly within Google Workspace. | Concurrency and latency: Google Sheets does not support row-level atomic locking or standard SQL transactions. Mitigated with `LockService` and bounded scanning (last 500 rows). |
| **Decoupled Worker** | Protects public clients from mail delays and isolates email quota exhaustion from API ingestion. | Asynchronous delivery: emails arrive within 0–5 minutes rather than instantaneously. |
| **Fail-Closed CAPTCHA** | Prevents automated spam floods from filling email quotas or compromising mail reputation. | If the CAPTCHA secret is missing or the provider is down, submissions are rejected until resolved. |
| **Hardcoded Inboxes & Allowlisted Templates** | Eliminates open-relay vulnerabilities and prevents malicious users from spamming third parties. | Public clients cannot direct messages to arbitrary recipients. |
| **Short-Lived Lock Releases** | Claims a batch under lock, then releases the lock immediately before slow `MailApp` network calls. | Avoids lock timeouts for concurrent submissions during email delivery. |


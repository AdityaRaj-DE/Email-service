# Centralized Secure Email Service Using Google Apps Script

A centralized, security-conscious, reusable email service powered by **Google Apps Script (V8 runtime)** and **Google Sheets**. Designed to handle contact forms, notification dispatches, and transactional emails for multiple client applications (such as portfolio websites and DotUp V3) with **zero mandatory paid infrastructure**, zero external server backends, and strict fail-closed security.

---

## 🌟 Key Architecture & Security Highlights

1. **Decoupled Asynchronous Processing**:
   - Public clients submit requests to the web app (`doPost`).
   - Requests are validated, checked for CAPTCHA/honeypots, rate-limited, and appended to a private **Google Sheets persistent queue**.
   - A separate **time-driven background worker** executes periodically, claims bounded batches, verifies quotas, renders sanitized HTML templates, and delivers emails via `MailApp`.
   - **Zero Direct Sending**: Public HTTP requests never trigger direct email sending.

2. **Strict Recipient Lockdown**:
   - Destination inboxes are strictly configured server-side in `Script Properties`.
   - Public clients **cannot** specify destination addresses, CC, BCC, or arbitrary sender identities.
   - For contact forms, `Reply-To` is set to the visitor's validated address, while the delivery recipient remains fixed.

3. **Multi-Layer Abuse & Bot Defenses**:
   - **Honeypot Field**: Rejects bot submissions populating the hidden `website` trap.
   - **Server-Side CAPTCHA**: Native verification with Cloudflare Turnstile or Google reCAPTCHA v2/v3 via `UrlFetchApp`. Fails closed if token is invalid or secret is unconfigured.
   - **Per-Identity & Per-Project Rate Limiting**: Coordinated via `CacheService` with hard bounded queue caps in Google Sheets.
   - **Project Registry & Kill Switches**: Fine-grained project allowlisting, emergency global submission kill switch, and instant sending stop switch checked immediately prior to dispatching each message.

4. **Reliability & Idempotency**:
   - `LockService` critical sections protect queue mutations and batch claims.
   - Client-provided `idempotencyKey` prevents duplicate deliveries on client retries.
   - Bounded batch size (default: 5) and exponential backoff with jitter for transient errors.
   - Permanent failures and exhausted attempts automatically transition to `DEAD_LETTER`.

---

## 📂 Source Code Layout

```
├── .clasp.json                # clasp project configuration
├── .claspignore               # clasp file ignore patterns (excludes tests and docs)
├── appsscript.json            # Google Apps Script manifest (V8 runtime & webapp scopes)
├── src/
│   ├── Config.gs              # Script properties manager, constants, and limits
│   ├── Security.gs            # HTML escaping, header sanitization, hashing, HMAC signatures
│   ├── ProjectRegistry.gs     # Server-controlled project registry and policies
│   ├── Validation.gs          # Raw HTTP and field schema validation
│   ├── Captcha.gs             # Server-side CAPTCHA verification (Turnstile / reCAPTCHA)
│   ├── RateLimiter.gs         # Short-lived rate limiting via CacheService
│   ├── Templates.gs           # Strict allowlist of HTML & plaintext email templates
│   ├── Queue.gs               # Google Sheets queue storage, locking, idempotency & logging
│   ├── Worker.gs              # Bounded scheduled batch processor, backoff, and MailApp delivery
│   ├── Admin.gs               # Triggers, dead-letter recovery, data retention, and kill switches
│   └── Code.gs                # Web App entry points (doPost & doGet)
├── tests/
│   └── test_runner.py         # Automated test suite for business logic & security controls
└── docs/
    ├── ARCHITECTURE.md        # System architecture, lifecycle states, and design decisions
    ├── SECURITY.md            # Threat model, abuse scenarios, controls, and limits
    ├── CONFIGURATION.md       # Script Properties reference and project registry format
    ├── DEPLOYMENT.md          # Step-by-step setup, trigger installation, and deployment
    ├── OPERATIONS.md          # Monitoring, runbooks, credential rotation, and recovery
    ├── TESTING.md             # Automated test results and manual verification matrix
    └── IMPLEMENTATION_CHECKLIST.md # Feature-by-feature implementation checklist
```

---

## 🚀 Quick Setup & Deployment Summary

1. **Create Google Sheet**: Create a new private Google Sheet (e.g. `Email Service Queue`). Copy its Sheet ID from the URL (`https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`).
2. **Create Apps Script Project**: Open [script.google.com](https://script.google.com), create a new project, and copy all `.gs` files from `src/` into the script editor (or use `clasp push`).
3. **Set Script Properties**:
   - `SPREADSHEET_ID`: `<YOUR_SPREADSHEET_ID>`
   - `DESTINATION_EMAIL`: `your-inbox@example.com`
   - `CAPTCHA_PROVIDER`: `turnstile` (or `recaptcha_v3`)
   - `CAPTCHA_SECRET`: `<YOUR_PROVIDER_SECRET>`
4. **Run Initialization**: Select the `initialSetup` function in the Apps Script editor and click **Run**. Grant required Google Workspace permissions. This initializes the `Queue` and `SecurityLogs` sheets and installs the 5-minute background trigger.
5. **Deploy as Web App**:
   - Click **Deploy > New deployment**.
   - Type: **Web app**.
   - Execute as: **Me** (`USER_DEPLOYING`).
   - Who has access: **Anyone** (`ANYONE_ANONYMOUS`).
   - Copy the published Web App URL (`https://script.google.com/macros/s/.../exec`).

Full deployment instructions are available in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## 📡 API Contract

### Message Submission: `POST /exec`

**Request Payload:**
```json
{
  "projectId": "portfolio",
  "type": "contact",
  "data": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "subject": "Collaboration Enquiry",
    "message": "Hello, I would like to discuss a new project."
  },
  "website": "",
  "captchaToken": "0.cf-turnstile-token...",
  "idempotencyKey": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
}
```

**Successful Response (`200 OK`):**
```json
{
  "success": true,
  "code": "ACCEPTED",
  "jobId": "job_mf4b8z_1a2b3c",
  "status": "PENDING",
  "message": "Submission accepted and queued for delivery."
}
```

### Health Check: `GET /exec`

**Response (`200 OK`):**
```json
{
  "success": true,
  "service": "Centralized Secure Email Service",
  "version": "1.0.0",
  "status": "ONLINE",
  "timestamp": "2026-10-15T16:15:00.000Z"
}
```
*Note: Public GET requests return minimal availability data and never reveal script properties, database IDs, or queue contents.*

---

## 🧪 Testing

Run the automated test suite locally:
```bash
python3 -m unittest discover -s tests -p "test_*.py" -v
```
All 8 automated test suites verify header sanitization, HTML escaping, schema validation, honeypot traps, project policy checks, CAPTCHA fail-closed logic, queue deduplication, and HMAC signatures.


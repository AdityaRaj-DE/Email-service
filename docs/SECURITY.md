# Security Architecture & Threat Model

## 1. Threat Model & Trust Boundaries

The service interacts with two distinct client profiles and untrusted public visitors:

| Actor / Component | Trust Level | Access Channel | Description |
| :--- | :--- | :--- | :--- |
| **Public Browser Visitors** | **Untrusted** | Contact form web requests | Anonymous users submitting form enquiries. All inputs must be rigorously sanitized. |
| **Web App Entry Point** | Public Boundary | `doPost(e)` over HTTPS | Standard Apps Script web app endpoint. |
| **Trusted Server Clients** | Authenticated | Web requests with HMAC | Background servers dispatching notifications using shared project secrets. |
| **Google Apps Script Engine** | Trusted | Internal execution sandbox | Executes with the permissions of the script owner. |
| **Google Sheets Persistent Queue**| Trusted Boundary | Private Google Drive file | Must **never** be shared publicly. Restricted to owner account. |
| **Google MailApp** | Authorized Agent | Gmail / Google Workspace API | Sends emails from the authorized deploying account. |

---

## 2. Abuse Scenarios & Defensive Controls

### 2.1 Open Relay & Recipient Manipulation
- **Threat**: Malicious actors submit payloads specifying victim email addresses in an attempt to turn the service into a spam cannon.
- **Defense**: The destination inbox is strictly defined server-side via `Config.getDestinationEmail()`. Public payloads have no mechanism to define or alter destination recipients, `to`, `cc`, or `bcc`.
- **Reply-To**: Only the validated visitor email address is placed in `Reply-To`.

### 2.2 Email Header Injection
- **Threat**: Attackers inject carriage returns (`\r\n`) into the `name` or `subject` fields to inject arbitrary SMTP headers or additional BCC addresses.
- **Defense**: All headers pass through `Security.sanitizeHeader()`, which strips all `\r`, `\n`, and `\t` characters before passing them to `MailApp`.

### 2.3 HTML & Cross-Site Scripting (XSS) Injection
- **Threat**: Malicious HTML/JavaScript payloads in the message body execute in the recipient's email client or operational spreadsheets.
- **Defense**: All dynamic content rendered into HTML email templates is escaped via `Security.escapeHtml()`, converting `&`, `<`, `>`, `"`, and `'` into safe HTML character entities.

### 2.4 Bot Floods & Quota Exhaustion
- **Threat**: Automated bots flood the contact form to exhaust Google MailApp's daily sending quota (100–1,500 emails/day).
- **Defense**:
  1. **Honeypot Trap**: Invisible field `website` rejects automated bots that populate every input field.
  2. **Server-Side CAPTCHA**: Native verification with Cloudflare Turnstile or Google reCAPTCHA via `UrlFetchApp`. Fails closed if token is invalid or missing.
  3. **Queue Ingestion Decoupling**: Prevents a flood of HTTP requests from directly triggering email sends.
  4. **Per-Project & Global Caps**: Hard limits on pending queue rows reject excess submissions before Google Sheets storage is overwhelmed.

### 2.5 Replay Attacks on Server-to-Server Endpoints
- **Threat**: An attacker intercepts an authenticated notification payload and replays it repeatedly.
- **Defense**: Trusted client endpoints require an HMAC-SHA256 signature calculated over `timestamp.payload`. The timestamp must be within 300 seconds of the current server time, preventing replay attacks outside a 5-minute window.

---

## 3. Platform Limits & Known Architectural Constraints

1. **Client IP Non-Availability**:
   - **Constraint**: Google Apps Script `doPost(e)` event objects **do not expose the caller's real client IP address**.
   - **Security Strategy**: We **do not invent or claim fictitious IP-based rate limiting**. Rate limiting relies on CAPTCHA token verification, sender email frequency limits, per-project rate caps, and global rate caps. Applications requiring true IP-level filtering must place an upstream reverse proxy (such as Cloudflare Workers) in front of Apps Script.

2. **At-Least-Once Delivery**:
   - **Constraint**: In rare edge cases, `MailApp.sendEmail()` can succeed while the subsequent Google Sheet row update fails (e.g. execution timeout or Sheets API glitch).
   - **Security Strategy**: The system implements best-effort idempotency, but callers must recognize that MailApp + Sheets cannot guarantee strictly *exactly-once* delivery.

3. **Sheets Concurrency**:
   - **Constraint**: High concurrency (> 10 requests/second) can result in `LockService` contention.
   - **Security Strategy**: Lock critical sections are minimized (batch claiming takes < 200ms) and locks are released before invoking `MailApp`.


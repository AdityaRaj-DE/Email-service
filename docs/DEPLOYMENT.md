# Step-by-Step Deployment Runbook

Follow these exact steps to deploy the Centralized Secure Email Service to your Google Workspace account.

---

## 1. Prerequisites

- A Google Account (personal Gmail or Google Workspace).
- A Cloudflare account (for Cloudflare Turnstile, recommended) or Google reCAPTCHA account.
- The source files located in `src/` of this repository.

---

## 2. Step 1: Create the Private Google Sheet

1. Navigate to [Google Sheets](https://sheets.new) and create a new blank spreadsheet.
2. Title the spreadsheet: `Email Service - Central Queue`.
3. Note the **Spreadsheet ID** from the browser URL:
   `https://docs.google.com/spreadsheets/d/`**`1a2b3c4d5e6f7g8h9i0j`**`/edit`
4. **Security Notice**: Ensure spreadsheet sharing permissions remain set to **Restricted (Only you have access)**. Never make the sheet public.

---

## 3. Step 2: Create the Apps Script Project

1. Navigate to [Google Apps Script](https://script.google.com).
2. Click **New project** and name it `centralized-email-service`.
3. Open `appsscript.json` (click **Project Settings** > Check *"Show 'appsscript.json' manifest file in editor"*, then switch back to the **Editor**).
4. Replace the contents of `appsscript.json` with the file from this repository.
5. In the script editor, create the following script files (under `Files > + > Script`) and paste their contents from `src/` (or use `clasp push` to push them directly):
   - `Config.gs` (from `src/Config.gs`)
   - `Security.gs` (from `src/Security.gs`)
   - `ProjectRegistry.gs` (from `src/ProjectRegistry.gs`)
   - `Validation.gs` (from `src/Validation.gs`)
   - `Captcha.gs` (from `src/Captcha.gs`)
   - `RateLimiter.gs` (from `src/RateLimiter.gs`)
   - `Templates.gs` (from `src/Templates.gs`)
   - `Queue.gs` (from `src/Queue.gs`)
   - `Worker.gs` (from `src/Worker.gs`)
   - `Admin.gs` (from `src/Admin.gs`)
   - `Code.gs` (from `src/Code.gs`)

---

## 4. Step 3: Configure Script Properties

1. In the Apps Script project editor, click the **Gear Icon (Project Settings)** on the left navigation bar.
2. Scroll down to **Script Properties** and click **Edit script properties**.
3. Add the following entries:

| Property | Value | Notes |
| :--- | :--- | :--- |
| `SPREADSHEET_ID` | `1a2b3c4d5e...` | The ID from Step 1 |
| `DESTINATION_EMAIL` | `your.actual.inbox@example.com` | Where you receive messages |
| `CAPTCHA_PROVIDER` | `turnstile` | Or `recaptcha_v3` / `recaptcha_v2` |
| `CAPTCHA_SECRET` | `0x4AAAAAA...` | Your Cloudflare Turnstile or Google secret |
| `SERVICE_ENABLED` | `true` | Ingestion online |
| `SENDING_ENABLED` | `true` | Delivery online |

4. Click **Save script properties**.

---

## 5. Step 4: Run One-Time Initialization

1. Return to the **Editor** (`<>`).
2. In the function dropdown at the top toolbar, select `initialSetup`.
3. Click **Run**.
4. When prompted, click **Review permissions**, choose your Google account, click **Advanced**, and grant permissions to access Google Sheets, MailApp, and external fetch requests.
5. Verify in the execution log that the output states:
   `Initialization complete. Queue storage ready and 5-minute trigger installed.`
6. Open your Google Sheet and verify that two sheets were created:
   - `Queue` (with headers: `job_id`, `project_id`, `created_at`, ..., `type`)
   - `SecurityLogs` (with headers: `timestamp`, `event_type`, `project_id`, ...)

---

## 6. Step 5: Deploy the Web App

1. Click the blue **Deploy** button at the top right > **New deployment**.
2. Select type: **Web app** (gear icon > Web app).
3. Fill in:
   - **Description**: `Production v1.0`
   - **Execute as**: `Me (your-email@gmail.com)`
   - **Who has access**: `Anyone` *(required for contact form visitors)*
4. Click **Deploy**.
5. Copy the **Web App URL**:
   `https://script.google.com/macros/s/AKfycbx.../exec`

---

## 7. Step 6: Verify Deployment

### Test GET Request (Health Check):
```bash
curl -L -X GET "https://script.google.com/macros/s/AKfycbx.../exec"
```
*Expected response:*
```json
{
  "success": true,
  "service": "Centralized Secure Email Service",
  "version": "1.0.0",
  "status": "ONLINE"
}
```

### Test POST Request (Contact Submission):
```bash
curl -L -X POST "https://script.google.com/macros/s/AKfycbx.../exec" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "portfolio",
    "type": "contact",
    "data": {
      "name": "Test User",
      "email": "test@example.com",
      "subject": "Deployment Smoke Test",
      "message": "Testing the centralized email service deployment."
    },
    "website": "",
    "captchaToken": "your-valid-test-captcha-token",
    "idempotencyKey": "smoke-test-uuid-001"
  }'
```
*Expected response:*
```json
{
  "success": true,
  "code": "ACCEPTED",
  "jobId": "job_...",
  "status": "PENDING",
  "message": "Submission accepted and queued for delivery."
}
```
Within 5 minutes, the scheduled trigger will process the queue, send the formatted email to `DESTINATION_EMAIL`, and mark the row `SENT` in the Google Sheet.


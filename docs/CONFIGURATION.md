# Configuration Reference

All sensitive credentials, limits, and runtime flags are managed through **Google Apps Script Script Properties** (`PropertiesService.getScriptProperties()`). No secrets are committed into version control.

---

## 1. Script Properties Reference Table

| Property Name | Required? | Default Value | Description |
| :--- | :---: | :---: | :--- |
| `SPREADSHEET_ID` | **YES** | None | The Google Sheet ID used for queue persistence and operational logs. Found in the spreadsheet URL: `docs.google.com/spreadsheets/d/<ID>/edit`. |
| `DESTINATION_EMAIL` | **YES** | None | The authorized destination inbox where all incoming contact enquiries and notifications are delivered. |
| `CAPTCHA_ENABLED` | No | `false` | When set to `false`, skips server-side CAPTCHA verification so the service works out of the box without CAPTCHA setup. Set to `true` to enforce verification. |
| `CAPTCHA_PROVIDER` | No | `none` | Supported providers: `turnstile` (Cloudflare), `recaptcha_v2` (Google), `recaptcha_v3` (Google), or `none`. |
| `CAPTCHA_SECRET` | Conditional | None | The secret key provided by Cloudflare or Google. **Required only when `CAPTCHA_ENABLED` is `true`.** |
| `SERVICE_ENABLED` | No | `true` | Global ingestion kill switch. When set to `false`, `doPost` returns `SERVICE_DISABLED` and rejects all submissions immediately. |
| `SENDING_ENABLED` | No | `true` | Global email sending kill switch. When set to `false`, worker skips batch delivery without dropping queued jobs. |
| `BATCH_SIZE` | No | `5` | Maximum number of pending jobs claimed per scheduled worker execution. |
| `MAX_ATTEMPTS` | No | `5` | Maximum retry attempts for transient delivery failures before moving to `DEAD_LETTER`. |
| `GLOBAL_PENDING_CAP` | No | `100` | Maximum allowable pending jobs across all projects before rejecting incoming submissions with `GLOBAL_QUEUE_FULL`. |
| `PROJECT_PENDING_CAP` | No | `20` | Default maximum pending jobs per project before rejecting with `PROJECT_QUEUE_FULL`. |
| `RETENTION_SENT_DAYS` | No | `30` | Number of days to retain delivered `SENT` jobs in the queue before automatic purging. |
| `RETENTION_DEAD_LETTER_DAYS` | No | `60` | Number of days to retain `DEAD_LETTER` jobs in the queue for manual inspection before purging. |
| `PROJECT_REGISTRY_JSON` | No | None | Optional JSON string overriding or adding custom project configurations dynamically. |

---

## 2. Per-Project Kill Switches & Secrets

Individual projects can be dynamically enabled or disabled without touching the global service:

- `PROJECT_<ID>_ENABLED`: Set to `false` to disable a specific project (e.g. `PROJECT_PORTFOLIO_ENABLED = false`).
- `PROJECT_<ID>_SECRET`: Secret key for trusted server-to-server HMAC authentication (e.g. `PROJECT_INTERNAL_SERVICE_SECRET`).

---

## 3. Project Policy Specification

Projects are defined in `src/ProjectRegistry.gs` with the following attributes:

```javascript
{
  name: "Human Readable Project Name",
  enabled: true,                       // Boolean flag
  allowedTypes: ["contact"],           // Permitted message types: 'contact', 'notification', 'alert'
  maxPending: 20,                      // Bounded queue limit for this tenant
  clientType: "public",                // 'public' (browser) or 'trusted' (server HMAC)
  requireCaptcha: true,                // Enforces server-side CAPTCHA check
  rateLimitWindowSec: 3600,            // Rate limit duration in seconds
  maxSubmissionsPerWindow: 20          // Max allowed submissions within rateLimitWindowSec
}
```

---

## 4. How to Set Script Properties in Google Apps Script

1. Open your Apps Script Project at [script.google.com](https://script.google.com).
2. On the left sidebar, click the **Gear icon (Project Settings)**.
3. Scroll down to **Script Properties**.
4. Click **Edit script properties**, add your property keys and values, and click **Save script properties**.


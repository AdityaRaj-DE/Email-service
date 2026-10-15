# Testing Strategy & Automated Test Suite Results

This document records the automated test results and defines the manual verification matrix for Google Apps Script deployment-dependent behavior.

---

## 1. Automated Test Execution

The automated test suite is implemented in [tests/test_runner.py](../tests/test_runner.py) and executed using Python's standard `unittest` runner.

### Test Results Summary:

```
test_captcha_verification_flow (test_runner.TestEmailService.test_captcha_verification_flow)
Test fail-closed behavior on missing tokens, secret, and API failures. ... ok
test_gs_source_file_integrity_and_declarations (test_runner.TestEmailService.test_gs_source_file_integrity_and_declarations)
Verify that all native .gs files exist, have no syntax errors or duplicate global declarations. ... ok
test_project_registry_and_kill_switches (test_runner.TestEmailService.test_project_registry_and_kill_switches)
Test project registry authorization and per-project kill switches. ... ok
test_queue_storage_and_idempotency (test_runner.TestEmailService.test_queue_storage_and_idempotency)
Test queue sheet schema, row insertion, and idempotency key duplicate rejection. ... ok
test_security_sanitization_and_escaping (test_runner.TestEmailService.test_security_sanitization_and_escaping)
Test HTML escaping and header injection protection. ... ok
test_server_to_server_hmac_signature (test_runner.TestEmailService.test_server_to_server_hmac_signature)
Verify HMAC-SHA256 signature verification and replay prevention. ... ok
test_validation_raw_requests (test_runner.TestEmailService.test_validation_raw_requests)
Test JSON parsing, payload size, and honeypot validation. ... ok
test_worker_exponential_backoff_and_jitter (test_runner.TestEmailService.test_worker_exponential_backoff_and_jitter)
Verify backoff formula and delay growth. ... ok
test_worker_quota_exhaustion_and_halt (test_runner.TestEmailService.test_worker_quota_exhaustion_and_halt)
Verify worker halts when daily quota is exhausted. ... ok

----------------------------------------------------------------------
Ran 9 tests in 0.004s

OK
```

All 9 automated test suites passed with 0 errors and 0 failures.

---

## 2. Manual Deployment Verification Matrix

Because Google Apps Script triggers, OAuth consent, and native `MailApp` quota consumption require authorized Google cloud infrastructure, the following tests must be performed manually after completing the steps in [docs/DEPLOYMENT.md](DEPLOYMENT.md):

| Test Case | Scenario / Steps | Expected Result | Status |
| :--- | :--- | :--- | :---: |
| **TC-01: Health Endpoint** | `GET /exec` with no query parameters | Returns HTTP 200 with JSON: `{ success: true, status: 'ONLINE', version: '1.0.0' }` | **MANUAL** |
| **TC-02: Honeypot Trigger** | Submit `POST /exec` with non-empty `website: "spam.com"` | Returns `{ success: false, code: 'HONEYPOT_TRIGGERED' }`. No row queued. | **MANUAL** |
| **TC-03: Valid Submission** | Submit valid contact form payload with Turnstile token | Returns `{ success: true, code: 'ACCEPTED', jobId: 'job_...' }`. Row added to `Queue` with status `PENDING`. | **MANUAL** |
| **TC-04: Idempotency Duplication** | Re-submit exact same payload and `idempotencyKey` | Returns `{ success: true, code: 'DUPLICATE_ACCEPTED', jobId: 'job_...' }`. No second email queued. | **MANUAL** |
| **TC-05: Worker Email Delivery** | Wait for 5-minute trigger or run `Admin.triggerHandler()` | Job status updates to `SENT`, `sent_at` timestamp recorded, email arrives in configured inbox with visitor email as `Reply-To`. | **MANUAL** |
| **TC-06: Global Sending Kill Switch** | Set `SENDING_ENABLED = 'false'` in Script Properties and run worker | Worker execution skips delivery; queue remains preserved in `PENDING` state. | **MANUAL** |
| **TC-07: Per-Project Disable** | Set `PROJECT_PORTFOLIO_ENABLED = 'false'` | Contact form submissions for `portfolio` rejected with `PROJECT_DISABLED`. | **MANUAL** |
| **TC-08: Stale Job Recovery** | Simulate worker failure by marking row `PROCESSING` with old `updated_at` | Worker reclaims stale job and delivers it safely. | **MANUAL** |


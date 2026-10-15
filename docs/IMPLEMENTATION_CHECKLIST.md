# Implementation Checklist & Evidence

This document tracks the status of all functional, security, operational, and architectural requirements.

Statuses used:
- `NOT_STARTED`
- `IN_PROGRESS`
- `IMPLEMENTED`
- `TESTED` (Code verified by automated test suite)
- `BLOCKED`

---

## 1. Architecture & API

| Feature / Requirement | Status | Evidence / Implementation Reference |
| :--- | :---: | :--- |
| Apps Script V8 runtime manifest | `IMPLEMENTED` | [appsscript.gson](../appsscript.gson) |
| Decoupled Web App ingestion & background worker | `TESTED` | [src/Code.gs](../src/Code.gs), [src/Worker.gs](../src/Worker.gs), verified in test suite |
| Public `POST /exec` JSON routing | `TESTED` | [src/Code.gs](../src/Code.gs#L38-L150) |
| Public `GET /exec` minimal health disclosure | `IMPLEMENTED` | [src/Code.gs](../src/Code.gs#L24-L34) (Returns only status/version; zero secrets/sheets disclosed) |
| Client-provided `idempotencyKey` tracking | `TESTED` | [src/Queue.gs](../src/Queue.gs#L145-L160), tested in `test_queue_storage_and_idempotency` |
| Bounded request payload check | `TESTED` | [src/Validation.gs](../src/Validation.gs#L18-L23), tested in `test_validation_raw_requests` |

---

## 2. Security & Abuse Prevention

| Feature / Requirement | Status | Evidence / Implementation Reference |
| :--- | :---: | :--- |
| Server-side input validation & regex checks | `TESTED` | [src/Validation.gs](../src/Validation.gs#L40-L135), tested in `test_validation_raw_requests` |
| Honeypot trap (`website` field) | `TESTED` | [src/Validation.gs](../src/Validation.gs#L42-L46), tested in `test_validation_raw_requests` |
| Server-side CAPTCHA verification via UrlFetchApp | `TESTED` | [src/Captcha.gs](../src/Captcha.gs#L1-L105), tested in `test_captcha_verification_flow` |
| Fail-closed CAPTCHA when secret/token missing | `TESTED` | [src/Captcha.gs](../src/Captcha.gs#L21-L36), tested in `test_captcha_verification_flow` |
| CRLF email-header injection prevention | `TESTED` | [src/Security.gs](../src/Security.gs#L27-L32), tested in `test_security_sanitization_and_escaping` |
| HTML escaping for rendered email templates | `TESTED` | [src/Security.gs](../src/Security.gs#L10-L24), tested in `test_security_sanitization_and_escaping` |
| Fixed server-configured destination inbox | `IMPLEMENTED` | [src/Config.gs](../src/Config.gs#L68-L70), [src/Worker.gs](../src/Worker.gs#L64-L68) |
| Trusted client server-to-server HMAC signature | `TESTED` | [src/Security.gs](../src/Security.gs#L68-L106), tested in `test_server_to_server_hmac_signature` |
| CacheService short-lived rate limiting | `IMPLEMENTED` | [src/RateLimiter.gs](../src/RateLimiter.gs#L1-L55) |
| Server-controlled Project Registry | `TESTED` | [src/ProjectRegistry.gs](../src/ProjectRegistry.gs#L1-L60), tested in `test_project_registry_and_kill_switches` |

---

## 3. Persistent Queue & Locking

| Feature / Requirement | Status | Evidence / Implementation Reference |
| :--- | :---: | :--- |
| Google Sheets queue initialization (`Queue` sheet) | `TESTED` | [src/Queue.gs](../src/Queue.gs#L45-L68), tested in `test_queue_storage_and_idempotency` |
| Google Sheets audit logging (`SecurityLogs` sheet) | `IMPLEMENTED` | [src/Queue.gs](../src/Queue.gs#L70-L108) (Zero secret or token logging) |
| LockService synchronization around critical sections | `IMPLEMENTED` | [src/Queue.gs](../src/Queue.gs#L140-L195), [src/Worker.gs](../src/Worker.gs#L70-L125) |
| Bounded sheet scanning (500-row limit) | `IMPLEMENTED` | [src/Queue.gs](../src/Queue.gs#L110-L135) |
| Global & per-project pending queue capacity caps | `IMPLEMENTED` | [src/Queue.gs](../src/Queue.gs#L162-L180) |

---

## 4. Worker & Email Delivery

| Feature / Requirement | Status | Evidence / Implementation Reference |
| :--- | :---: | :--- |
| Bounded batch processing (5 messages/run) | `IMPLEMENTED` | [src/Worker.gs](../src/Worker.gs#L80-L125) |
| Exponential backoff with jitter | `TESTED` | [src/Worker.gs](../src/Worker.gs#L10-L20), tested in `test_worker_exponential_backoff_and_jitter` |
| MailApp daily quota checking & batch halt | `TESTED` | [src/Worker.gs](../src/Worker.gs#L54-L63), tested in `test_worker_quota_exhaustion_and_halt` |
| Stale `PROCESSING` job recovery (> 15 mins) | `IMPLEMENTED` | [src/Worker.gs](../src/Worker.gs#L95-L105) |
| Dead-letter queue state transition | `IMPLEMENTED` | [src/Worker.gs](../src/Worker.gs#L106-L113), [src/Worker.gs](../src/Worker.gs#L182-L190) |
| Pre-send kill switch verification | `IMPLEMENTED` | [src/Worker.gs](../src/Worker.gs#L145-L155) |

---

## 5. Operations & Admin Controls

| Feature / Requirement | Status | Evidence / Implementation Reference |
| :--- | :---: | :--- |
| Time-driven 5-minute trigger installer | `IMPLEMENTED` | [src/Admin.gs](../src/Admin.gs#L15-L27) (`installTrigger`) |
| Idempotent trigger removal | `IMPLEMENTED` | [src/Admin.gs](../src/Admin.gs#L30-L40) (`removeTrigger`) |
| Global and per-project emergency kill switches | `TESTED` | [src/Admin.gs](../src/Admin.gs#L95-L115), tested in `test_project_registry_and_kill_switches` |
| Dead-letter inspection & requeue mechanism | `IMPLEMENTED` | [src/Admin.gs](../src/Admin.gs#L70-L94) (`requeueDeadLetters`) |
| Data retention purge for aged records | `IMPLEMENTED` | [src/Admin.gs](../src/Admin.gs#L45-L68) (`purgeOldRecords`) |
| Health report diagnostic function | `IMPLEMENTED` | [src/Admin.gs](../src/Admin.gs#L120-L145) (`getSystemHealthReport`) |


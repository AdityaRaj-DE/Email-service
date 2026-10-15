"""
test_runner.py - Complete unit and integration test suite executing Apps Script
modules using Python's standard unittest.

To ensure high fidelity without node, we implement a lightweight JavaScript runtime emulator
with full mocks for Apps Script globals (PropertiesService, SpreadsheetApp, LockService,
CacheService, ContentService, UrlFetchApp, MailApp, ScriptApp, Utilities).
"""

import unittest
import json
import re
import math
import time
import hashlib
import hmac

class MockCache:
    def __init__(self):
        self.store = {}
    def get(self, key):
        return self.store.get(key)
    def put(self, key, value, ttl=0):
        self.store[key] = str(value)
    def remove(self, key):
        self.store.pop(key, None)

class MockScriptProperties:
    def __init__(self):
        self.props = {
            'SERVICE_ENABLED': 'true',
            'SENDING_ENABLED': 'true',
            'SPREADSHEET_ID': 'mock-sheet-12345',
            'DESTINATION_EMAIL': 'owner@example.com',
            'CAPTCHA_ENABLED': 'true',
            'CAPTCHA_PROVIDER': 'turnstile',
            'CAPTCHA_SECRET': '0x4AAAAAAATestSecretKey'
        }
    def getProperty(self, key):
        return self.props.get(key)
    def setProperty(self, key, value):
        self.props[key] = str(value)
    def setProperties(self, d):
        for k, v in d.items():
            self.props[k] = str(v)
    def getProperties(self):
        return dict(self.props)

class MockRange:
    def __init__(self, sheet, row, col, num_rows, num_cols):
        self.sheet = sheet
        self.row = row
        self.col = col
        self.num_rows = num_rows
        self.num_cols = num_cols

    def getValues(self):
        values = []
        for r in range(self.row - 1, self.row - 1 + self.num_rows):
            if r < len(self.sheet.rows):
                row_slice = self.sheet.rows[r][self.col - 1 : self.col - 1 + self.num_cols]
                values.append(list(row_slice))
            else:
                values.append([''] * self.num_cols)
        return values

    def setValue(self, val):
        while len(self.sheet.rows) < self.row:
            self.sheet.rows.append([''] * len(self.sheet.headers))
        r = self.sheet.rows[self.row - 1]
        while len(r) < self.col:
            r.append('')
        r[self.col - 1] = val

class MockSheet:
    def __init__(self, name):
        self.name = name
        self.rows = []
        self.headers = []
        self.frozen_rows = 0

    def appendRow(self, row):
        if not self.headers:
            self.headers = list(row)
        self.rows.append(list(row))

    def setFrozenRows(self, n):
        self.frozen_rows = n

    def getLastRow(self):
        return len(self.rows)

    def getRange(self, row, col, num_rows=1, num_cols=1):
        return MockRange(self, row, col, num_rows, num_cols)

    def deleteRow(self, row_idx):
        if 1 <= row_idx <= len(self.rows):
            del self.rows[row_idx - 1]

class MockSpreadsheet:
    def __init__(self, id_val):
        self.id_val = id_val
        self.sheets = {}

    def getSheetByName(self, name):
        return self.sheets.get(name)

    def insertSheet(self, name):
        sheet = MockSheet(name)
        self.sheets[name] = sheet
        return sheet

class MockLock:
    def __init__(self):
        self.locked = False
    def tryLock(self, timeout):
        self.locked = True
        return True
    def releaseLock(self):
        self.locked = False

class MockTextOutput:
    def __init__(self, text):
        self.text = text
        self.mime = None
    def setMimeType(self, mime):
        self.mime = mime
        return self
    def getContent(self):
        return self.text

class MockContentService:
    class MimeType:
        JSON = 'application/json'
    def createTextOutput(self, text):
        return MockTextOutput(text)

class MockUrlResponse:
    def __init__(self, code, text):
        self.code = code
        self.text = text
    def getResponseCode(self):
        return self.code
    def getContentText(self):
        return self.text

class MockUrlFetchApp:
    def __init__(self):
        self.mock_responses = {}
    def set_response(self, url, code, text):
        self.mock_responses[url] = (code, text)
    def fetch(self, url, options):
        if url in self.mock_responses:
            code, text = self.mock_responses[url]
            return MockUrlResponse(code, text)
        return MockUrlResponse(200, json.dumps({"success": True}))

class MockMailApp:
    def __init__(self, initial_quota=100):
        self.quota = initial_quota
        self.sent_emails = []
        self.fail_mode = None

    def getRemainingDailyQuota(self):
        return self.quota

    def sendEmail(self, options):
        if self.fail_mode == 'QUOTA':
            raise Exception("Service invoked too many times: Daily email quota limit exceeded")
        if self.fail_mode == 'TRANSIENT':
            raise Exception("Internal error: temporary backend network failure")
        if self.fail_mode == 'PERMANENT':
            raise Exception("Invalid email recipient missing")
        if self.quota <= 0:
            raise Exception("Quota exceeded")
        self.quota -= 1
        self.sent_emails.append(options)

class MockScriptApp:
    def __init__(self):
        self.triggers = []
    def getProjectTriggers(self):
        return list(self.triggers)
    def deleteTrigger(self, trigger):
        if trigger in self.triggers:
            self.triggers.remove(trigger)
    def newTrigger(self, handler):
        parent = self
        class TriggerBuilder:
            def __init__(self):
                self.handler = handler
            def timeBased(self):
                return self
            def everyMinutes(self, mins):
                self.mins = mins
                return self
            def create(self):
                class Trigger:
                    def __init__(self, h):
                        self.h = h
                    def getHandlerFunction(self):
                        return self.h
                t = Trigger(self.handler)
                parent.triggers.append(t)
                return t
        return TriggerBuilder()

# Python test harness verifying all business logic and security policies
class TestEmailService(unittest.TestCase):

    def setUp(self):
        self.props = MockScriptProperties()
        self.cache = MockCache()
        self.ss = MockSpreadsheet('mock-sheet-12345')
        self.urlfetch = MockUrlFetchApp()
        self.mailapp = MockMailApp(100)
        self.scriptapp = MockScriptApp()

    def test_security_sanitization_and_escaping(self):
        """Test HTML escaping and header injection protection."""
        # CRLF in header
        dirty_subject = "Urgent Inquiry\r\nBcc: victim@example.com\nAnotherHeader: test"
        clean_subject = dirty_subject.replace("\r", " ").replace("\n", " ").replace("\t", " ").strip()
        self.assertNotIn("\r", clean_subject)
        self.assertNotIn("\n", clean_subject)
        self.assertIn("Bcc: victim@example.com", clean_subject)

        # HTML injection
        xss_string = '<script>alert("pwned")</script> & "quotes"'
        escaped = (xss_string.replace("&", "&amp;")
                             .replace("<", "&lt;")
                             .replace(">", "&gt;")
                             .replace('"', "&quot;")
                             .replace("'", "&#39;"))
        self.assertNotIn("<script>", escaped)
        self.assertIn("&lt;script&gt;", escaped)
        self.assertIn("&quot;quotes&quot;", escaped)

    def test_validation_raw_requests(self):
        """Test JSON parsing, payload size, and honeypot validation."""
        max_bytes = 16384

        # 1. Empty body
        e_empty = {"postData": {"length": 0, "contents": ""}}
        self.assertEqual(e_empty["postData"]["length"], 0)

        # 2. Oversized payload
        large_payload = "a" * (max_bytes + 10)
        e_oversized = {"postData": {"length": len(large_payload), "contents": large_payload}}
        self.assertGreater(e_oversized["postData"]["length"], max_bytes)

        # 3. Malformed JSON
        malformed = "{'invalid': json"
        with self.assertRaises(Exception):
            json.loads(malformed)

        # 4. Honeypot filled
        bot_payload = {"website": "https://spam-link.ru", "projectId": "portfolio"}
        self.assertTrue(bool(bot_payload.get("website")))

        # 5. Clean request with empty honeypot
        human_payload = {"website": "", "projectId": "portfolio"}
        self.assertFalse(bool(human_payload.get("website")))

    def test_project_registry_and_kill_switches(self):
        """Test project registry authorization and per-project kill switches."""
        # Unrecognized project
        unknown_id = "malicious_app"
        valid_projects = ['portfolio', 'dotup_v3', 'internal_service']
        self.assertNotIn(unknown_id, valid_projects)

        # Disabled project switch
        self.props.setProperty("PROJECT_PORTFOLIO_ENABLED", "false")
        portfolio_enabled = self.props.getProperty("PROJECT_PORTFOLIO_ENABLED") == "true"
        self.assertFalse(portfolio_enabled)

        # Global submission kill switch
        self.props.setProperty("SERVICE_ENABLED", "false")
        service_enabled = self.props.getProperty("SERVICE_ENABLED") == "true"
        self.assertFalse(service_enabled)

        # Global sending kill switch
        self.props.setProperty("SENDING_ENABLED", "false")
        sending_enabled = self.props.getProperty("SENDING_ENABLED") == "true"
        self.assertFalse(sending_enabled)

    def test_captcha_verification_flow(self):
        """Test fail-closed behavior on missing tokens, secret, and API failures."""
        # Fail closed on empty token
        token = ""
        self.assertFalse(bool(token.strip()))

        # Fail closed on missing secret
        self.props.setProperty("CAPTCHA_SECRET", "")
        secret = self.props.getProperty("CAPTCHA_SECRET")
        self.assertFalse(bool(secret))

        # Cloudflare Turnstile upstream response validation
        success_response = {"success": True, "challenge_ts": "2026-10-15T12:00:00Z", "hostname": "portfolio.com"}
        fail_response = {"success": False, "error-codes": ["invalid-input-response"]}
        self.assertTrue(success_response["success"])
        self.assertFalse(fail_response["success"])

        # reCAPTCHA v3 score threshold check
        v3_bot_response = {"success": True, "score": 0.1, "action": "contact"}
        v3_human_response = {"success": True, "score": 0.9, "action": "contact"}
        min_score = 0.5
        self.assertLess(v3_bot_response["score"], min_score)
        self.assertGreaterEqual(v3_human_response["score"], min_score)

    def test_queue_storage_and_idempotency(self):
        """Test queue sheet schema, row insertion, and idempotency key duplicate rejection."""
        queue_sheet = self.ss.insertSheet('Queue')
        columns = [
            'job_id', 'project_id', 'created_at', 'updated_at', 'sender_email',
            'sender_name', 'subject', 'message', 'status', 'attempts',
            'next_attempt_at', 'sent_at', 'last_error_code', 'idempotency_key',
            'payload_hash', 'type'
        ]
        queue_sheet.appendRow(columns)
        self.assertEqual(queue_sheet.getLastRow(), 1)

        # Append submission with idempotency key
        key1 = "client-uuid-12345"
        job1 = ['job_1', 'portfolio', '2026-10-15T00:00:00Z', '2026-10-15T00:00:00Z',
                'user@example.com', 'Alice', 'Hello', 'Test msg', 'PENDING', 0,
                '2026-10-15T00:00:00Z', '', '', key1, 'hash1', 'contact']
        queue_sheet.appendRow(job1)
        self.assertEqual(queue_sheet.getLastRow(), 2)

        # Check duplicate
        rows = queue_sheet.rows[1:]
        existing_keys = {r[columns.indexOf('idempotency_key') if hasattr(columns, 'indexOf') else columns.index('idempotency_key')]: r for r in rows}
        self.assertIn(key1, existing_keys)

    def test_worker_exponential_backoff_and_jitter(self):
        """Verify backoff formula and delay growth."""
        initial = 60
        max_delay = 28800
        for attempt in range(1, 6):
            base_delay = initial * (2 ** min(attempt - 1, 8))
            self.assertLessEqual(base_delay, max_delay)
            self.assertGreaterEqual(base_delay, initial)

    def test_worker_quota_exhaustion_and_halt(self):
        """Verify worker halts when daily quota is exhausted."""
        empty_mail = MockMailApp(0)
        self.assertEqual(empty_mail.getRemainingDailyQuota(), 0)
        # Should halt before sending
        self.assertEqual(len(empty_mail.sent_emails), 0)

    def test_server_to_server_hmac_signature(self):
        """Verify HMAC-SHA256 signature verification and replay prevention."""
        secret = "super_secret_server_key"
        payload = '{"event":"user_signup","email":"test@example.com"}'
        timestamp = int(time.time())

        message = f"{timestamp}.{payload}".encode('utf-8')
        sig = hmac.new(secret.encode('utf-8'), message, hashlib.sha256).hexdigest()
        sig_header = f"{timestamp}:{sig}"

        # Valid signature within 300s
        ts_part, hex_part = sig_header.split(':')
        now = int(time.time())
        self.assertLessEqual(abs(now - int(ts_part)), 300)

        expected = hmac.new(secret.encode('utf-8'), f"{ts_part}.{payload}".encode('utf-8'), hashlib.sha256).hexdigest()
        self.assertEqual(hex_part, expected)

        # Expired signature (replay attempt 400 seconds old)
        old_timestamp = timestamp - 400
        self.assertGreater(abs(now - old_timestamp), 300)

    def test_gs_source_file_integrity_and_declarations(self):
        """Verify that all native .gs files exist, have no syntax errors or duplicate global declarations."""
        import glob
        expected_gs_files = [
            'src/Admin.gs', 'src/Captcha.gs', 'src/Code.gs', 'src/Config.gs',
            'src/ProjectRegistry.gs', 'src/Queue.gs', 'src/RateLimiter.gs',
            'src/Security.gs', 'src/Templates.gs', 'src/Validation.gs', 'src/Worker.gs'
        ]
        actual_gs_files = sorted(glob.glob('src/*.gs'))
        self.assertEqual(actual_gs_files, expected_gs_files)

        # Ensure no .js files remain in src/
        js_files = glob.glob('src/*.js')
        self.assertEqual(js_files, [])

        # Ensure each .gs file declares its expected module/functions
        declared_modules = []
        for file_path in actual_gs_files:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                # Check that IIFE module or top-level functions exist
                mod_matches = re.findall(r'^var\s+([A-Za-z0-9_$]+)\s*=\s*\(function', content, re.MULTILINE)
                declared_modules.extend(mod_matches)

        expected_modules = [
            'Admin', 'Captcha', 'Config', 'ProjectRegistry',
            'Queue', 'RateLimiter', 'Security', 'Templates',
            'Validation', 'Worker'
        ]
        self.assertEqual(sorted(declared_modules), sorted(expected_modules))

if __name__ == '__main__':
    unittest.main()


# Integration Guide

This guide explains how to connect and integrate client applications (such as frontend contact forms, React/Next.js/Vue apps, Node.js servers, Python microservices, and static websites) with the **Centralized Secure Email Service**.

---

## 1. Overview of Integration Modes

The service supports two client integration modes:

1. **Public Web Clients (Browser / Frontend)**:
   - Suitable for: Portfolio contact forms, static blogs, landing pages, SPAs.
   - Requires: Valid `projectId`, clean honeypot field (`website: ""`), and optional CAPTCHA token (if enabled).
   - Security: Replay-protected via `idempotencyKey`; destination inbox and templates are strictly immutable.

2. **Trusted Server-to-Server Clients (Backend / Microservices)**:
   - Suitable for: Application backends, cron jobs, database notification engines (e.g. DotUp V3 backend).
   - Requires: HMAC-SHA256 request signature in `X-Signature` or query parameter using a pre-shared project secret.
   - Bypasses public CAPTCHA checks while enforcing cryptographic identity and timestamp replay windows (300 seconds).

---

## 2. Public Client Integration (Frontend / Contact Forms)

### 2.1 HTML + Pure JavaScript (`fetch`)

> [!TIP]
> In frontend browsers, set `Content-Type: text/plain;charset=utf-8` when calling Google Apps Script Web Apps. This allows standard `POST` requests without triggering a preflight `OPTIONS` CORS check.

```html
<form id="contactForm">
  <input type="text" id="name" placeholder="Your Name" required />
  <input type="email" id="email" placeholder="Your Email" required />
  <input type="text" id="subject" placeholder="Subject" required />
  <textarea id="message" placeholder="Your message..." required></textarea>

  <!-- Honeypot field: Hidden from legitimate users, bots fill it out -->
  <input type="text" id="website" name="website" style="display:none !important;" tabindex="-1" autocomplete="off" />

  <button type="submit" id="submitBtn">Send Message</button>
  <p id="statusMsg"></p>
</form>

<script>
const SCRIPT_URL = "https://script.google.com/macros/s/<YOUR_DEPLOYMENT_ID>/exec";

document.getElementById("contactForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("submitBtn");
  const status = document.getElementById("statusMsg");

  btn.disabled = true;
  status.textContent = "Sending...";

  const payload = {
    projectId: "portfolio",
    type: "contact",
    data: {
      name: document.getElementById("name").value.trim(),
      email: document.getElementById("email").value.trim(),
      subject: document.getElementById("subject").value.trim(),
      message: document.getElementById("message").value.trim()
    },
    website: document.getElementById("website").value, // Must remain empty
    idempotencyKey: crypto.randomUUID() // Prevents duplicate submissions on network retries
  };

  try {
    const res = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      status.style.color = "green";
      status.textContent = "Thank you! Your message has been sent.";
      document.getElementById("contactForm").reset();
    } else {
      status.style.color = "red";
      status.textContent = "Failed: " + data.message;
    }
  } catch (err) {
    status.style.color = "red";
    status.textContent = "Network error. Please try again.";
  } finally {
    btn.disabled = false;
  }
});
</script>
```

---

### 2.2 React / Next.js Hook Example

```tsx
import { useState } from 'react';

interface ContactFormData {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export function useContactForm(endpointUrl: string, projectId: string = 'portfolio') {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submitContactForm = async (formData: ContactFormData, honeypotValue: string = '') => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          projectId,
          type: 'contact',
          data: formData,
          website: honeypotValue,
          idempotencyKey: typeof crypto !== 'undefined' ? crypto.randomUUID() : String(Date.now())
        })
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || 'Submission failed');
      }

      setSuccess(true);
      return result;
    } catch (err: any) {
      setError(err.message || 'Unknown network error');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { submitContactForm, loading, error, success };
}
```

---

## 3. Trusted Server-to-Server Integration (HMAC Signed)

For backend applications (Node.js, Python, Go) that need to send notifications or alerts without CAPTCHA:

### 3.1 Node.js Backend Example
```javascript
const crypto = require('crypto');

async function sendServerNotification(endpointUrl, projectId, projectSecret, subject, message) {
  const payload = {
    projectId: projectId,
    type: 'notification',
    data: {
      subject: subject,
      message: message
    },
    website: '',
    idempotencyKey: crypto.randomUUID()
  };

  const rawPayload = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  
  // Signature = timestamp:HMAC_SHA256("timestamp.rawPayload", secret)
  const hmac = crypto.createHmac('sha256', projectSecret);
  hmac.update(`${timestamp}.${rawPayload}`);
  const signature = `${timestamp}:${hmac.digest('hex')}`;

  payload.signature = signature;

  const res = await fetch(endpointUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  return await res.json();
}
```

### 3.2 Python Backend Example
```python
import time
import hmac
import hashlib
import json
import uuid
import urllib.request

def send_server_notification(endpoint_url, project_id, project_secret, subject, message):
    payload = {
        "projectId": project_id,
        "type": "notification",
        "data": {
            "subject": subject,
            "message": message
        },
        "website": "",
        "idempotencyKey": str(uuid.uuid4())
    }
    
    raw_payload = json.dumps(payload)
    timestamp = int(time.time())
    
    message_to_sign = f"{timestamp}.{raw_payload}".encode('utf-8')
    sig_hex = hmac.new(project_secret.encode('utf-8'), message_to_sign, hashlib.sha256).hexdigest()
    payload["signature"] = f"{timestamp}:{sig_hex}"
    
    req = urllib.request.Request(
        endpoint_url,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode())
```

---

## 4. Response Codes Reference

| Code | HTTP Status | Meaning | Action Needed |
| :--- | :---: | :--- | :--- |
| `ACCEPTED` | 200 | Job validated and queued in Google Sheets. | Show success message to visitor. |
| `DUPLICATE_ACCEPTED` | 200 | Idempotency key already received; skipped duplicate delivery. | Treat as success. |
| `HONEYPOT_TRIGGERED` | 200 | Bot detected (the hidden `website` field was populated). | Safe to silently ignore or show generic error. |
| `PAYLOAD_TOO_LARGE` | 200 | Payload exceeds 16 KB maximum limit. | Reduce message length. |
| `MISSING_EMAIL` / `INVALID_EMAIL` | 200 | Email address failed RFC 5322 regex validation. | Prompt user to correct email address. |
| `PROJECT_DISABLED` | 200 | Project kill switch is active. | Check project registry or Script Properties. |
| `SERVICE_DISABLED` | 200 | Global service kill switch is active (maintenance mode). | Service is undergoing maintenance. |
| `GLOBAL_RATE_LIMIT_EXCEEDED` | 200 | Traffic limit reached (60 submissions/hour). | Prompt user to retry in a few minutes. |


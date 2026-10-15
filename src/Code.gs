/**
 * Code.gs - Main entry point for Google Apps Script Web App (doPost, doGet).
 * Implements strict JSON responses, minimal public health disclosure,
 * Honeypot, CAPTCHA, Project authorization, Rate limiting, and Queue dispatch.
 */

var VERSION = '1.0.0';

/**
 * Standardized JSON response helper.
 * Note: Apps Script ContentService serves 200 with JSON payload due to platform redirects.
 * Clients inspect the 'success' and 'code' fields.
 */
function createJsonResponse(data) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * Public GET handler - exposes only non-sensitive health metadata.
 * Never leaks configuration, secrets, spreadsheet IDs, or queue contents.
 */
function doGet(e) {
  var isEnabled = Config.isServiceEnabled();
  return createJsonResponse({
    success: true,
    service: 'Centralized Secure Email Service',
    version: VERSION,
    status: isEnabled ? 'ONLINE' : 'MAINTENANCE',
    timestamp: new Date().toISOString()
  });
}

/**
 * Public POST handler - processes submissions and enqueues them for delivery.
 */
function doPost(e) {
  // 1. Check Global Service Kill Switch
  if (!Config.isServiceEnabled()) {
    Queue.logEvent('SUBMISSION_REJECTED', '', '', 'REJECTED', 'SERVICE_DISABLED', 'Global service kill switch active.');
    return createJsonResponse({
      success: false,
      code: 'SERVICE_DISABLED',
      message: 'Email service is temporarily offline for maintenance.'
    });
  }

  // 2. Validate Raw HTTP Request and parse JSON
  var rawResult = Validation.validateRawRequest(e);
  if (!rawResult.valid) {
    Queue.logEvent('REQUEST_VALIDATION_FAILED', '', '', 'REJECTED', rawResult.code, rawResult.message);
    return createJsonResponse({
      success: false,
      code: rawResult.code,
      message: rawResult.message
    });
  }

  var payload = rawResult.payload;

  // 3. Server-side validation of submission data & project
  var valResult = Validation.validateSubmission(payload);
  if (!valResult.valid) {
    Queue.logEvent('SUBMISSION_VALIDATION_FAILED', payload.projectId || '', '', 'REJECTED', valResult.code, valResult.message);
    return createJsonResponse({
      success: false,
      code: valResult.code,
      message: valResult.message
    });
  }

  var clean = valResult.cleanSubmission;
  var project = clean.project;

  // 4. Client Authentication / Authorization check
  if (project.clientType === 'trusted') {
    // Requires server-to-server HMAC signature
    var signature = (e.parameter && e.parameter.signature) || (payload.signature);
    var projectSecret = Config.getProperty('PROJECT_' + clean.projectId.toUpperCase() + '_SECRET', '');
    if (!projectSecret || !Security.verifyServerSignature(rawResult.rawContents, signature, projectSecret, 300)) {
      Queue.logEvent('AUTH_FAILURE', clean.projectId, '', 'REJECTED', 'UNAUTHORIZED_TRUSTED_CLIENT', 'Invalid or missing signature.');
      return createJsonResponse({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Invalid or missing server-to-server signature.'
      });
    }
  } else {
    // Public browser client: Verify CAPTCHA
    if (project.requireCaptcha !== false) {
      var captchaResult = Captcha.verify(clean.captchaToken, clean.type);
      if (!captchaResult.success) {
        Queue.logEvent('CAPTCHA_FAILED', clean.projectId, '', 'REJECTED', captchaResult.code, captchaResult.message);
        return createJsonResponse({
          success: false,
          code: captchaResult.code,
          message: captchaResult.message
        });
      }
    }
  }

  // 5. Rate Limiting (Sender, Project, Global)
  var globalRl = RateLimiter.checkGlobalRateLimit();
  if (!globalRl.allowed) {
    Queue.logEvent('RATE_LIMIT_EXCEEDED', clean.projectId, '', 'REJECTED', 'GLOBAL_RATE_LIMIT', 'Global rate limit reached.');
    return createJsonResponse({
      success: false,
      code: 'GLOBAL_RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please try again later.'
    });
  }

  var projectRl = RateLimiter.checkProjectRateLimit(clean.projectId, project.maxSubmissionsPerWindow || 20, project.rateLimitWindowSec || 3600);
  if (!projectRl.allowed) {
    Queue.logEvent('RATE_LIMIT_EXCEEDED', clean.projectId, '', 'REJECTED', 'PROJECT_RATE_LIMIT', 'Project rate limit reached.');
    return createJsonResponse({
      success: false,
      code: 'PROJECT_RATE_LIMIT_EXCEEDED',
      message: 'Rate limit exceeded for project ' + clean.projectId + '. Please wait before retrying.'
    });
  }

  if (clean.data && clean.data.email) {
    var senderRl = RateLimiter.checkSenderRateLimit(clean.data.email);
    if (!senderRl.allowed) {
      Queue.logEvent('RATE_LIMIT_EXCEEDED', clean.projectId, '', 'REJECTED', 'SENDER_RATE_LIMIT', 'Sender rate limit reached.');
      return createJsonResponse({
        success: false,
        code: 'SENDER_RATE_LIMIT_EXCEEDED',
        message: 'Too many messages from this email address. Please wait before retrying.'
      });
    }
  }

  // 6. Enqueue message into persistent Google Sheets Queue
  var enqueueResult = Queue.enqueue(clean, rawResult.rawContents);
  if (!enqueueResult.success) {
    Queue.logEvent('QUEUE_WRITE_FAILED', clean.projectId, '', 'FAILED', enqueueResult.code, enqueueResult.message);
    return createJsonResponse({
      success: false,
      code: enqueueResult.code,
      message: enqueueResult.message
    });
  }

  // Return success response with tracking job ID
  return createJsonResponse({
    success: true,
    code: enqueueResult.duplicate ? 'DUPLICATE_ACCEPTED' : 'ACCEPTED',
    jobId: enqueueResult.jobId,
    status: enqueueResult.status,
    message: enqueueResult.duplicate ? 'Submission previously accepted with this idempotencyKey.' : 'Submission accepted and queued for delivery.'
  });
}


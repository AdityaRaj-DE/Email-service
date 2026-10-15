/**
 * Validation.gs - Rigorous input validation and sanity checking.
 * Treats all visitor input as untrusted.
 */

var Validation = (function() {
  // RFC 5322 standard compliant basic regex for email
  var EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  /**
   * Validates raw HTTP event object.
   */
  function validateRawRequest(e) {
    if (!e || !e.postData) {
      return { valid: false, code: 'EMPTY_POST_DATA', message: 'Request must be a POST with payload data.' };
    }

    var contentLength = e.postData.length;
    var maxBytes = Config.getMaxPayloadBytes();
    if (contentLength > maxBytes) {
      return { valid: false, code: 'PAYLOAD_TOO_LARGE', message: 'Request payload exceeds maximum allowed size of ' + maxBytes + ' bytes.' };
    }

    var contents = e.postData.contents;
    if (!contents || typeof contents !== 'string' || contents.trim() === '') {
      return { valid: false, code: 'EMPTY_BODY', message: 'Request body is empty.' };
    }

    var parsed;
    try {
      parsed = JSON.parse(contents);
    } catch (err) {
      return { valid: false, code: 'MALFORMED_JSON', message: 'Invalid JSON payload.' };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { valid: false, code: 'INVALID_JSON_ROOT', message: 'JSON payload must be a JSON object.' };
    }

    return { valid: true, payload: parsed, rawContents: contents };
  }

  /**
   * Validates parsed submission object according to business rules.
   */
  function validateSubmission(payload) {
    // 1. Honeypot check: website field must be strictly empty
    if (payload.website !== undefined && payload.website !== null && String(payload.website).trim() !== '') {
      return { valid: false, code: 'HONEYPOT_TRIGGERED', message: 'Bot activity detected.' };
    }

    // 2. Project ID validation
    if (!payload.projectId || typeof payload.projectId !== 'string' || payload.projectId.trim() === '') {
      return { valid: false, code: 'MISSING_PROJECT_ID', message: 'Missing or invalid projectId.' };
    }
    var cleanProjectId = payload.projectId.trim().toLowerCase();
    var project = ProjectRegistry.getProject(cleanProjectId);
    if (!project) {
      return { valid: false, code: 'INVALID_PROJECT_ID', message: 'Unrecognized projectId.' };
    }
    if (!project.enabled) {
      return { valid: false, code: 'PROJECT_DISABLED', message: 'Project submissions are currently disabled.' };
    }

    // 3. Message Type validation
    if (!payload.type || typeof payload.type !== 'string' || payload.type.trim() === '') {
      return { valid: false, code: 'MISSING_TYPE', message: 'Missing message type.' };
    }
    var cleanType = payload.type.trim().toLowerCase();
    if (project.allowedTypes.indexOf(cleanType) === -1) {
      return { valid: false, code: 'UNSUPPORTED_TYPE', message: 'Message type ' + cleanType + ' is not permitted for project ' + cleanProjectId + '.' };
    }

    // 4. Data object validation
    if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
      return { valid: false, code: 'INVALID_DATA', message: 'data property must be an object.' };
    }

    var data = payload.data;
    var limits = Config.DEFAULTS.MAX_FIELD_LENGTHS;

    // Contact form specific fields
    if (cleanType === 'contact') {
      // Name
      if (!data.name || typeof data.name !== 'string' || data.name.trim() === '') {
        return { valid: false, code: 'MISSING_NAME', message: 'Field data.name is required.' };
      }
      var cleanName = Security.sanitizeHeader(data.name);
      if (cleanName.length > limits.name) {
        return { valid: false, code: 'NAME_TOO_LONG', message: 'Field data.name exceeds maximum length of ' + limits.name + ' characters.' };
      }

      // Email
      if (!data.email || typeof data.email !== 'string' || data.email.trim() === '') {
        return { valid: false, code: 'MISSING_EMAIL', message: 'Field data.email is required.' };
      }
      var cleanEmail = Security.sanitizeHeader(data.email).toLowerCase();
      if (cleanEmail.length > limits.email || !EMAIL_REGEX.test(cleanEmail)) {
        return { valid: false, code: 'INVALID_EMAIL', message: 'Field data.email is not a valid email address.' };
      }

      // Subject
      if (!data.subject || typeof data.subject !== 'string' || data.subject.trim() === '') {
        return { valid: false, code: 'MISSING_SUBJECT', message: 'Field data.subject is required.' };
      }
      var cleanSubject = Security.sanitizeHeader(data.subject);
      if (cleanSubject.length > limits.subject) {
        return { valid: false, code: 'SUBJECT_TOO_LONG', message: 'Field data.subject exceeds maximum length of ' + limits.subject + ' characters.' };
      }

      // Message
      if (!data.message || typeof data.message !== 'string' || data.message.trim() === '') {
        return { valid: false, code: 'MISSING_MESSAGE', message: 'Field data.message is required.' };
      }
      var rawMessage = String(data.message).trim();
      if (rawMessage.length > limits.message) {
        return { valid: false, code: 'MESSAGE_TOO_LONG', message: 'Field data.message exceeds maximum length of ' + limits.message + ' characters.' };
      }

      // Cleaned validated contact data
      data = {
        name: cleanName,
        email: cleanEmail,
        subject: cleanSubject,
        message: rawMessage // will be HTML-escaped during template rendering
      };
    } else if (cleanType === 'notification') {
      if (!data.subject || typeof data.subject !== 'string' || data.subject.trim() === '') {
        return { valid: false, code: 'MISSING_SUBJECT', message: 'Field data.subject is required.' };
      }
      if (!data.message || typeof data.message !== 'string' || data.message.trim() === '') {
        return { valid: false, code: 'MISSING_MESSAGE', message: 'Field data.message is required.' };
      }
      data = {
        name: data.name ? Security.sanitizeHeader(data.name).substring(0, limits.name) : cleanProjectId,
        email: data.email ? Security.sanitizeHeader(data.email).toLowerCase().substring(0, limits.email) : 'system@' + cleanProjectId + '.local',
        subject: Security.sanitizeHeader(data.subject).substring(0, limits.subject),
        message: String(data.message).trim().substring(0, limits.message)
      };
    }

    // 5. Idempotency Key validation
    var idempotencyKey = null;
    if (payload.idempotencyKey) {
      if (typeof payload.idempotencyKey !== 'string') {
        return { valid: false, code: 'INVALID_IDEMPOTENCY_KEY', message: 'idempotencyKey must be a string.' };
      }
      idempotencyKey = payload.idempotencyKey.trim().substring(0, limits.idempotencyKey);
    }

    return {
      valid: true,
      cleanSubmission: {
        projectId: cleanProjectId,
        project: project,
        type: cleanType,
        data: data,
        captchaToken: payload.captchaToken ? String(payload.captchaToken).trim() : null,
        idempotencyKey: idempotencyKey
      }
    };
  }

  return {
    validateRawRequest: validateRawRequest,
    validateSubmission: validateSubmission
  };
})();


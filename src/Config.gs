/**
 * Config.gs - Centralized configuration, defaults, and script properties manager.
 * All access to PropertiesService and runtime limits is coordinated here.
 */

var Config = (function() {
  // Built-in hard limits and defaults
  var DEFAULTS = {
    SERVICE_ENABLED: 'true',
    SENDING_ENABLED: 'true',
    BATCH_SIZE: 5,
    MAX_ATTEMPTS: 5,
    GLOBAL_PENDING_CAP: 100,
    PROJECT_PENDING_CAP: 20,
    MAX_PAYLOAD_BYTES: 16384, // 16 KB max POST body
    MAX_FIELD_LENGTHS: {
      name: 100,
      email: 254,
      subject: 200,
      message: 4000,
      idempotencyKey: 128
    },
    // Backoff in seconds: 60s, 300s (5m), 1800s (30m), 7200s (2h), 28800s (8h)
    INITIAL_RETRY_DELAY_SEC: 60,
    MAX_RETRY_DELAY_SEC: 28800,
    LOCK_TIMEOUT_MS: 15000,
    RETENTION_SENT_DAYS: 30,
    RETENTION_DEAD_LETTER_DAYS: 60,
    CAPTCHA_ENABLED: 'false', // Default off so service works immediately without captcha credentials
    CAPTCHA_PROVIDER: 'none', // Set to 'turnstile', 'recaptcha_v2', or 'recaptcha_v3' when enabled
    CAPTCHA_MIN_SCORE: 0.5 // for reCAPTCHA v3
  };

  /**
   * Retrieves a Script Property with fallback to default.
   */
  function getProperty(key, defaultValue) {
    try {
      var props = PropertiesService.getScriptProperties();
      var val = props ? props.getProperty(key) : null;
      if (val !== null && val !== undefined && val !== '') {
        return val;
      }
    } catch (e) {
      // Return default if PropertiesService is not accessible or during testing
    }
    return defaultValue !== undefined ? defaultValue : (DEFAULTS[key] !== undefined ? DEFAULTS[key] : null);
  }

  function getNumericProperty(key, defaultValue) {
    var raw = getProperty(key, defaultValue);
    var num = parseInt(raw, 10);
    return isNaN(num) ? defaultValue : num;
  }

  function getBooleanProperty(key, defaultValue) {
    var raw = getProperty(key, defaultValue);
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'string') {
      var lower = raw.trim().toLowerCase();
      return lower === 'true' || lower === '1' || lower === 'yes';
    }
    return !!defaultValue;
  }

  return {
    DEFAULTS: DEFAULTS,
    getProperty: getProperty,
    getNumericProperty: getNumericProperty,
    getBooleanProperty: getBooleanProperty,

    isServiceEnabled: function() {
      return getBooleanProperty('SERVICE_ENABLED', true);
    },

    isSendingEnabled: function() {
      return getBooleanProperty('SENDING_ENABLED', true);
    },

    getSpreadsheetId: function() {
      return getProperty('SPREADSHEET_ID', '');
    },

    getDestinationEmail: function() {
      return getProperty('DESTINATION_EMAIL', '');
    },

    getCaptchaSecret: function() {
      return getProperty('CAPTCHA_SECRET', '');
    },

    getCaptchaProvider: function() {
      return getProperty('CAPTCHA_PROVIDER', DEFAULTS.CAPTCHA_PROVIDER);
    },

    isCaptchaEnabled: function() {
      return getBooleanProperty('CAPTCHA_ENABLED', false);
    },

    getBatchSize: function() {
      return getNumericProperty('BATCH_SIZE', DEFAULTS.BATCH_SIZE);
    },

    getMaxAttempts: function() {
      return getNumericProperty('MAX_ATTEMPTS', DEFAULTS.MAX_ATTEMPTS);
    },

    getGlobalPendingCap: function() {
      return getNumericProperty('GLOBAL_PENDING_CAP', DEFAULTS.GLOBAL_PENDING_CAP);
    },

    getProjectPendingCap: function() {
      return getNumericProperty('PROJECT_PENDING_CAP', DEFAULTS.PROJECT_PENDING_CAP);
    },

    getMaxPayloadBytes: function() {
      return getNumericProperty('MAX_PAYLOAD_BYTES', DEFAULTS.MAX_PAYLOAD_BYTES);
    },

    getLockTimeoutMs: function() {
      return getNumericProperty('LOCK_TIMEOUT_MS', DEFAULTS.LOCK_TIMEOUT_MS);
    },

    getRetentionSentDays: function() {
      return getNumericProperty('RETENTION_SENT_DAYS', DEFAULTS.RETENTION_SENT_DAYS);
    },

    getRetentionDeadLetterDays: function() {
      return getNumericProperty('RETENTION_DEAD_LETTER_DAYS', DEFAULTS.RETENTION_DEAD_LETTER_DAYS);
    }
  };
})();


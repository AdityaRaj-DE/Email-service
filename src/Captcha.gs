/**
 * Captcha.gs - Server-side CAPTCHA verification via UrlFetchApp.
 * Supports Cloudflare Turnstile, Google reCAPTCHA v2 / v3, and fail-closed security.
 */

var Captcha = (function() {
  /**
   * Verifies CAPTCHA token with the configured provider.
   * Fails closed if token is missing or verification fails.
   */
  function verify(token, expectedAction) {
    var isCaptchaEnabled = Config.isCaptchaEnabled();
    var secret = Config.getCaptchaSecret();
    var provider = Config.getCaptchaProvider();

    // If CAPTCHA is explicitly disabled by administrator config
    if (!isCaptchaEnabled || provider === 'none') {
      return { success: true, bypassed: true, reason: 'CAPTCHA disabled by server configuration.' };
    }

    // Fail closed if CAPTCHA is required but secret is not set
    if (!secret || secret.trim() === '') {
      return {
        success: false,
        code: 'CAPTCHA_SECRET_NOT_CONFIGURED',
        message: 'Server error: CAPTCHA verification is required but CAPTCHA_SECRET is not configured. Failing closed.'
      };
    }

    // Fail closed if token is missing or empty
    if (!token || typeof token !== 'string' || token.trim() === '') {
      return {
        success: false,
        code: 'CAPTCHA_TOKEN_MISSING',
        message: 'A valid CAPTCHA token must be provided.'
      };
    }

    var trimmedToken = token.trim();
    var verifyUrl = '';
    var payloadObj = {};

    if (provider === 'turnstile') {
      verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
      payloadObj = {
        secret: secret,
        response: trimmedToken
      };
    } else if (provider === 'recaptcha_v2' || provider === 'recaptcha_v3') {
      verifyUrl = 'https://www.google.com/recaptcha/api/siteverify';
      payloadObj = {
        secret: secret,
        response: trimmedToken
      };
    } else {
      return {
        success: false,
        code: 'UNSUPPORTED_CAPTCHA_PROVIDER',
        message: 'Configured CAPTCHA provider ' + provider + ' is not supported.'
      };
    }

    try {
      var options = {
        method: 'post',
        payload: payloadObj,
        muteHttpExceptions: true
      };

      var response = UrlFetchApp.fetch(verifyUrl, options);
      var responseCode = response.getResponseCode();
      if (responseCode !== 200) {
        return {
          success: false,
          code: 'CAPTCHA_HTTP_ERROR',
          message: 'Upstream CAPTCHA verification service returned HTTP ' + responseCode
        };
      }

      var result = JSON.parse(response.getContentText());
      if (!result || !result.success) {
        return {
          success: false,
          code: 'CAPTCHA_VERIFICATION_FAILED',
          message: 'CAPTCHA verification failed.',
          errorCodes: result ? result['error-codes'] : null
        };
      }

      // If reCAPTCHA v3, check minimum score and action
      if (provider === 'recaptcha_v3') {
        var minScore = Config.DEFAULTS.CAPTCHA_MIN_SCORE;
        if (result.score !== undefined && result.score < minScore) {
          return {
            success: false,
            code: 'CAPTCHA_LOW_SCORE',
            message: 'CAPTCHA score below acceptable threshold (' + result.score + ' < ' + minScore + ').'
          };
        }
        if (expectedAction && result.action && result.action !== expectedAction) {
          return {
            success: false,
            code: 'CAPTCHA_ACTION_MISMATCH',
            message: 'CAPTCHA action mismatch.'
          };
        }
      }

      return {
        success: true,
        provider: provider,
        hostname: result.hostname || null,
        timestamp: result.challenge_ts || null
      };

    } catch (err) {
      return {
        success: false,
        code: 'CAPTCHA_FETCH_EXCEPTION',
        message: 'Exception during CAPTCHA verification: ' + err.message
      };
    }
  }

  return {
    verify: verify
  };
})();


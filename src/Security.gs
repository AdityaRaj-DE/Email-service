/**
 * Security.gs - HTML escaping, sanitization, header injection prevention,
 * hashing, and security token / signature validation.
 */

var Security = (function() {
  /**
   * HTML escape user-supplied strings to prevent HTML injection in emails and logs.
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    var s = String(str);
    return s.replace(/[&<>"']/g, function(match) {
      switch (match) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#39;';
        default: return match;
      }
    });
  }

  /**
   * Strips CR and LF characters to prevent Email Header Injection in subjects/names.
   */
  function sanitizeHeader(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[\r\n\t]/g, ' ').trim();
  }

  /**
   * Computes a SHA-256 hash of a string payload using Utilities.computeDigest or fallback.
   */
  function computeHash(str) {
    if (str === null || str === undefined) return '';
    try {
      if (typeof Utilities !== 'undefined' && Utilities.computeDigest) {
        var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(str), Utilities.Charset.UTF_8);
        var hex = '';
        for (var i = 0; i < rawHash.length; i++) {
          var byteVal = rawHash[i];
          if (byteVal < 0) byteVal += 256;
          var byteHex = byteVal.toString(16);
          if (byteHex.length === 1) byteHex = '0' + byteHex;
          hex += byteHex;
        }
        return hex;
      }
    } catch (e) {
      // Fallback in case of mock/non-Apps Script environment
    }
    // Simple deterministic hash fallback if Utilities is missing (for unit tests without mock)
    var hash = 0;
    for (var j = 0; j < str.length; j++) {
      var char = str.charCodeAt(j);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return 'fallback_' + Math.abs(hash).toString(16);
  }

  /**
   * Generates a unique, collision-resistant job ID.
   */
  function generateJobId() {
    var timestamp = new Date().getTime().toString(36);
    var randomPart = Math.random().toString(36).substring(2, 10);
    return 'job_' + timestamp + '_' + randomPart;
  }

  /**
   * Validates server-to-server HMAC signature for trusted non-browser clients.
   * Format:
   * Header or field X-Signature: timestamp:hex_signature
   * Signature is HMAC-SHA256 of "timestamp.payload" using project secret.
   * Replay protection: rejects requests older than maxAgeSec (default 300s).
   */
  function verifyServerSignature(rawPayload, signatureHeader, secret, maxAgeSec) {
    if (!signatureHeader || !secret) return false;
    var parts = signatureHeader.split(':');
    if (parts.length !== 2) return false;
    var timestamp = parseInt(parts[0], 10);
    var clientSig = parts[1];
    if (isNaN(timestamp)) return false;

    var now = Math.floor(new Date().getTime() / 1000);
    var allowedWindow = maxAgeSec || 300;
    if (Math.abs(now - timestamp) > allowedWindow) {
      return false; // Replay window exceeded
    }

    var messageToSign = timestamp + '.' + rawPayload;
    try {
      if (typeof Utilities !== 'undefined' && Utilities.computeHmacSha256Signature) {
        var expectedBytes = Utilities.computeHmacSha256Signature(messageToSign, secret);
        var expectedHex = '';
        for (var i = 0; i < expectedBytes.length; i++) {
          var b = expectedBytes[i];
          if (b < 0) b += 256;
          var h = b.toString(16);
          if (h.length === 1) h = '0' + h;
          expectedHex += h;
        }
        return expectedHex.toLowerCase() === clientSig.toLowerCase();
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  return {
    escapeHtml: escapeHtml,
    sanitizeHeader: sanitizeHeader,
    computeHash: computeHash,
    generateJobId: generateJobId,
    verifyServerSignature: verifyServerSignature
  };
})();


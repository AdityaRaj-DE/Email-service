/**
 * RateLimiter.gs - Short-term memory caching and rate limit tracking.
 * Uses CacheService for fast disposable checks, while queue persistence provides durable caps.
 */

var RateLimiter = (function() {
  /**
   * Checks and updates submission count for an identity/project in CacheService.
   * Note: CacheService is best-effort and disposable, not durable persistence.
   */
  function checkRateLimit(key, maxRequests, windowSec) {
    try {
      if (typeof CacheService === 'undefined' || !CacheService.getScriptCache) {
        return { allowed: true }; // Fallback if CacheService not available
      }
      var cache = CacheService.getScriptCache();
      var cacheKey = 'rl_' + Security.computeHash(key).substring(0, 32);
      var currentCountStr = cache.get(cacheKey);
      var count = currentCountStr ? parseInt(currentCountStr, 10) : 0;

      if (count >= maxRequests) {
        return {
          allowed: false,
          current: count,
          limit: maxRequests,
          retryAfterSec: windowSec
        };
      }

      // Increment count and store with windowSec expiration (max CacheService TTL is 21600s = 6h)
      var ttl = Math.min(Math.max(windowSec, 60), 21600);
      cache.put(cacheKey, String(count + 1), ttl);
      return { allowed: true, current: count + 1, limit: maxRequests };
    } catch (e) {
      // In case CacheService fails or is unavailable, fail open for short-term rate limit cache
      // because durable queue caps in Sheets provide hard bounds.
      return { allowed: true, error: e.message };
    }
  }

  /**
   * Rate limits by sender email to prevent flood from a single address.
   */
  function checkSenderRateLimit(email) {
    return checkRateLimit('sender:' + email.toLowerCase(), 5, 3600); // 5 per hour per email
  }

  /**
   * Rate limits by project identifier.
   */
  function checkProjectRateLimit(projectId, maxRequests, windowSec) {
    return checkRateLimit('project:' + projectId, maxRequests, windowSec);
  }

  /**
   * Rate limits globally across the service.
   */
  function checkGlobalRateLimit() {
    return checkRateLimit('global_submissions', 60, 3600); // 60 per hour globally
  }

  return {
    checkSenderRateLimit: checkSenderRateLimit,
    checkProjectRateLimit: checkProjectRateLimit,
    checkGlobalRateLimit: checkGlobalRateLimit
  };
})();


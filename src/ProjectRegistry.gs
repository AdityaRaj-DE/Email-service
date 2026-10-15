/**
 * ProjectRegistry.gs - Server-controlled project registry, policies, and rate limits.
 * Public project IDs are identifiers, not authentication tokens.
 */

var ProjectRegistry = (function() {
  /**
   * Default built-in registry of known projects.
   * Can be augmented or overridden via Script Properties (PROJECT_REGISTRY_JSON).
   */
  var DEFAULT_REGISTRY = {
    portfolio: {
      name: 'Personal Portfolio Contact Form',
      enabled: true,
      allowedTypes: ['contact'],
      maxPending: 20,
      clientType: 'public', // 'public' requires CAPTCHA + honeypot; 'trusted' requires server signature
      requireCaptcha: true,
      rateLimitWindowSec: 3600, // 1 hour window
      maxSubmissionsPerWindow: 20
    },
    dotup_v3: {
      name: 'DotUp V3 App',
      enabled: true,
      allowedTypes: ['contact', 'notification'],
      maxPending: 30,
      clientType: 'public',
      requireCaptcha: true,
      rateLimitWindowSec: 3600,
      maxSubmissionsPerWindow: 30
    },
    internal_service: {
      name: 'Internal Server-to-Server Service',
      enabled: true,
      allowedTypes: ['notification', 'alert'],
      maxPending: 50,
      clientType: 'trusted', // server-to-server HMAC authenticated
      requireCaptcha: false,
      rateLimitWindowSec: 3600,
      maxSubmissionsPerWindow: 100
    }
  };

  /**
   * Retrieves full project registry merged with any custom JSON from Script Properties.
   */
  function getRegistry() {
    var registry = JSON.parse(JSON.stringify(DEFAULT_REGISTRY));
    try {
      var customJson = Config.getProperty('PROJECT_REGISTRY_JSON', null);
      if (customJson) {
        var custom = JSON.parse(customJson);
        for (var key in custom) {
          if (custom.hasOwnProperty(key)) {
            registry[key] = Object.assign(registry[key] || {}, custom[key]);
          }
        }
      }
    } catch (e) {
      // If custom JSON is malformed, use defaults safely
    }
    return registry;
  }

  /**
   * Gets project configuration by ID.
   * Also checks per-project kill switch: PROJECT_<ID>_ENABLED
   */
  function getProject(projectId) {
    if (!projectId || typeof projectId !== 'string') return null;
    var registry = getRegistry();
    var project = registry[projectId.trim().toLowerCase()];
    if (!project) return null;

    // Check individual per-project kill switch
    var killSwitchKey = 'PROJECT_' + projectId.trim().toUpperCase() + '_ENABLED';
    var isEnabled = Config.getBooleanProperty(killSwitchKey, project.enabled !== false);
    
    var projCopy = Object.assign({}, project);
    projCopy.enabled = isEnabled;
    return projCopy;
  }

  return {
    DEFAULT_REGISTRY: DEFAULT_REGISTRY,
    getRegistry: getRegistry,
    getProject: getProject
  };
})();


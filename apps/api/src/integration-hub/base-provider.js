// =====================================================
// Base Integration Provider
// Abstract class for all integration providers
// =====================================================

export class BaseIntegrationProvider {
  constructor(config, logger = console) {
    this.config = config;
    this.logger = logger;
    this.name = 'BaseProvider';
  }

  // ============= Core Methods (must override) =============

  async authenticate() {
    throw new Error('authenticate() must be implemented by subclass');
  }

  async testConnection() {
    throw new Error('testConnection() must be implemented by subclass');
  }

  async fetchData(options = {}) {
    throw new Error('fetchData() must be implemented by subclass');
  }

  async sendData(payload) {
    throw new Error('sendData() must be implemented by subclass');
  }

  async handleWebhook(payload, signature) {
    throw new Error('handleWebhook() must be implemented by subclass');
  }

  // ============= OAuth Methods (optional, override if provider uses OAuth) =============

  /**
   * Start OAuth 2.0 flow
   * @param {string} callbackUrl - URL to redirect after authorization
   * @param {object} options - OAuth options (scopes, etc.)
   * @returns {object} { authUrl, state }
   */
  async startOAuthFlow(callbackUrl, options = {}) {
    throw new Error('startOAuthFlow() not implemented for this provider');
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code from OAuth provider
   * @param {string} state - State token for CSRF validation
   * @param {object} options - Additional options
   * @returns {object} { accessToken, refreshToken, expiresIn, tokenType, scope }
   */
  async exchangeCodeForToken(code, state, options = {}) {
    throw new Error('exchangeCodeForToken() not implemented for this provider');
  }

  /**
   * Refresh expired access token
   * @param {string} refreshToken - Refresh token
   * @returns {object} { accessToken, expiresIn, tokenType }
   */
  async refreshToken(refreshToken) {
    throw new Error('refreshToken() not implemented for this provider');
  }

  /**
   * Revoke OAuth token
   * @param {string} token - Access token to revoke
   * @returns {boolean} True if revoked successfully
   */
  async revokeToken(token) {
    throw new Error('revokeToken() not implemented for this provider');
  }

  // ============= Common Utilities =============

  /**
   * Normalize phone number to standard format
   * Removes all non-digits, handles country code
   */
  normalizePhone(phone) {
    if (!phone) return null;
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length < 10) return null;
    // Remove leading 0 if country code present (India: +91)
    if (cleaned.length === 12 && cleaned.startsWith('91')) return cleaned;
    if (cleaned.length === 11 && cleaned.startsWith('0')) return cleaned.substring(1);
    if (cleaned.length === 10) return cleaned;
    return cleaned.slice(-10);
  }

  /**
   * Normalize email
   */
  normalizeEmail(email) {
    if (!email) return null;
    return email.toLowerCase().trim();
  }

  /**
   * Check for retryable error
   */
  isRetryableError(error) {
    const retryableCodes = [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'rate_limit',
      'too_many_requests',
      'service_unavailable',
      'temporary_failure'
    ];

    return retryableCodes.some(code =>
      error.code === code ||
      error.message.includes(code) ||
      error.message.includes('429') ||
      error.message.includes('503') ||
      error.message.includes('timeout')
    );
  }

  /**
   * Calculate exponential backoff delay
   */
  calculateBackoffDelay(attemptNumber) {
    const baseDelay = 1000 * Math.pow(2, attemptNumber - 1);
    const jitter = Math.random() * 1000;
    return baseDelay + jitter;
  }

  /**
   * Mask sensitive data for logging
   */
  maskSensitiveData(obj, fieldsToMask = ['accessToken', 'apiKey', 'password', 'secret']) {
    if (!obj || typeof obj !== 'object') return obj;

    const masked = { ...obj };
    fieldsToMask.forEach(field => {
      if (field in masked) {
        const value = String(masked[field]);
        masked[field] = value.substring(0, 4) + '****' + value.substring(value.length - 4);
      }
    });
    return masked;
  }

  /**
   * Log operation with context
   */
  log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const maskedData = this.maskSensitiveData(data);
    const logEntry = {
      timestamp,
      provider: this.name,
      level,
      message,
      data: maskedData
    };

    if (this.logger[level]) {
      this.logger[level](JSON.stringify(logEntry));
    } else {
      console.log(JSON.stringify(logEntry));
    }
  }

  /**
   * Format error response
   */
  formatError(error) {
    return {
      code: error.code || 'unknown_error',
      message: error.message,
      isRetryable: this.isRetryableError(error),
      details: error.details || null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Validate configuration
   */
  validateConfig(requiredFields = []) {
    const missing = requiredFields.filter(field => !this.config[field]);
    if (missing.length > 0) {
      throw new Error(`Missing required configuration: ${missing.join(', ')}`);
    }
  }

  /**
   * Map CRM field to external field using field mappings
   */
  mapCrmToExternal(crmData, fieldMappings) {
    const externalData = {};
    fieldMappings.forEach(mapping => {
      if (crmData[mapping.crm_field] !== undefined) {
        externalData[mapping.external_field] = crmData[mapping.crm_field];
      }
    });
    return externalData;
  }

  /**
   * Map external field to CRM field
   */
  mapExternalToCrm(externalData, fieldMappings) {
    const crmData = {};
    fieldMappings.forEach(mapping => {
      if (externalData[mapping.external_field] !== undefined) {
        crmData[mapping.crm_field] = externalData[mapping.external_field];
      }
    });
    return crmData;
  }

  /**
   * Apply transformation rule to field value
   */
  applyTransform(value, transformRule) {
    if (!transformRule || !value) return value;

    if (transformRule.type === 'uppercase') {
      return String(value).toUpperCase();
    }
    if (transformRule.type === 'lowercase') {
      return String(value).toLowerCase();
    }
    if (transformRule.type === 'trim') {
      return String(value).trim();
    }
    if (transformRule.type === 'phone') {
      return this.normalizePhone(value);
    }
    if (transformRule.type === 'email') {
      return this.normalizeEmail(value);
    }
    if (transformRule.type === 'date') {
      return new Date(value).toISOString().split('T')[0];
    }
    if (transformRule.type === 'regex') {
      const regex = new RegExp(transformRule.pattern, transformRule.flags || '');
      return String(value).replace(regex, transformRule.replacement || '');
    }
    return value;
  }

  /**
   * Build pagination metadata
   */
  buildPaginationMeta(page, pageSize, total) {
    return {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      hasMore: page * pageSize < total,
      offset: (page - 1) * pageSize
    };
  }
}

/**
 * Integration error class
 */
export class IntegrationError extends Error {
  constructor(message, code = 'integration_error', statusCode = 400, details = null) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.name = 'IntegrationError';
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends IntegrationError {
  constructor(message = 'Authentication failed', details = null) {
    super(message, 'auth_failure', 401, details);
    this.name = 'AuthenticationError';
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends IntegrationError {
  constructor(message = 'Rate limit exceeded', retryAfter = 60, details = null) {
    super(message, 'rate_limit', 429, details);
    this.retryAfter = retryAfter;
    this.name = 'RateLimitError';
  }
}

/**
 * Validation error
 */
export class ValidationError extends IntegrationError {
  constructor(message = 'Validation failed', details = null) {
    super(message, 'validation_error', 400, details);
    this.name = 'ValidationError';
  }
}

// =====================================================
// OAuth State Manager
// Manages OAuth state tokens for CSRF prevention
// =====================================================

import { generateOAuthState, generatePKCEVerifier } from './crypto-utils.js';

/**
 * OAuth state manager
 * Stores and validates OAuth state tokens to prevent CSRF attacks
 * In production, use Redis or database instead of memory
 */
export class OAuthStateManager {
  constructor(ttlSeconds = 600) {
    // TTL = 10 minutes (600 seconds)
    this.ttlSeconds = ttlSeconds;
    this.states = new Map(); // state → { data, expiresAt }
  }

  /**
   * Create new OAuth state
   * @param {object} data - State data to store (integrationId, userId, etc.)
   * @returns {object} { state, expiresAt }
   */
  createState(data = {}) {
    const state = generateOAuthState();
    const expiresAt = Date.now() + this.ttlSeconds * 1000;

    this.states.set(state, {
      data,
      expiresAt,
      createdAt: Date.now()
    });

    return {
      state,
      expiresAt: new Date(expiresAt).toISOString()
    };
  }

  /**
   * Validate and retrieve state data
   * @param {string} state - State token to validate
   * @returns {object} State data if valid
   * @throws {Error} If state is invalid or expired
   */
  validateState(state) {
    if (!state) {
      throw new Error('State token is required');
    }

    const stateRecord = this.states.get(state);

    if (!stateRecord) {
      throw new Error('Invalid state token - not found');
    }

    // Check expiration
    if (Date.now() > stateRecord.expiresAt) {
      this.states.delete(state);
      throw new Error('State token expired');
    }

    // Remove state after validation (one-time use)
    this.states.delete(state);

    return stateRecord.data;
  }

  /**
   * Clean up expired states
   * Call periodically to prevent memory leaks
   */
  cleanupExpiredStates() {
    const now = Date.now();
    let cleaned = 0;

    for (const [state, record] of this.states.entries()) {
      if (now > record.expiresAt) {
        this.states.delete(state);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Get statistics
   * @returns {object} State manager stats
   */
  getStats() {
    return {
      activeStates: this.states.size,
      ttlSeconds: this.ttlSeconds
    };
  }

  /**
   * Clear all states (for testing)
   */
  clear() {
    this.states.clear();
  }
}

/**
 * OAuth flow data manager
 * Stores temporary data during OAuth flow (access tokens, refresh tokens, etc.)
 * In production, use database with proper cleanup
 */
export class OAuthFlowDataManager {
  constructor(ttlSeconds = 3600) {
    // TTL = 1 hour (3600 seconds)
    this.ttlSeconds = ttlSeconds;
    this.flows = new Map(); // flowId → { data, expiresAt }
  }

  /**
   * Create new OAuth flow
   * @param {string} integrationId - Integration ID
   * @param {object} flowData - Flow data (redirectUri, scopes, etc.)
   * @returns {string} Flow ID
   */
  createFlow(integrationId, flowData = {}) {
    const flowId = `flow_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const expiresAt = Date.now() + this.ttlSeconds * 1000;

    this.flows.set(flowId, {
      integrationId,
      data: flowData,
      expiresAt,
      createdAt: Date.now()
    });

    return flowId;
  }

  /**
   * Get flow data
   * @param {string} flowId - Flow ID
   * @returns {object} Flow data
   * @throws {Error} If flow not found or expired
   */
  getFlow(flowId) {
    const flow = this.flows.get(flowId);

    if (!flow) {
      throw new Error('OAuth flow not found');
    }

    if (Date.now() > flow.expiresAt) {
      this.flows.delete(flowId);
      throw new Error('OAuth flow expired');
    }

    return flow;
  }

  /**
   * Update flow data
   * @param {string} flowId - Flow ID
   * @param {object} updates - Updates to merge
   */
  updateFlow(flowId, updates) {
    const flow = this.getFlow(flowId);
    flow.data = { ...flow.data, ...updates };
  }

  /**
   * Delete flow (clean up after completion)
   * @param {string} flowId - Flow ID
   */
  deleteFlow(flowId) {
    this.flows.delete(flowId);
  }

  /**
   * Clean up expired flows
   */
  cleanupExpiredFlows() {
    const now = Date.now();
    let cleaned = 0;

    for (const [flowId, flow] of this.flows.entries()) {
      if (now > flow.expiresAt) {
        this.flows.delete(flowId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      activeFlows: this.flows.size,
      ttlSeconds: this.ttlSeconds
    };
  }

  /**
   * Clear all flows (for testing)
   */
  clear() {
    this.flows.clear();
  }
}

/**
 * PKCE flow manager
 * Manages PKCE (Proof Key for Public Clients) for enhanced OAuth security
 */
export class PKCEFlowManager {
  constructor(ttlSeconds = 600) {
    this.ttlSeconds = ttlSeconds;
    this.verifiers = new Map(); // state → { verifier, challenge, expiresAt }
  }

  /**
   * Create PKCE verifier and challenge
   * @returns {object} { verifier, challenge, state }
   */
  createVerifier() {
    const verifier = generatePKCEVerifier();

    return {
      verifier,
      state: generateOAuthState()
    };
  }

  /**
   * Store verifier for later validation
   * @param {string} state - State token
   * @param {string} verifier - PKCE verifier
   */
  storeVerifier(state, verifier) {
    const expiresAt = Date.now() + this.ttlSeconds * 1000;

    this.verifiers.set(state, {
      verifier,
      expiresAt,
      createdAt: Date.now()
    });
  }

  /**
   * Retrieve and validate verifier
   * @param {string} state - State token
   * @returns {string} PKCE verifier
   * @throws {Error} If verifier not found or expired
   */
  getVerifier(state) {
    const record = this.verifiers.get(state);

    if (!record) {
      throw new Error('PKCE verifier not found');
    }

    if (Date.now() > record.expiresAt) {
      this.verifiers.delete(state);
      throw new Error('PKCE verifier expired');
    }

    // Remove after retrieval (one-time use)
    this.verifiers.delete(state);

    return record.verifier;
  }

  /**
   * Clean up expired verifiers
   */
  cleanupExpiredVerifiers() {
    const now = Date.now();
    let cleaned = 0;

    for (const [state, record] of this.verifiers.entries()) {
      if (now > record.expiresAt) {
        this.verifiers.delete(state);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      activeVerifiers: this.verifiers.size,
      ttlSeconds: this.ttlSeconds
    };
  }

  /**
   * Clear all verifiers (for testing)
   */
  clear() {
    this.verifiers.clear();
  }
}

/**
 * Global OAuth state manager instances
 * In production, replace with Redis or database
 */
const stateManager = new OAuthStateManager(600); // 10 minutes
const flowDataManager = new OAuthFlowDataManager(3600); // 1 hour
const pkceManager = new PKCEFlowManager(600); // 10 minutes

// Cleanup expired data every 5 minutes
setInterval(() => {
  stateManager.cleanupExpiredStates();
  flowDataManager.cleanupExpiredFlows();
  pkceManager.cleanupExpiredVerifiers();
}, 5 * 60 * 1000);

export { stateManager, flowDataManager, pkceManager };

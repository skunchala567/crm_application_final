// =====================================================
// Integration Service
// Main facade orchestrating all integration operations
// =====================================================

import {
  IntegrationRepository,
  OAuthTokenRepository,
  SyncJobRepository,
  SyncLogRepository,
  FieldMappingRepository,
  ErrorLogRepository,
  AuditLogRepository
} from './repositories.js';

import axios from 'axios';
import crypto from 'node:crypto';
import { encryptToken, decryptToken, getMasterKey } from './crypto-utils.js';
import { stateManager } from './oauth-state-manager.js';
import { SyncEngine } from './sync-engine.js';

export class IntegrationHubService {
  constructor(pool, logger = console) {
    this.pool = pool;
    this.logger = logger;

    // Initialize repositories (CONSOLIDATED: single integrations table)
    this.configs = new IntegrationRepository(pool);
    this.oauthTokens = new OAuthTokenRepository(pool);
    this.syncJobs = new SyncJobRepository(pool);
    this.syncLogs = new SyncLogRepository(pool);
    this.fieldMappings = new FieldMappingRepository(pool);
    this.errors = new ErrorLogRepository(pool);
    this.audit = new AuditLogRepository(pool);
    this.syncEngine = new SyncEngine(pool, logger);

    // Provider registry (to be populated by provider implementations)
    this.providers = new Map();
  }

  // Helper to safely log errors without circular references
  safeLogError(message, error) {
    const errorMsg = error?.message || String(error) || 'Unknown error';
    const errorStatus = error?.response?.status || null;
    this.logger.error(message, { message: errorMsg, status: errorStatus });
  }

  // Helper to safely get normalized provider name
  getNormalizedProviderName(config) {
    if (!config || !config.provider_name) {
      throw new Error('Configuration missing provider_name. Ensure migration 005 has been applied.');
    }
    return config.provider_name.toLowerCase().includes('google') ? 'google_sheets' : config.provider_name;
  }

  // ============= Integration Management =============

  async listIntegrations(organizationId, filters = {}) {
    try {
      return await this.configs.list(organizationId, filters);
    } catch (error) {
      this.logger.error('Error listing integrations', error);
      throw error;
    }
  }

  async getIntegration(integrationId, organizationId) {
    try {
      return await this.configs.getById(integrationId, organizationId);
    } catch (error) {
      this.logger.error('Error getting integration', error);
      throw error;
    }
  }

  async createIntegration(organizationId, integrationData, createdById) {
    try {
      // Validate required fields
      if (!integrationData.integrationName || !integrationData.integrationType || !integrationData.providerName) {
        const error = new Error('Missing required fields: integrationName, integrationType, providerName');
        error.status = 400;
        throw error;
      }

      // Validate organizationId
      if (!organizationId) {
        const error = new Error('Organization ID is required');
        error.status = 400;
        throw error;
      }

      // Note: Provider registration is optional during creation
      // Providers will be validated when actually using the integration (OAuth, sync, test, etc.)
      // This allows creating integration configs that will work once the provider is registered

      const config = await this.configs.create({
        organizationId: organizationId,
        integrationName: integrationData.integrationName,
        integrationType: integrationData.integrationType,
        providerName: integrationData.providerName,
        config: integrationData.config || {},
        createdById: createdById || null,  // Ensure not undefined
        status: 'pending_auth'
      });

      // Audit log
      await this.audit.log(config.id, {
        action: 'created',
        newValues: { type: config.integration_type, provider: config.provider_name },
        createdById
      });

      return config;
    } catch (error) {
      this.logger.error('Error creating integration', error);
      throw error;
    }
  }

  async updateIntegration(integrationId, organizationId, updateData, userId) {
    try {
      const oldConfig = await this.configs.getById(integrationId, organizationId);
      if (!oldConfig) throw new Error('Integration not found');

      // Use provided values or keep existing ones
      const updatePayload = {
        integrationName: 'integrationName' in updateData ? updateData.integrationName : oldConfig.integration_name,
        config: 'config' in updateData ? updateData.config : oldConfig.config,
        status: 'status' in updateData ? updateData.status : oldConfig.status
      };

      // Debug logging for Smartping credentials
      if (updatePayload.config?.projectApiPassword) {
        this.logger.log('[Smartping Config] Storing API password:', {
          passwordLength: updatePayload.config.projectApiPassword.length,
          projectId: updatePayload.config.projectId
        });
      }

      const updated = await this.configs.update(integrationId, organizationId, updatePayload);

      // Audit log (skip if audit log fails)
      try {
        await this.audit.log(integrationId, {
          action: 'config_updated',
          oldValues: oldConfig.config,
          newValues: updated.config,
          createdById: userId || null
        });
      } catch (auditError) {
        this.logger.error('Audit log failed (non-blocking)', { message: auditError.message });
      }

      return updated;
    } catch (error) {
      this.logger.error('Error updating integration', error);
      throw error;
    }
  }

  async deleteIntegration(integrationId, organizationId, userId) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      await this.configs.delete(integrationId, organizationId);

      // Audit log
      await this.audit.log(integrationId, {
        action: 'disconnected',
        notes: 'Integration disabled',
        createdById: userId
      });

      return true;
    } catch (error) {
      this.logger.error('Error deleting integration', error);
      throw error;
    }
  }

  // ============= Connection Testing =============

  async testConnection(integrationId, organizationId) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      // Normalize provider name (with safety check for undefined)
      if (!config.provider_name) {
        throw new Error(`Integration missing provider_name. Ensure migration 005 has been applied and provider_name is set.`);
      }
      const providerName = this.getNormalizedProviderName(config);
      const provider = this.getProvider(providerName);
      if (!provider) throw new Error(`Provider ${config.provider_name} not registered`);

      // Get OAuth token if exists
      let oauthToken = await this.oauthTokens.get(integrationId);

      // Decrypt access token if it exists
      let decryptedAccessToken = null;
      if (oauthToken?.access_token) {
        const masterKey = getMasterKey();
        try {
          decryptedAccessToken = decryptToken(oauthToken.access_token, masterKey);
        } catch (err) {
          this.logger.error('Failed to decrypt access token', err);
          throw new Error('Failed to decrypt access token');
        }
      }

      // Build provider config based on provider type
      let providerConfig;
      if (providerName === 'smartping') {
        // Smartping doesn't use OAuth, just pass the config
        providerConfig = config.config;
      } else {
        // Google Sheets and other OAuth providers
        providerConfig = { ...config.config };
      }

      // Initialize provider with appropriate parameters
      const providerInstance = providerName === 'smartping'
        ? new provider(providerConfig, this.logger)
        : new provider(providerConfig, decryptedAccessToken, this.logger);

      // Test connection
      let result;
      try {
        result = await providerInstance.testConnection();
      } catch (testError) {
        // If 401 (unauthorized), try to refresh token for Google Sheets
        if (testError.message?.includes('401') && providerName === 'google_sheets' && oauthToken?.refresh_token) {
          this.logger.info('Token expired, attempting refresh...');
          try {
            await this.refreshOAuthToken(integrationId, organizationId);
            // Retry test with new token
            oauthToken = await this.oauthTokens.get(integrationId);
            if (oauthToken?.access_token) {
              const masterKey = getMasterKey();
              decryptedAccessToken = decryptToken(oauthToken.access_token, masterKey);
              const newProviderInstance = new provider(providerConfig, decryptedAccessToken, this.logger);
              result = await newProviderInstance.testConnection();
            } else {
              throw testError;
            }
          } catch (refreshError) {
            this.logger.error('Token refresh failed', refreshError);
            throw new Error('OAuth token expired and refresh failed. Please re-authorize.');
          }
        } else {
          throw testError;
        }
      }

      // Update status
      await this.configs.updateSyncStatus(integrationId, organizationId, {
        status: 'active',
        lastErrorMessage: null,
        lastSyncedAt: null,
        nextSyncAt: null
      });

      // Audit log
      await this.audit.log(integrationId, {
        action: 'tested',
        notes: 'Connection test successful',
        createdById: null
      });

      return result;
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      this.logger.error('Connection test failed', { message: errorMsg });

      // Update error status
      await this.configs.updateSyncStatus(integrationId, organizationId, {
        status: 'error',
        lastErrorMessage: error.message,
        lastSyncedAt: null,
        nextSyncAt: null
      });

      throw error;
    }
  }

  // ============= OAuth Management =============

  async startOAuthFlow(integrationId, organizationId, callbackUrl, options = {}) {
    try {
      this.logger.log('Starting OAuth flow', { integrationId, organizationId });

      if (!integrationId) {
        throw new Error('integrationId is required to start OAuth flow');
      }

      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error(`Integration ${integrationId} not found for organization ${organizationId}`);

      // Normalize provider name (handle both 'google_sheets' and 'Google Sheets API v4')
      const providerName = this.getNormalizedProviderName(config);

      // Check if this provider supports OAuth
      const oauthProviders = ['google_sheets'];
      if (!oauthProviders.includes(providerName)) {
        throw new Error(`Provider ${providerName} does not support OAuth. Use direct authorization (/hub/integrations/{id}/auth/start) instead.`);
      }

      const provider = this.getProvider(providerName);
      if (!provider) throw new Error(`Provider ${config.provider_name} not registered. Available: ${Array.from(this.providers.keys()).join(', ')}`);

      // Build provider config with OAuth credentials from environment
      const providerConfig = { ...config.config };

      const providerInstance = new provider(providerConfig, null, this.logger);
      let expectedAccountEmail = config.config?.googleAccountEmail || null;
      if (options.confirmAccount && !expectedAccountEmail) {
        try {
          const currentAccessToken = await this.getValidAccessToken(integrationId, organizationId);
          const profile = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${currentAccessToken}` }
          });
          expectedAccountEmail = String(profile.data?.email || '').trim().toLowerCase() || null;
          if (expectedAccountEmail) {
            await this.configs.update(integrationId, organizationId, {
              integrationName: config.integration_name,
              config: { ...config.config, googleAccountEmail: expectedAccountEmail },
              status: config.status
            });
          }
        } catch (profileError) {
          // Older grants do not include identity scopes. Re-consent below upgrades
          // the grant and stores the selected account after the callback.
          this.logger.warn('Existing Google grant has no identity scope; requesting re-consent');
        }
      }

      // Generate state token
      const stateToken = stateManager.createState({
        integrationId,
        organizationId,
        returnTo: options.returnTo || '/settings/google-sheets',
        confirmAccount: Boolean(options.confirmAccount),
        expectedAccountEmail: options.confirmAccount ? expectedAccountEmail : null,
        createdAt: new Date().toISOString()
      });

      // Generate OAuth URL
      const { authUrl } = await providerInstance.startOAuthFlow(callbackUrl, {
        state: stateToken.state,
        loginHint: expectedAccountEmail
      });

      // Audit log
      await this.audit.log(integrationId, {
        action: 'oauth_started',
        notes: `OAuth flow initiated`,
        createdById: null
      });

      return { authUrl, state: stateToken.state };
    } catch (error) {
      this.logger.error('OAuth flow initiation failed', error);
      throw error;
    }
  }

  async completeOAuthFlow(integrationId, organizationId, code, state, validatedState = null) {
    let actualIntegrationId = integrationId; // Define at function level for catch block access
    try {
      // Validate state token (prevents CSRF) - attempt to get integrationId from state
      try {
        const stateData = validatedState || stateManager.validateState(state);
        if (stateData?.integrationId) {
          actualIntegrationId = stateData.integrationId;
        }
      } catch (stateError) {
        this.logger.warn('State validation failed (may be expected in development)', stateError.message);
        // Continue with the provided integrationId - in production use database for state storage
      }

      const config = await this.configs.getById(actualIntegrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      // Normalize provider name
      const providerName = this.getNormalizedProviderName(config);

      // Check if this provider supports OAuth
      const oauthProviders = ['google_sheets'];
      if (!oauthProviders.includes(providerName)) {
        throw new Error(`Provider ${providerName} does not support OAuth. Use direct authorization instead.`);
      }

      const provider = this.getProvider(providerName);
      if (!provider) throw new Error(`Provider ${config.provider_name} not registered. Available: ${Array.from(this.providers.keys()).join(', ')}`);

      // Build provider config with OAuth credentials from environment
      const providerConfig = { ...config.config };

      // Get access token via provider
      const providerInstance = new provider(providerConfig, null, this.logger);
      const tokenData = await providerInstance.exchangeCodeForToken(code, state);
      const profileResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const googleAccountEmail = String(profileResponse.data?.email || '').trim().toLowerCase();
      const expectedAccountEmail = String(validatedState?.expectedAccountEmail || config.config?.googleAccountEmail || '').trim().toLowerCase();
      if (validatedState?.confirmAccount && expectedAccountEmail && googleAccountEmail !== expectedAccountEmail) {
        throw new Error(`You do not have authorization to this Google account. Please sign in as ${expectedAccountEmail}.`);
      }

      // Log the token data for debugging
      this.logger.log('Token data received:', {
        access_token: tokenData.access_token ? '[encrypted]' : 'missing',
        refresh_token: tokenData.refresh_token ? '[encrypted]' : 'null',
        token_type: tokenData.token_type,
        expires_in: tokenData.expires_in,
        expires_at: tokenData.expires_at,
        scope: tokenData.scope
      });

      // Encrypt tokens before storage
      const masterKey = getMasterKey();

      // Convert expires_at or expires_in to MySQL datetime format
      let expiresAt = null;
      if (tokenData.expires_at) {
        // If it's a number (Unix timestamp in seconds), convert to milliseconds
        const timestamp = typeof tokenData.expires_at === 'number'
          ? tokenData.expires_at * 1000
          : new Date(tokenData.expires_at).getTime();
        const date = new Date(timestamp);
        expiresAt = date.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
      } else if (tokenData.expires_in) {
        // Google returns expires_in (seconds from now)
        const expiresInMs = tokenData.expires_in * 1000;
        const date = new Date(Date.now() + expiresInMs);
        expiresAt = date.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
      } else {
        // Default to 1 hour from now
        const date = new Date(Date.now() + 3600000);
        expiresAt = date.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
      }

      const encryptedTokenData = {
        providerName: config.provider_name || null,
        accessToken: tokenData.access_token ? encryptToken(tokenData.access_token, masterKey) : null,
        refreshToken: tokenData.refresh_token ? encryptToken(tokenData.refresh_token, masterKey) : null,
        tokenType: tokenData.token_type || 'Bearer',
        expiresAt: expiresAt,
        scope: tokenData.scope ? tokenData.scope : null
      };

      this.logger.log('Encrypted token data prepared:', { keys: Object.keys(encryptedTokenData) });

      // Store encrypted token
      this.logger.log('Saving OAuth token for integration:', { actualIntegrationId, organizationId });
      await this.oauthTokens.save(actualIntegrationId, encryptedTokenData);
      await this.configs.update(actualIntegrationId, organizationId, {
        integrationName: config.integration_name,
        config: { ...config.config, googleAccountEmail },
        status: config.status
      });
      this.logger.log('OAuth token saved successfully');

      // Update integration status
      this.logger.log('Updating integration status:', { actualIntegrationId, organizationId, status: 'active' });
      await this.configs.updateSyncStatus(actualIntegrationId, organizationId || 1, {
        status: 'active',
        lastErrorMessage: null,
        lastSyncedAt: null,
        nextSyncAt: null
      });
      this.logger.log('Integration status updated successfully');

      // Audit log
      this.logger.log('Creating audit log for authorization');
      await this.audit.log(actualIntegrationId, {
        action: 'authorized',
        notes: 'OAuth token obtained and encrypted',
        createdById: null
      });
      this.logger.log('Audit log created successfully');

      return { success: true, message: 'Authorization successful', integrationConfigId: actualIntegrationId, googleAccountEmail };
    } catch (error) {
      this.logger.error('OAuth flow completion failed', error);

      await this.configs.updateSyncStatus(actualIntegrationId || integrationId, organizationId, {
        status: 'error',
        lastErrorMessage: error.message,
        lastSyncedAt: null,
        nextSyncAt: null
      });

      throw error;
    }
  }

  async refreshOAuthToken(integrationId, organizationId) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      const oauthToken = await this.oauthTokens.get(integrationId);
      if (!oauthToken?.refresh_token) {
        throw new Error('No refresh token available');
      }

      // Decrypt refresh token
      const masterKey = getMasterKey();
      let decryptedRefreshToken;
      try {
        decryptedRefreshToken = decryptToken(oauthToken.refresh_token, masterKey);
      } catch (error) {
        // Token might not be encrypted (old data)
        decryptedRefreshToken = oauthToken.refresh_token;
      }

      // Normalize provider name
      const providerName = this.getNormalizedProviderName(config);
      const provider = this.getProvider(providerName);
      const decryptedAccessToken = decryptToken(oauthToken.access_token, masterKey);

      // Build provider config with OAuth credentials from environment
      const providerConfig = { ...config.config };

      const providerInstance = new provider(providerConfig, decryptedAccessToken, this.logger);

      // Refresh token via provider
      const newTokenData = await providerInstance.refreshToken(decryptedRefreshToken);

      // Encrypt new tokens
      const expiresAt = new Date(Date.now() + Number(newTokenData.expires_in || 3600) * 1000)
        .toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
      const encryptedTokenData = {
        providerName: config.provider_name,
        accessToken: encryptToken(newTokenData.access_token, masterKey),
        refreshToken: newTokenData.refresh_token
          ? encryptToken(newTokenData.refresh_token, masterKey)
          : oauthToken.refresh_token,
        tokenType: newTokenData.token_type || oauthToken.token_type || 'Bearer',
        expiresAt,
        scope: newTokenData.scope || oauthToken.scope || null
      };

      // Update stored token
      await this.oauthTokens.save(integrationId, encryptedTokenData);

      // Audit log
      await this.audit.log(integrationId, {
        action: 'token_refreshed',
        notes: 'OAuth token refreshed',
        createdById: null
      });

      return { success: true, message: 'Token refreshed' };
    } catch (error) {
      this.logger.error('Token refresh failed', error);

      await this.configs.updateSyncStatus(integrationId, organizationId, {
        status: 'error',
        lastErrorMessage: 'Token refresh failed: ' + error.message,
        lastSyncedAt: null,
        nextSyncAt: null
      });

      throw error;
    }
  }

  async getValidAccessToken(integrationId, organizationId, forceRefresh = false) {
    let oauthToken = await this.oauthTokens.get(integrationId);
    if (!oauthToken?.access_token) throw new Error('No OAuth token available. Please authorize first.');
    const expiresAt = oauthToken.expires_at ? new Date(oauthToken.expires_at).getTime() : 0;
    if (forceRefresh || (expiresAt && expiresAt <= Date.now() + 60000)) {
      await this.refreshOAuthToken(integrationId, organizationId);
      oauthToken = await this.oauthTokens.get(integrationId);
    }
    const masterKey = getMasterKey();
    try {
      return decryptToken(oauthToken.access_token, masterKey);
    } catch {
      return oauthToken.access_token;
    }
  }

  async syncActiveSheetSources() {
    const [rows] = await this.pool.execute(
      `SELECT id, organization_id, config
       FROM crm_integrations
       WHERE provider='google_sheets' AND status IN ('CONNECTED','ACTIVE') AND deleted_at IS NULL`
    );
    const results = [];
    for (const row of rows) {
      const config = typeof row.config === 'string' ? JSON.parse(row.config || '{}') : (row.config || {});
      for (const source of (config.sheetSources || []).filter(item => item.status === 'active')) {
        try {
          const result = await this.importData(row.id, row.organization_id, {
            spreadsheetId: source.sheetId,
            branchId: source.branchId,
            fieldMappings: source.fieldMappings,
            sourceId: source.id,
            sourceName: source.sheetName,
            branchName: source.branchName,
            continuous: true
          });
          results.push({ integrationId: row.id, sourceId: source.id, success: true, result });
        } catch (error) {
          this.logger.error('Continuous Google Sheet import failed', {
            integrationId: row.id, sourceId: source.id, message: error.message
          });
          results.push({ integrationId: row.id, sourceId: source.id, success: false, error: error.message });
        }
      }
    }
    return results;
  }

  async disconnectOAuth(integrationId, organizationId, userId) {
    try {
      await this.oauthTokens.delete(integrationId);

      await this.configs.updateSyncStatus(integrationId, organizationId, {
        status: 'pending_auth',
        lastErrorMessage: null,
        lastSyncedAt: null,
        nextSyncAt: null
      });

      // Audit log
      await this.audit.log(integrationId, {
        action: 'disconnected',
        notes: 'OAuth authorization revoked',
        createdById: userId
      });

      return { success: true, message: 'Authorization revoked' };
    } catch (error) {
      this.logger.error('OAuth disconnection failed', error);
      throw error;
    }
  }

  // ============= Spreadsheet Management =============

  async listSpreadsheets(integrationId, organizationId) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      // Normalize provider name
      const providerName = this.getNormalizedProviderName(config);
      const provider = this.getProvider(providerName);
      if (!provider) throw new Error(`Provider ${config.provider_name} not registered`);

      // Build provider config with OAuth credentials from environment
      const providerConfig = { ...config.config };

      let accessToken = await this.getValidAccessToken(integrationId, organizationId);
      try {
        return await new provider(providerConfig, accessToken, this.logger).listSpreadsheets();
      } catch (error) {
        if (!/Invalid or expired access token|401|auth/i.test(error.message || '')) throw error;
        accessToken = await this.getValidAccessToken(integrationId, organizationId, true);
        return new provider(providerConfig, accessToken, this.logger).listSpreadsheets();
      }
    } catch (error) {
      this.logger.error('Failed to list spreadsheets', error);
      throw error;
    }
  }

  async selectSpreadsheet(integrationId, organizationId, sheetId, sheetName) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      // Update integration config with selected spreadsheet
      const updatedConfig = {
        ...config.config,
        spreadsheetId: sheetId,
        spreadsheetName: sheetName
      };

      await this.configs.update(integrationId, organizationId, {
        integrationName: config.integration_name,
        config: updatedConfig,
        status: config.status
      });

      // Audit log
      await this.audit.log(integrationId, {
        action: 'spreadsheet_selected',
        notes: `Selected spreadsheet: ${sheetName}`,
        createdById: null
      });

      return {
        integrationId,
        spreadsheetId: sheetId,
        spreadsheetName: sheetName,
        message: 'Spreadsheet selected successfully'
      };
    } catch (error) {
      this.logger.error('Failed to select spreadsheet', error);
      throw error;
    }
  }

  async listSheetSources(integrationId, organizationId) {
    const integration = await this.configs.getById(integrationId, organizationId);
    if (!integration) throw new Error('Integration not found');
    return integration.config?.sheetSources || [];
  }

  async addSheetSource(integrationId, organizationId, source) {
    const integration = await this.configs.getById(integrationId, organizationId);
    if (!integration) throw new Error('Integration not found');
    const branchId = Number(source.branchId);
    if (!source.sheetId || !source.sheetName || !Number.isInteger(branchId) || branchId <= 0) {
      throw new Error('Spreadsheet and branch are required');
    }
    const [[branch]] = await this.pool.execute(
      'SELECT id, branch_name AS name FROM branches WHERE id=? AND is_active=TRUE LIMIT 1',
      [branchId]
    );
    if (!branch) throw new Error('Selected branch is not available');
    const sources = [...(integration.config?.sheetSources || [])];
    if (sources.some(item => item.sheetId === source.sheetId && Number(item.branchId) === branchId)) {
      throw new Error('This spreadsheet is already configured for the selected branch');
    }
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sheetId: source.sheetId,
      sheetName: source.sheetName,
      branchId,
      branchName: branch.name,
      status: 'mapping_required',
      fieldMappings: {},
      createdAt: new Date().toISOString()
    };
    sources.push(item);
    await this.configs.update(integrationId, organizationId, {
      integrationName: integration.integration_name,
      config: {
        ...integration.config,
        sheetSources: sources,
        spreadsheetId: source.sheetId,
        spreadsheetName: source.sheetName
      },
      status: integration.status
    });
    return item;
  }

  async removeSheetSource(integrationId, organizationId, sourceId) {
    const integration = await this.configs.getById(integrationId, organizationId);
    if (!integration) throw new Error('Integration not found');
    const sources = (integration.config?.sheetSources || []).filter(item => item.id !== sourceId);
    await this.configs.update(integrationId, organizationId, {
      integrationName: integration.integration_name,
      config: { ...integration.config, sheetSources: sources },
      status: integration.status
    });
    return sources;
  }

  async getSheetSourceHistory(integrationId, organizationId, sourceId) {
    const integration = await this.configs.getById(integrationId, organizationId);
    if (!integration) throw new Error('Integration not found');
    const [rows] = await this.pool.execute(
      `SELECT l.id, l.sync_type, l.status, j.metadata,
              l.records_processed, l.records_created, l.records_updated, l.records_failed,
              j.started_at, j.completed_at, l.created_at, l.error_summary AS error_message
       FROM crm_integration_sync_logs l
       JOIN crm_integration_sync_jobs j ON j.id=l.sync_job_id
       WHERE l.integration_config_id=?
         AND l.records_created > 0
         AND JSON_UNQUOTE(JSON_EXTRACT(j.metadata, '$.sourceId'))=?
       ORDER BY l.created_at DESC LIMIT 50`,
      [integrationId, sourceId]
    );
    return rows;
  }

  async getSkippedSheetLeads(integrationId, organizationId) {
    const integration = await this.configs.getById(integrationId, organizationId);
    if (!integration) throw new Error('Integration not found');
    const [rows] = await this.pool.execute(
      `SELECT id, source_id AS sourceId, sheet_name AS sheetName, branch_id AS branchId,
              branch_name AS branchName, sheet_row_number AS rowNumber,
              student_name AS studentName, phone, reason,
              existing_lead_id AS existingLeadId, existing_lead_number AS existingLeadNumber,
              occurrence_count AS occurrenceCount, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt
       FROM crm_integration_skipped_leads
       WHERE integration_id=?
       ORDER BY last_seen_at DESC LIMIT 500`,
      [integrationId]
    );
    return rows;
  }

  async getSpreadsheetPreview(integrationId, organizationId, sheetId) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');
      if (config.provider_name !== 'google_sheets') throw new Error('Preview only available for Google Sheets');

      const oauthToken = await this.oauthTokens.get(integrationId);
      if (!oauthToken?.access_token) throw new Error('No OAuth token found');

      const decryptedAccessToken = await this.getValidAccessToken(integrationId, organizationId);

      try {
        // Fetch first 11 rows (header + 10 data rows) - use A:Z range to get all columns
        const response = await axios.get(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:Z11`,
          {
            headers: { Authorization: `Bearer ${decryptedAccessToken}` }
          }
        );

        const values = response.data.values || [];
        if (values.length === 0) {
          return { headers: [], rows: [] };
        }

        const headers = values[0];
        const rows = values.slice(1); // Everything except header row

        return { headers, rows };
      } catch (apiError) {
        if (apiError.response?.status === 400) {
          // Try with A:Z range for all sheets
          const response = await axios.get(
            `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:Z11`,
            {
              headers: { Authorization: `Bearer ${decryptedAccessToken}` }
            }
          );

          const values = response.data.values || [];
          if (values.length === 0) {
            return { headers: [], rows: [] };
          }

          const headers = values[0];
          const rows = values.slice(1);
          return { headers, rows };
        }
        throw apiError;
      }
    } catch (error) {
      this.logger.error('Failed to get spreadsheet preview', error.message);
      throw new Error(`Failed to load preview: ${error.message || 'Unknown error'}`);
    }
  }

  // ============= Field Mapping =============

  async getSheetHeaders(integrationId, organizationId, sheetId = null) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');
      const activeSheetId = sheetId || config.config?.spreadsheetId;
      if (!activeSheetId) throw new Error('No spreadsheet selected');

      // Normalize provider name
      const providerName = this.getNormalizedProviderName(config);
      const provider = this.getProvider(providerName);
      if (!provider) throw new Error(`Provider ${config.provider_name} not registered`);

      const oauthToken = await this.oauthTokens.get(integrationId);
      if (!oauthToken?.access_token) throw new Error('No OAuth token found');

      const decryptedAccessToken = await this.getValidAccessToken(integrationId, organizationId);

      // Fetch first row to get headers
      const response = await axios.get(
        `https://sheets.googleapis.com/v4/spreadsheets/${activeSheetId}/values/A1:Z1`,
        {
          headers: { Authorization: `Bearer ${decryptedAccessToken}` }
        }
      );

      const headers = (response.data.values?.[0] || []).map((header, idx) => ({
        index: idx,
        name: header || `Column ${idx + 1}`
      }));

      return headers;
    } catch (error) {
      this.logger.error('Failed to get sheet headers', error);
      throw error;
    }
  }

  async saveFieldMapping(integrationId, organizationId, mappings, sourceId = null) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      let updatedConfig;
      if (sourceId) {
        let found = false;
        const sheetSources = (config.config?.sheetSources || []).map(source => {
          if (source.id !== sourceId) return source;
          found = true;
          return { ...source, fieldMappings: mappings, status: 'active', activatedAt: new Date().toISOString() };
        });
        if (!found) throw new Error('Sheet source not found');
        updatedConfig = { ...config.config, sheetSources };
      } else {
        updatedConfig = { ...config.config, fieldMappings: mappings };
      }

      await this.configs.update(integrationId, organizationId, {
        integrationName: config.integration_name,
        config: updatedConfig,
        status: config.status
      });

      await this.audit.log(integrationId, {
        action: 'field_mapping_saved',
        notes: `Saved ${Object.keys(mappings).length} field mappings`,
        createdById: null
      });

      return { success: true, message: 'Field mappings saved successfully' };
    } catch (error) {
      this.logger.error('Failed to save field mapping', error);
      throw error;
    }
  }

  async getFieldMapping(integrationId, organizationId, sourceId = null) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      if (sourceId) {
        return (config.config?.sheetSources || []).find(source => source.id === sourceId)?.fieldMappings || {};
      }
      return config.config?.fieldMappings || {};
    } catch (error) {
      this.logger.error('Failed to get field mapping', error);
      throw error;
    }
  }

  // ============= Data Sync =============

  async importData(integrationId, organizationId) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      const oauthToken = await this.oauthTokens.get(integrationId);
      if (!oauthToken?.access_token) throw new Error('No OAuth token found');

      const masterKey = getMasterKey();
      const decryptedAccessToken = decryptToken(oauthToken.access_token, masterKey);

      // Perform import
      const result = await this.syncEngine.importFromSheets(
        integrationId,
        organizationId,
        decryptedAccessToken,
        config.config
      );

      // Update sync status
      await this.configs.updateSyncStatus(integrationId, organizationId, {
        status: 'active',
        lastErrorMessage: null,
        lastSyncedAt: new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0],
        nextSyncAt: null
      });

      // Audit log
      await this.audit.log(integrationId, {
        action: 'data_imported',
        notes: `Imported ${result.imported} leads`,
        createdById: null
      });

      return result;
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      this.safeLogError('Import data failed', error);

      await this.configs.updateSyncStatus(integrationId, organizationId, {
        status: 'error',
        lastErrorMessage: errorMsg,
        lastSyncedAt: null,
        nextSyncAt: null
      });

      throw error;
    }
  }

  async exportData(integrationId, organizationId) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      const oauthToken = await this.oauthTokens.get(integrationId);
      if (!oauthToken?.access_token) throw new Error('No OAuth token found');

      const masterKey = getMasterKey();
      const decryptedAccessToken = decryptToken(oauthToken.access_token, masterKey);

      // Perform export
      const result = await this.syncEngine.exportToSheets(
        integrationId,
        organizationId,
        decryptedAccessToken,
        config.config
      );

      // Update sync status
      await this.configs.updateSyncStatus(integrationId, organizationId, {
        status: 'active',
        lastErrorMessage: null,
        lastSyncedAt: new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0],
        nextSyncAt: null
      });

      // Audit log
      await this.audit.log(integrationId, {
        action: 'data_exported',
        notes: `Exported ${result.exported} leads`,
        createdById: null
      });

      return result;
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      this.safeLogError('Export data failed', error);

      await this.configs.updateSyncStatus(integrationId, organizationId, {
        status: 'error',
        lastErrorMessage: errorMsg,
        lastSyncedAt: null,
        nextSyncAt: null
      });

      throw error;
    }
  }

  // ============= Sync Operations =============

  async startSync(integrationId, organizationId, syncType = 'manual', options = {}, userId = null) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      // A manual sync is executed immediately. Persistence is handled by
      // importData only when the provider actually creates lead records.
      return await this.importData(integrationId, organizationId, {
        ...options,
        syncType,
        requestedById: userId
      });
    } catch (error) {
      this.logger.error('Error starting sync', error);
      throw error;
    }
  }

  async getSyncStatus(jobId) {
    try {
      const job = await this.syncJobs.getById(jobId);
      if (!job) throw new Error('Sync job not found');

      return {
        jobId: job.id,
        status: job.status,
        syncType: job.sync_type,
        progress: this.calculateProgress(job),
        recordsProcessed: job.records_processed,
        recordsCreated: job.records_created,
        recordsUpdated: job.records_updated,
        recordsFailed: job.records_failed,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        errorMessage: job.error_message
      };
    } catch (error) {
      this.logger.error('Error getting sync status', error);
      throw error;
    }
  }

  async getSyncHistory(integrationId, organizationId, filters = {}) {
    try {
      // Verify ownership
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      return await this.syncLogs.list(integrationId, filters);
    } catch (error) {
      this.logger.error('Error getting sync history', error);
      throw error;
    }
  }

  // ============= Field Mapping =============

  async getFieldMappings(integrationId, organizationId) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      const mappings = await this.fieldMappings.list(integrationId);
      return mappings;
    } catch (error) {
      this.logger.error('Error getting field mappings', error);
      throw error;
    }
  }

  async createFieldMapping(integrationId, organizationId, mappingData, userId) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      await this.fieldMappings.create({
        integrationConfigId: integrationId,
        ...mappingData
      });

      // Audit log
      await this.audit.log(integrationId, {
        action: 'field_mapping_created',
        newValues: mappingData,
        createdById: userId
      });

      return { success: true };
    } catch (error) {
      this.logger.error('Error creating field mapping', error);
      throw error;
    }
  }

  // ============= Error Management =============

  async getErrors(integrationId, organizationId) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      return await this.errors.list(integrationId, { resolved: false });
    } catch (error) {
      this.logger.error('Error getting errors', error);
      throw error;
    }
  }

  async resolveError(errorId, resolutionNotes) {
    try {
      await this.errors.resolve(errorId, resolutionNotes);
      return { success: true };
    } catch (error) {
      this.logger.error('Error resolving error', error);
      throw error;
    }
  }

  // ============= Audit Logs =============

  async getAuditLogs(integrationId, organizationId) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      return await this.audit.list(integrationId);
    } catch (error) {
      this.logger.error('Error getting audit logs', error);
      throw error;
    }
  }

  // ============= Provider Management =============

  registerProvider(providerName, providerClass) {
    this.providers.set(providerName, providerClass);
    this.logger.info(`Provider registered: ${providerName}`);
  }

  getProvider(providerName) {
    return this.providers.get(providerName);
  }

  listAvailableProviders() {
    return Array.from(this.providers.keys());
  }

  // ============= Integration-Specific Sync =============

  async importData(integrationId, organizationId, syncOptions = {}) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      // Normalize provider name
      const providerName = this.getNormalizedProviderName(config);
      const provider = this.getProvider(providerName);
      if (!provider) throw new Error(`Provider ${config.provider_name} not registered`);

      // Get OAuth token
      await this.getValidAccessToken(integrationId, organizationId);
      const oauthToken = await this.oauthTokens.get(integrationId);
      if (!oauthToken) throw new Error('No OAuth token available');

      try {
        // Perform import (this varies by provider)
        const syncService = new (await this.getProviderSyncService(config.provider_name))(this.pool, this.logger);
        const result = await syncService.importLeads(config, oauthToken, syncOptions);

        // Log sync (ensure all values are defined)
        const stats = {
          processed: (result.imported || 0) + (result.updated || 0) + (result.skipped || 0) + (result.failed || 0),
          created: result.imported || 0,
          updated: result.updated || 0,
          failed: result.failed || 0,
          skipped: result.skipped || 0
        };

        let jobId = null;
        if (stats.processed > 0) {
          const requestedType = syncOptions.syncType || (syncOptions.continuous ? 'scheduled' : 'manual');
          const syncType = ['manual', 'scheduled', 'webhook_triggered', 'retry'].includes(requestedType) ? requestedType : 'manual';
          const completed=stats.created+stats.updated;
          const outcome=stats.failed>0?(completed>0?'partial':'failed'):'success';
          const errorSummary=result.errors?.length?JSON.stringify(result.errors.slice(0,20)):null;
          jobId = await this.syncJobs.create({ integrationConfigId: integrationId, syncType, metadata: syncOptions });
          await this.syncJobs.markCompleted(jobId, outcome, {
            recordsProcessed: stats.processed,
            recordsCreated: stats.created,
            recordsUpdated: stats.updated,
            recordsFailed: stats.failed,
            errorMessage: errorSummary
          });
          if(stats.created>0)await this.audit.log(integrationId, {
            action: 'data_imported',
            notes: `Imported ${stats.created} leads`,
            recordCount: stats.created,
            createdById: syncOptions.requestedById || null
          });
          if (stats.created > 0) try {
            await this.syncLogs.create({
              integrationConfigId: integrationId,
              syncJobId: jobId,
              syncType,
              status: outcome,
              stats,
              errorSummary
            });
          } catch (logError) {
            this.logger.warn('Failed to create sync log', logError.message);
            // Don't fail the entire import just because logging failed
          }
        }

        const status=stats.failed>0?((stats.created+stats.updated)>0?'partial':'failed'):'success';
        return { jobId, status, result };
      } catch (error) {
        throw error;
      }
    } catch (error) {
      this.logger.error('Import failed', error);
      throw error;
    }
  }

  async exportData(integrationId, organizationId, syncOptions = {}) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      // Normalize provider name
      const providerName = this.getNormalizedProviderName(config);
      const provider = this.getProvider(providerName);
      if (!provider) throw new Error(`Provider ${config.provider_name} not registered`);

      // Get OAuth token
      const oauthToken = await this.oauthTokens.get(integrationId);
      if (!oauthToken) throw new Error('No OAuth token available');

      try {
        // Perform export (provider-specific)
        const syncService = new (await this.getProviderSyncService(config.provider_name))(this.pool, this.logger);
        const result = await syncService.exportLeads(config, oauthToken, syncOptions);

        let jobId = null;
        const exported = Number(result.exported || 0);
        if (exported > 0) {
          jobId = await this.syncJobs.create({ integrationConfigId: integrationId, syncType: 'manual', metadata: syncOptions });
          await this.syncJobs.markCompleted(jobId, 'success', {
            recordsProcessed: exported + Number(result.failed || 0),
            recordsCreated: exported,
            recordsUpdated: 0,
            recordsFailed: Number(result.failed || 0),
            errorMessage: null
          });
          await this.audit.log(integrationId, {
            action: 'data_exported',
            notes: `Exported ${exported} leads`,
            recordCount: exported,
            createdById: syncOptions.requestedById || null
          });
        }

        return { jobId, status: 'success', result };
      } catch (error) {
        throw error;
      }
    } catch (error) {
      this.logger.error('Export failed', error);
      throw error;
    }
  }

  /**
   * Get provider-specific sync service (dynamic import)
   */
  async getProviderSyncService(providerName) {
    try {
      if (providerName === 'google_sheets' || providerName === 'Google Sheets API v4') {
        const { GoogleSheetsSyncService } = await import('./providers/google-sheets-sync.js');
        return GoogleSheetsSyncService;
      }
      throw new Error(`No sync service for provider: ${providerName}`);
    } catch (error) {
      this.logger.error('Failed to load sync service', error);
      throw error;
    }
  }

  // ============= Helpers =============

  calculateProgress(job) {
    if (job.status === 'running') {
      return job.records_processed > 0 ? Math.round((job.records_processed / (job.records_processed + 100)) * 100) : 0;
    }
    if (job.status === 'success') return 100;
    if (job.status === 'failed') return 0;
    return 0;
  }

  // ============= Smartping Messaging =============

  async sendSmartpingMessage(integrationId, organizationId, phoneNumber, message, options = {}) {
    let localMessageId = null;
    const clientRequestId = options.clientRequestId || crypto.randomUUID();
    const phoneDigits = String(phoneNumber || '').replace(/\D/g, '');
    const normalizedPhone = /^91[6-9]\d{9}$/.test(phoneDigits) ? phoneDigits.slice(2) : phoneDigits;
    const startedAt = Date.now();
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');
      if (config.provider_name !== 'smartping') throw new Error('Integration is not Smartping');

      if (!phoneNumber) {
        throw new Error('Phone number is required');
      }

      if (!message) {
        throw new Error('Message is required');
      }

      const provider = this.getProvider(config.provider_name);
      if (!provider) throw new Error('Smartping provider not registered');

      const [existing] = await this.pool.query(
        `SELECT id, message_id, status FROM crm_whatsapp_messages
         WHERE client_request_id = ? LIMIT 1`,
        [clientRequestId]
      );
      if (existing.length) {
        return {
          success: !['FAILED', 'REJECTED'].includes(existing[0].status),
          duplicate: true,
          localMessageId: existing[0].id,
          messageId: existing[0].message_id,
          status: existing[0].status
        };
      }

      /* Outbound messages are sent from a lead screen, so the lead says which
         business the conversation belongs to. Without a lead it falls to the
         sender's active unit, and failing that the default one. */
      const [[outboundLead]] = options.leadId
        ? await this.pool.query('SELECT business_unit_id AS unitId FROM crm_leads WHERE id=?', [options.leadId])
        : [[]];
      const [[defaultUnit]] = (outboundLead?.unitId || options.businessUnitId) ? [[null]]
        : await this.pool.query('SELECT id FROM crm_business_units WHERE is_default=TRUE ORDER BY id LIMIT 1');
      const conversationUnitId = outboundLead?.unitId || options.businessUnitId || defaultUnit?.id || null;

      const [conversationResult] = await this.pool.query(
        `INSERT INTO crm_whatsapp_conversations
          (organization_id, business_unit_id, integration_id, mobile, contact_name, lead_id,
           last_message, last_message_time, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 'ACTIVE')
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           business_unit_id = COALESCE(business_unit_id, VALUES(business_unit_id)),
           contact_name = COALESCE(VALUES(contact_name), contact_name),
           lead_id = COALESCE(VALUES(lead_id), lead_id),
           last_message = VALUES(last_message),
           last_message_time = NOW(),
           updated_at = NOW()`,
        [
          organizationId,
          conversationUnitId,
          integrationId,
          normalizedPhone,
          options.userName || null,
          options.leadId || null,
          message
        ]
      );
      const conversationId = conversationResult.insertId;
      const [messageResult] = await this.pool.query(
        `INSERT INTO crm_whatsapp_messages
          (conversation_id, integration_id, lead_id, client_request_id,
           template_name, campaign_name, direction, type, message, media_url, caption, status)
         VALUES (?, ?, ?, ?, ?, ?, 'outgoing', ?, ?, ?, ?, 'PENDING')`,
        [
          conversationId,
          integrationId,
          options.leadId || null,
          clientRequestId,
          options.templateName || null,
          options.campaignName || null,
          options.media?.url ? 'media' : 'text',
          message,
          options.media?.url || null,
          options.caption || null
        ]
      );
      localMessageId = messageResult.insertId;

      const providerInstance = new provider({ ...config.config, integrationId }, this.logger);
      const result = await providerInstance.sendMessage(phoneNumber, message, {
        ...options,
        clientRequestId
      });
      const normalizedStatus = String(result.status || 'QUEUED').toUpperCase();
      await this.pool.query(
        `UPDATE crm_whatsapp_messages
         SET message_id = ?, status = ?, api_response = ?, http_status = ?,
             retry_count = ?, sent_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [
          result.messageId,
          normalizedStatus,
          JSON.stringify(result.response || {}),
          result.httpStatus || 200,
          result.retryCount || 0,
          localMessageId
        ]
      );
      await this.pool.query(
        `INSERT INTO crm_whatsapp_api_logs
          (integration_id, message_id, operation, request_url, request_headers,
           request_payload, response_status, response_body, response_time_ms,
           retry_count, created_at)
         VALUES (?, ?, 'send', ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          integrationId,
          localMessageId,
          '/messages',
          JSON.stringify({ 'Content-Type': 'application/json', authorization: '[REDACTED]' }),
          JSON.stringify({
            destination: normalizedPhone,
            templateName: options.templateName || null,
            templateParams: options.templateParams || [],
            media: options.media || null,
            clientRequestId
          }),
          result.httpStatus || 200,
          JSON.stringify(result.response || {}),
          result.responseTimeMs || Date.now() - startedAt,
          result.retryCount || 0
        ]
      );
      await this.pool.execute(
        `INSERT INTO crm_smartping_messages
          (id, message_id, project_id, integration_id, phone_number, contact_id,
           sender, message_type, message_content, campaign_name, status, is_hsm,
           sent_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'AGENT', 'TEXT', ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = NOW()`,
        [
          `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          result.messageId,
          config.config?.projectId || config.config?.project_id,
          integrationId,
          phoneNumber.replace(/\D/g, ''),
          options.leadId ? String(options.leadId) : null,
          JSON.stringify({ body: message, templateName: options.templateName || null }),
          options.templateName || null,
          String(result.status || 'SENT').toUpperCase(),
          !!options.templateName
        ]
      );

      await this.audit.log(integrationId, {
        action: 'message_sent',
        notes: `Smartping message sent to ${phoneNumber}`,
        createdById: null
      });

      return result;
    } catch (error) {
      if (localMessageId) {
        const status = [400, 401, 403, 404].includes(error.response?.status) ? 'REJECTED' : 'FAILED';
        await this.pool.query(
          `UPDATE crm_whatsapp_messages
           SET status = ?, http_status = ?, failed_reason = ?, failed_at = NOW(),
               api_response = ?, updated_at = NOW()
           WHERE id = ?`,
          [
            status,
            error.response?.status || null,
            error.response?.data?.message || error.message,
            JSON.stringify(error.response?.data || {}),
            localMessageId
          ]
        ).catch(() => {});
        await this.pool.query(
          `INSERT INTO crm_whatsapp_api_logs
            (integration_id, message_id, operation, request_url, request_headers,
             request_payload, response_status, response_body, response_time_ms,
             retry_count, error_message, exception_stack, created_at)
           VALUES (?, ?, 'send', ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            integrationId,
            localMessageId,
            '/messages',
            JSON.stringify({ authorization: '[REDACTED]' }),
            JSON.stringify({
              destination: normalizedPhone,
              templateName: options.templateName || null,
              clientRequestId
            }),
            error.response?.status || null,
            JSON.stringify(error.response?.data || {}),
            Date.now() - startedAt,
            error.retryCount || 0,
            error.response?.data?.message || error.message,
            error.stack || null
          ]
        ).catch(() => {});
      }
      this.safeLogError('Failed to send Smartping message', error);
      throw error;
    }
  }

  async sendSmartpingBulkMessages(integrationId, organizationId, phoneNumbers, message, options = {}) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');
      if (config.provider_name !== 'smartping') throw new Error('Integration is not Smartping');

      if (!phoneNumbers || !Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
        throw new Error('Phone numbers array is required');
      }

      if (!message) {
        throw new Error('Message is required');
      }

      const result = { sent: 0, failed: 0, errors: [] };
      for (const recipient of phoneNumbers) {
        const phoneNumber = typeof recipient === 'object' ? recipient.phoneNumber : recipient;
        const leadId = typeof recipient === 'object' ? recipient.leadId : null;
        try {
          await this.sendSmartpingMessage(
            integrationId,
            organizationId,
            phoneNumber,
            message,
            {
              ...options,
              leadId,
              userName: typeof recipient === 'object' ? recipient.name : undefined,
              source: typeof recipient === 'object' ? (recipient.source || options.source) : options.source,
              attributes: typeof recipient === 'object'
                ? {
                    ...(options.attributes || {}),
                    ...(recipient.branch ? { Branch: String(recipient.branch) } : {}),
                    ...(recipient.className ? { Class: String(recipient.className) } : {})
                  }
                : options.attributes,
              clientRequestId: typeof recipient === 'object' && recipient.clientRequestId
                ? recipient.clientRequestId
                : crypto.randomUUID()
            }
          );
          result.sent += 1;
        } catch (error) {
          result.failed += 1;
          result.errors.push({ phoneNumber, message: error.message });
        }
      }

      await this.audit.log(integrationId, {
        action: 'bulk_messages_sent',
        notes: `Sent to ${result.sent} numbers, ${result.failed} failed`,
        createdById: null
      });

      return result;
    } catch (error) {
      this.safeLogError('Failed to send bulk Smartping messages', error);
      throw error;
    }
  }

  async getSmartpingMessageHistory(organizationId, filters = {}) {
    const conditions = [
      'i.organization_id = ?',
      'i.deleted_at IS NULL',
      "m.direction = 'outgoing'"
    ];
    const params = [organizationId];
    if (filters.integrationId) {
      conditions.push('m.integration_id = ?');
      params.push(Number(filters.integrationId));
    }
    if (filters.status) {
      conditions.push('m.status = ?');
      params.push(String(filters.status).toUpperCase());
    }
    if (filters.search) {
      conditions.push('(c.mobile LIKE ? OR m.template_name LIKE ?)');
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
    const [rows] = await this.pool.query(
      `SELECT m.id, m.message_id, m.integration_id, i.name AS integration_name,
              c.mobile AS phone_number, m.lead_id, m.template_name,
              JSON_OBJECT('body', m.message) AS message_content,
              m.status, m.sent_at, m.delivered_at, m.read_at,
              m.failed_at, m.failed_reason AS failure_reason, m.created_at
       FROM crm_whatsapp_messages m
       JOIN crm_whatsapp_conversations c ON c.id = m.conversation_id
       JOIN crm_integrations i ON i.id = m.integration_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY m.created_at DESC
       LIMIT ${limit}`,
      params
    );
    return rows.map(row => ({
      ...row,
      message_content: typeof row.message_content === 'string'
        ? JSON.parse(row.message_content)
        : row.message_content
    }));
  }

  /**
   * The inbox for one business unit.
   *
   * Conversations used to be filtered on organization_id alone, so a second
   * business unit showed the first one's chats -- a new unit with no leads
   * and no WhatsApp account of its own listed everything in the system.
   *
   * `businessUnitId` is required for that reason; a caller that cannot say
   * which business it is asking about gets nothing rather than everything.
   */
  async getWhatsAppConversations(organizationId, filters = {}) {
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 100);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const businessUnitId = Number(filters.businessUnitId);
    if (!Number.isInteger(businessUnitId) || businessUnitId <= 0) return [];
    const params = [organizationId, businessUnitId];
    let searchSql = '';
    const incomingSql = String(filters.incomingOnly || '') === '1'
      ? ` AND EXISTS (
          SELECT 1 FROM crm_whatsapp_messages incoming
          WHERE incoming.conversation_id=c.id AND incoming.direction='incoming'
        )`
      : '';
    /*
     * A conversation about a lead belongs to that lead's branch, so someone
     * who cannot open the lead should not read its chat either. Conversations
     * with nobody attached carry no branch and stay visible to the unit.
     */
    let branchSql = '';
    const branchIds = Array.isArray(filters.branchIds)
      ? filters.branchIds.map(Number).filter(Number.isFinite) : [];
    if (branchIds.length) {
      branchSql = ` AND (c.lead_id IS NULL OR l.branch_id IN (${branchIds.map(() => '?').join(',')}))`;
      params.push(...branchIds);
    } else if (filters.restrictToBranches) {
      // Told to restrict but holding no branches: no lead conversations.
      branchSql = ' AND c.lead_id IS NULL';
    }

    if (filters.search) {
      searchSql = ' AND (c.mobile LIKE ? OR c.contact_name LIKE ? OR c.last_message LIKE ?)';
      const pattern = `%${filters.search}%`;
      params.push(pattern, pattern, pattern);
    }
    const [rows] = await this.pool.query(
      `SELECT c.id, c.integration_id, c.mobile, c.contact_name, c.lead_id, c.last_message,
              c.last_message_time, c.unread_count, c.status, c.created_at, c.updated_at,
              i.name AS integration_name,l.student_name,l.lead_number,b.branch_name,
              s.display_name AS stage_name
       FROM crm_whatsapp_conversations c
       JOIN crm_integrations i ON i.id=c.integration_id
       LEFT JOIN crm_leads l ON l.id=c.lead_id AND l.deleted_at_utc IS NULL
       LEFT JOIN branches b ON b.id=l.branch_id
       LEFT JOIN crm_lead_stages s ON s.id=l.stage_id
       WHERE c.organization_id = ? AND c.business_unit_id = ?
             ${branchSql} ${searchSql} ${incomingSql}
       ORDER BY c.last_message_time DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    return rows;
  }

  /**
   * Messages in one conversation.
   *
   * Scoped to the business unit as well, or the list could be narrowed while
   * the thread behind it stayed readable by passing its id.
   */
  async getWhatsAppConversationMessages(organizationId, conversationId, filters = {}) {
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 100);
    const beforeId = Number(filters.beforeId) || null;
    const businessUnitId = Number(filters.businessUnitId);
    if (!Number.isInteger(businessUnitId) || businessUnitId <= 0) return [];
    const params = [conversationId, organizationId, businessUnitId];
    let beforeSql = '';
    if (beforeId) {
      beforeSql = ' AND m.id < ?';
      params.push(beforeId);
    }
    const [rows] = await this.pool.query(
      `SELECT m.*
       FROM crm_whatsapp_messages m
       JOIN crm_whatsapp_conversations c ON c.id = m.conversation_id
       WHERE m.conversation_id = ? AND c.organization_id = ?
             AND c.business_unit_id = ? ${beforeSql}
       ORDER BY m.id DESC
       LIMIT ${limit}`,
      params
    );
    return rows.reverse();
  }

  async refreshWhatsAppMessage(integrationId, organizationId, localMessageId) {
    const [rows] = await this.pool.query(
      `SELECT m.id, m.message_id
       FROM crm_whatsapp_messages m
       JOIN crm_whatsapp_conversations c ON c.id = m.conversation_id
       WHERE m.id = ? AND m.integration_id = ? AND c.organization_id = ?
       LIMIT 1`,
      [localMessageId, integrationId, organizationId]
    );
    if (!rows.length) throw new Error('Message not found');
    if (!rows[0].message_id || rows[0].message_id.startsWith('pending_')) {
      return rows[0];
    }
    const config = await this.configs.getById(integrationId, organizationId);
    const Provider = this.getProvider(config.provider_name);
    const provider = new Provider({ ...config.config, integrationId }, this.logger);
    const response = await provider.getMessageDetails(rows[0].message_id);
    const details = response.data || {};
    const status = String(details.status || 'PENDING').toUpperCase();
    await this.pool.query(
      `UPDATE crm_whatsapp_messages
       SET status = ?,
           delivered_at = COALESCE(?, delivered_at),
           read_at = COALESCE(?, read_at),
           failed_reason = COALESCE(?, failed_reason),
           provider_timestamp = COALESCE(?, provider_timestamp),
           api_response = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        status,
        details.deliveredAt ? new Date(details.deliveredAt) : null,
        details.readAt ? new Date(details.readAt) : null,
        details.failedReason || details.failureReason || null,
        details.timestamp ? new Date(details.timestamp) : null,
        JSON.stringify(details),
        localMessageId
      ]
    );
    return { ...details, id: localMessageId, status };
  }

  async retryWhatsAppMessage(organizationId, localMessageId) {
    const [rows] = await this.pool.query(
      `SELECT m.*, c.mobile, c.contact_name
       FROM crm_whatsapp_messages m
       JOIN crm_whatsapp_conversations c ON c.id = m.conversation_id
       WHERE m.id = ? AND c.organization_id = ?
         AND m.status IN ('FAILED', 'REJECTED')
       LIMIT 1`,
      [localMessageId, organizationId]
    );
    if (!rows.length) throw new Error('Failed message not found');
    const message = rows[0];
    return this.sendSmartpingMessage(
      message.integration_id,
      organizationId,
      message.mobile,
      message.message,
      {
        templateName: message.template_name,
        leadId: message.lead_id,
        userName: message.contact_name,
        clientRequestId: crypto.randomUUID()
      }
    );
  }

  /** Scoped to the unit for the same reason the read paths are. */
  async markWhatsAppConversationRead(organizationId, conversationId, businessUnitId) {
    const unitId = Number(businessUnitId);
    if (!Number.isInteger(unitId) || unitId <= 0) return { success: false };
    await this.pool.query(
      `UPDATE crm_whatsapp_conversations
       SET unread_count = 0, updated_at = NOW()
       WHERE id = ? AND organization_id = ? AND business_unit_id = ?`,
      [conversationId, organizationId, unitId]
    );
    return { success: true };
  }

  async pollPendingWhatsAppMessages() {
    const [rows] = await this.pool.query(
      `SELECT m.id, m.integration_id, c.organization_id
       FROM crm_whatsapp_messages m
       JOIN crm_whatsapp_conversations c ON c.id = m.conversation_id
       WHERE m.direction = 'outgoing'
         AND m.status IN ('PENDING', 'QUEUED', 'ACCEPTED', 'SENT')
         AND m.message_id IS NOT NULL
         AND m.message_id NOT LIKE 'pending_%'
         AND m.updated_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       ORDER BY m.updated_at ASC
       LIMIT 50`
    );
    let updated = 0;
    for (const row of rows) {
      try {
        await this.refreshWhatsAppMessage(row.integration_id, row.organization_id, row.id);
        updated += 1;
      } catch (error) {
        this.logger.warn?.('AiSensy message status polling failed', {
          messageId: row.id,
          error: error.message
        });
      }
    }
    return updated;
  }

  async createSmartpingTemplate(integrationId, organizationId, templateData) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');
      if (config.provider_name !== 'smartping') throw new Error('Integration is not Smartping');

      const provider = this.getProvider(config.provider_name);
      if (!provider) throw new Error('Smartping provider not registered');

      const providerInstance = new provider(config.config, this.logger);
      const template = await providerInstance.createTemplate(templateData);

      await this.audit.log(integrationId, {
        action: 'template_created',
        notes: `Template "${templateData.name}" created with status ${template.status}`,
        createdById: null
      });

      return template;
    } catch (error) {
      this.safeLogError('Failed to create template', error);
      throw error;
    }
  }

  async getSmartpingTemplates(integrationId, organizationId) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');
      if (config.provider_name !== 'smartping') throw new Error('Integration is not Smartping');

      const provider = this.getProvider(config.provider_name);
      if (!provider) throw new Error('Smartping provider not registered');

      const providerInstance = new provider(config.config, this.logger);
      return await providerInstance.getTemplates();
    } catch (error) {
      this.safeLogError('Failed to get Smartping templates', error);
      throw error;
    }
  }

  async getSmartpingTemplate(integrationId, organizationId, templateId) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');
      if (config.provider_name !== 'smartping') throw new Error('Integration is not Smartping');

      const provider = this.getProvider(config.provider_name);
      if (!provider) throw new Error('Smartping provider not registered');

      const providerInstance = new provider(config.config, this.logger);
      return await providerInstance.getTemplate(templateId);
    } catch (error) {
      this.safeLogError('Failed to get template', error);
      throw error;
    }
  }
}

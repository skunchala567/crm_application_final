// =====================================================
// Integration Service
// Main facade orchestrating all integration operations
// =====================================================

import {
  IntegrationConfigRepository,
  OAuthTokenRepository,
  SyncJobRepository,
  SyncLogRepository,
  FieldMappingRepository,
  ErrorLogRepository,
  AuditLogRepository
} from './repositories.js';

import axios from 'axios';
import { BaseIntegrationProvider, IntegrationError } from './base-provider.js';
import { encryptToken, decryptToken, getMasterKey } from './crypto-utils.js';
import { stateManager, flowDataManager } from './oauth-state-manager.js';
import { SyncEngine } from './sync-engine.js';

export class IntegrationHubService {
  constructor(pool, logger = console) {
    this.pool = pool;
    this.logger = logger;

    // Initialize repositories
    this.configs = new IntegrationConfigRepository(pool);
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

      // Debug logging for token storage
      if (updatePayload.config?.accessToken) {
        this.logger.log('[WhatsApp Config] Storing token:', {
          tokenLength: updatePayload.config.accessToken.length,
          tokenPrefix: updatePayload.config.accessToken.substring(0, 20),
          tokenSuffix: updatePayload.config.accessToken.substring(updatePayload.config.accessToken.length - 10)
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

      // Normalize provider name
      const providerName = config.provider_name.toLowerCase().includes('google') ? 'google_sheets' : config.provider_name;
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

      // Build provider config with OAuth credentials from environment
      const providerConfig = {
        ...config.config,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUrl: process.env.GOOGLE_REDIRECT_URI
      };

      // Initialize provider with config and token
      const providerInstance = new provider(providerConfig, decryptedAccessToken, this.logger);

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

  async startOAuthFlow(integrationId, organizationId, callbackUrl) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      // Normalize provider name (handle both 'google_sheets' and 'Google Sheets API v4')
      const providerName = config.provider_name.toLowerCase().includes('google') ? 'google_sheets' : config.provider_name;

      const provider = this.getProvider(providerName);
      if (!provider) throw new Error(`Provider ${config.provider_name} not registered. Available: ${Array.from(this.providers.keys()).join(', ')}`);

      // Build provider config with OAuth credentials from environment
      const providerConfig = {
        ...config.config,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUrl: process.env.GOOGLE_REDIRECT_URI
      };

      const providerInstance = new provider(providerConfig, null, this.logger);

      // Generate state token
      const stateToken = stateManager.createState({
        integrationId,
        organizationId,
        createdAt: new Date().toISOString()
      });

      // Generate OAuth URL
      const { authUrl } = await providerInstance.startOAuthFlow(callbackUrl, {
        state: stateToken.state
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

  async completeOAuthFlow(integrationId, organizationId, code, state) {
    try {
      // Validate state token (prevents CSRF) - attempt to get integrationId from state
      let actualIntegrationId = integrationId;
      try {
        const stateData = stateManager.validateState(state);
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
      const providerName = config.provider_name.toLowerCase().includes('google') ? 'google_sheets' : config.provider_name;
      const provider = this.getProvider(providerName);
      if (!provider) throw new Error(`Provider ${config.provider_name} not registered. Available: ${Array.from(this.providers.keys()).join(', ')}`);

      // Build provider config with OAuth credentials from environment
      const providerConfig = {
        ...config.config,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUrl: process.env.GOOGLE_REDIRECT_URI
      };

      // Get access token via provider
      const providerInstance = new provider(providerConfig, null, this.logger);
      const tokenData = await providerInstance.exchangeCodeForToken(code, state);

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

      return { success: true, message: 'Authorization successful', integrationConfigId: actualIntegrationId };
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
      const providerName = config.provider_name.toLowerCase().includes('google') ? 'google_sheets' : config.provider_name;
      const provider = this.getProvider(providerName);
      const decryptedAccessToken = decryptToken(oauthToken.access_token, masterKey);

      // Build provider config with OAuth credentials from environment
      const providerConfig = {
        ...config.config,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUrl: process.env.GOOGLE_REDIRECT_URI
      };

      const providerInstance = new provider(providerConfig, decryptedAccessToken, this.logger);

      // Refresh token via provider
      const newTokenData = await providerInstance.refreshToken(decryptedRefreshToken);

      // Encrypt new tokens
      const encryptedTokenData = {
        ...newTokenData,
        access_token: encryptToken(newTokenData.access_token, masterKey),
        refresh_token: newTokenData.refresh_token ? encryptToken(newTokenData.refresh_token, masterKey) : oauthToken.refresh_token
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
      const providerName = config.provider_name.toLowerCase().includes('google') ? 'google_sheets' : config.provider_name;
      const provider = this.getProvider(providerName);
      if (!provider) throw new Error(`Provider ${config.provider_name} not registered`);

      // Build provider config with OAuth credentials from environment
      const providerConfig = {
        ...config.config,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUrl: process.env.GOOGLE_REDIRECT_URI
      };

      // Get OAuth token
      const oauthToken = await this.oauthTokens.get(integrationId);
      if (!oauthToken?.access_token) {
        throw new Error('No OAuth token available. Please authorize first.');
      }

      // Decrypt access token
      const masterKey = getMasterKey();
      const decryptedAccessToken = decryptToken(oauthToken.access_token, masterKey);

      // Initialize provider and list spreadsheets
      const providerInstance = new provider(providerConfig, decryptedAccessToken, this.logger);
      const spreadsheets = await providerInstance.listSpreadsheets();

      return spreadsheets;
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

  async getSpreadsheetPreview(integrationId, organizationId, sheetId) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');
      if (config.provider_name !== 'google_sheets') throw new Error('Preview only available for Google Sheets');

      const oauthToken = await this.oauthTokens.get(integrationId);
      if (!oauthToken?.access_token) throw new Error('No OAuth token found');

      const masterKey = getMasterKey();
      const decryptedAccessToken = decryptToken(oauthToken.access_token, masterKey);

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

  async getSheetHeaders(integrationId, organizationId) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');
      if (!config.config?.spreadsheetId) throw new Error('No spreadsheet selected');

      // Normalize provider name
      const providerName = config.provider_name.toLowerCase().includes('google') ? 'google_sheets' : config.provider_name;
      const provider = this.getProvider(providerName);
      if (!provider) throw new Error(`Provider ${config.provider_name} not registered`);

      const oauthToken = await this.oauthTokens.get(integrationId);
      if (!oauthToken?.access_token) throw new Error('No OAuth token found');

      const masterKey = getMasterKey();
      const decryptedAccessToken = decryptToken(oauthToken.access_token, masterKey);

      // Fetch first row to get headers
      const response = await axios.get(
        `https://sheets.googleapis.com/v4/spreadsheets/${config.config.spreadsheetId}/values/A1:Z1`,
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

  async saveFieldMapping(integrationId, organizationId, mappings) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

      const updatedConfig = {
        ...config.config,
        fieldMappings: mappings
      };

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

  async getFieldMapping(integrationId, organizationId) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');

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

      // Create sync job
      const jobId = await this.syncJobs.create({
        integrationConfigId: integrationId,
        syncType,
        metadata: options
      });

      // Audit log
      await this.audit.log(integrationId, {
        action: 'sync_started',
        notes: `Sync type: ${syncType}`,
        createdById: userId
      });

      return { jobId, status: 'pending' };
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
      const providerName = config.provider_name.toLowerCase().includes('google') ? 'google_sheets' : config.provider_name;
      const provider = this.getProvider(providerName);
      if (!provider) throw new Error(`Provider ${config.provider_name} not registered`);

      // Get OAuth token
      const oauthToken = await this.oauthTokens.get(integrationId);
      if (!oauthToken) throw new Error('No OAuth token available');

      // Create sync job
      const jobId = await this.syncJobs.create({
        integrationConfigId: integrationId,
        syncType: 'manual',
        metadata: syncOptions
      });

      // Mark as running
      await this.syncJobs.markRunning(jobId);

      try {
        // Perform import (this varies by provider)
        const syncService = new (await this.getProviderSyncService(config.provider_name))(this.pool, this.logger);
        const result = await syncService.importLeads(config, oauthToken, syncOptions);

        // Mark completed
        await this.syncJobs.markCompleted(jobId, 'success', {
          recordsProcessed: result.imported + result.skipped + result.failed,
          recordsCreated: result.imported,
          recordsUpdated: result.updated || 0,
          recordsFailed: result.failed,
          errorMessage: null
        });

        // Log sync (ensure all values are defined)
        const stats = {
          processed: (result.imported || 0) + (result.skipped || 0) + (result.failed || 0),
          created: result.imported || 0,
          updated: result.updated || 0,
          failed: result.failed || 0,
          skipped: result.skipped || 0
        };

        try {
          await this.syncLogs.create({
            integrationConfigId: integrationId,
            syncJobId: jobId,
            syncType: 'manual',
            status: 'success',
            stats: JSON.stringify(stats),
            errorSummary: null
          });
        } catch (logError) {
          this.logger.warn('Failed to create sync log', logError.message);
          // Don't fail the entire import just because logging failed
        }

        return { jobId, status: 'success', result };
      } catch (error) {
        // Mark failed
        await this.syncJobs.markCompleted(jobId, 'failed', {
          errorMessage: error.message || 'Unknown error',
          recordsProcessed: 0,
          recordsCreated: 0,
          recordsUpdated: 0,
          recordsFailed: 0
        });

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
      const providerName = config.provider_name.toLowerCase().includes('google') ? 'google_sheets' : config.provider_name;
      const provider = this.getProvider(providerName);
      if (!provider) throw new Error(`Provider ${config.provider_name} not registered`);

      // Get OAuth token
      const oauthToken = await this.oauthTokens.get(integrationId);
      if (!oauthToken) throw new Error('No OAuth token available');

      // Create sync job
      const jobId = await this.syncJobs.create({
        integrationConfigId: integrationId,
        syncType: 'manual',
        metadata: syncOptions
      });

      // Mark as running
      await this.syncJobs.markRunning(jobId);

      try {
        // Perform export (provider-specific)
        const syncService = new (await this.getProviderSyncService(config.provider_name))(this.pool, this.logger);
        const result = await syncService.exportLeads(config, oauthToken, syncOptions);

        // Mark completed
        await this.syncJobs.markCompleted(jobId, 'success', {
          recordsProcessed: result.exported + result.failed,
          recordsCreated: result.exported,
          recordsUpdated: 0,
          recordsFailed: result.failed,
          errorMessage: null
        });

        return { jobId, status: 'success', result };
      } catch (error) {
        // Mark failed
        await this.syncJobs.markCompleted(jobId, 'failed', {
          errorMessage: error.message || 'Unknown error',
          recordsProcessed: 0,
          recordsCreated: 0,
          recordsUpdated: 0,
          recordsFailed: 0
        });

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

  // ============= WhatsApp Messaging =============

  async sendWhatsAppMessage(integrationId, organizationId, phoneNumber, message, options = {}) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');
      if (config.provider_name !== 'whatsapp') throw new Error('Integration is not WhatsApp');

      if (!phoneNumber) {
        throw new Error('Phone number is required');
      }

      const provider = this.getProvider(config.provider_name);
      if (!provider) throw new Error('WhatsApp provider not registered');

      const providerInstance = new provider(config.config, this.logger);
      const result = await providerInstance.sendMessage(phoneNumber, message, options);

      // Log message sent
      await this.audit.log(integrationId, {
        action: 'message_sent',
        notes: `WhatsApp message sent to ${phoneNumber}`,
        createdById: null
      });

      return result;
    } catch (error) {
      this.safeLogError('Failed to send WhatsApp message', error);
      throw error;
    }
  }

  async sendWhatsAppBulkMessages(integrationId, organizationId, phoneNumbers, message, options = {}) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');
      if (config.provider_name !== 'whatsapp') throw new Error('Integration is not WhatsApp');

      if (!phoneNumbers || !Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
        throw new Error('Phone numbers array is required');
      }

      const provider = this.getProvider(config.provider_name);
      if (!provider) throw new Error('WhatsApp provider not registered');

      const providerInstance = new provider(config.config, this.logger);
      const result = await providerInstance.sendBulkMessages(phoneNumbers, message, options);

      // Log bulk send
      await this.audit.log(integrationId, {
        action: 'bulk_messages_sent',
        notes: `Sent to ${result.sent} numbers, ${result.failed} failed`,
        createdById: null
      });

      return result;
    } catch (error) {
      this.safeLogError('Failed to send bulk WhatsApp messages', error);
      throw error;
    }
  }

  async getWhatsAppTemplates(integrationId, organizationId) {
    try {
      const config = await this.configs.getById(integrationId, organizationId);
      if (!config) throw new Error('Integration not found');
      if (config.provider_name !== 'whatsapp') throw new Error('Integration is not WhatsApp');

      const provider = this.getProvider(config.provider_name);
      if (!provider) throw new Error('WhatsApp provider not registered');

      const providerInstance = new provider(config.config, this.logger);
      return await providerInstance.getTemplates();
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      this.safeLogError('Failed to get WhatsApp templates', error);
      throw error;
    }
  }
}

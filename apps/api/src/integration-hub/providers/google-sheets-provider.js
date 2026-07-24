// =====================================================
// Google Sheets Provider
// OAuth 2.0 implementation for Google Sheets API
// =====================================================

import { BaseIntegrationProvider, AuthenticationError, ValidationError } from '../base-provider.js';
import axios from 'axios';

export class GoogleSheetsProvider extends BaseIntegrationProvider {
  constructor(config, accessToken, logger = console) {
    super(config, logger);
    this.name = 'GoogleSheetsProvider';
    this.accessToken = accessToken;

    // Google OAuth endpoints
    this.authorizationEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
    this.tokenEndpoint = 'https://oauth2.googleapis.com/token';
    this.revokeEndpoint = 'https://oauth2.googleapis.com/revoke';

    // Google Sheets API
    this.apiBaseUrl = 'https://sheets.googleapis.com/v4';

    // Required scopes for Sheets
    this.defaultScopes = [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ];
  }

  // ============= OAuth Methods =============

  async startOAuthFlow(callbackUrl, options = {}) {
    try {
      this.validateConfig(['clientId', 'clientSecret']);

      const scopes = options.scopes || this.defaultScopes;
      const state = options.state;

      // Build authorization URL
      const params = new URLSearchParams({
        client_id: this.config.clientId,
        redirect_uri: callbackUrl,
        response_type: 'code',
        scope: scopes.join(' '),
        access_type: 'offline', // Request refresh token
        prompt: 'consent', // Force consent screen to get refresh token
        state: state
      });

      const authUrl = `${this.authorizationEndpoint}?${params}`;

      this.log('info', 'OAuth flow started', { authUrl: authUrl.substring(0, 100) });

      return {
        authUrl,
        state
      };
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      this.log('error', 'OAuth flow start failed', { message: errorMsg });
      throw new AuthenticationError('Failed to start OAuth flow: ' + errorMsg);
    }
  }

  async exchangeCodeForToken(code, state, options = {}) {
    try {
      if (!code) throw new Error('Authorization code is required');

      this.validateConfig(['clientId', 'clientSecret']);

      const callbackUrl = options.callbackUrl || this.config.redirectUrl;
      if (!callbackUrl) throw new Error('Callback URL not provided');

      // Exchange code for token
      const response = await axios.post(this.tokenEndpoint, {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl
      });

      const tokenData = {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token || null,
        token_type: response.data.token_type || 'Bearer',
        expires_in: response.data.expires_in,
        scope: response.data.scope
      };

      this.log('info', 'Token exchanged successfully', {
        tokenType: tokenData.token_type,
        expiresIn: tokenData.expires_in
      });

      return tokenData;
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      this.log('error', 'Token exchange failed', { message: errorMsg });
      throw new AuthenticationError('Failed to exchange code for token: ' + errorMsg);
    }
  }

  async refreshToken(refreshToken) {
    try {
      if (!refreshToken) throw new Error('Refresh token is required');

      this.validateConfig(['clientId', 'clientSecret']);

      // Refresh the token
      const response = await axios.post(this.tokenEndpoint, {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      });

      const tokenData = {
        access_token: response.data.access_token,
        token_type: response.data.token_type || 'Bearer',
        expires_in: response.data.expires_in,
        scope: response.data.scope
      };

      this.log('info', 'Token refreshed successfully', {
        expiresIn: tokenData.expires_in
      });

      return tokenData;
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      this.log('error', 'Token refresh failed', { message: errorMsg });
      throw new AuthenticationError('Failed to refresh token: ' + errorMsg);
    }
  }

  async revokeToken(token) {
    try {
      if (!token) throw new Error('Token is required');

      // Revoke the token
      await axios.post(this.revokeEndpoint, null, {
        params: { token }
      });

      this.log('info', 'Token revoked successfully');
      return true;
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      this.log('error', 'Token revocation failed', { message: errorMsg });
      // Don't throw - revocation is non-critical
      return false;
    }
  }

  // ============= Core Methods =============

  async testConnection() {
    try {
      if (!this.accessToken) {
        throw new Error('Access token not available');
      }

      // Test by getting spreadsheet metadata
      const response = await axios.get(`${this.apiBaseUrl}/spreadsheets/${this.config.spreadsheetId}`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`
        }
      });

      this.log('info', 'Connection test successful', {
        spreadsheetTitle: response.data.properties.title
      });

      return {
        connected: true,
        message: 'Connected to Google Sheets',
        provider: 'Google Sheets API v4',
        spreadsheetTitle: response.data.properties.title
      };
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      this.log('error', 'Connection test failed', { message: errorMsg });

      if (error.response?.status === 401) {
        throw new AuthenticationError('Invalid or expired access token');
      }

      throw new ValidationError('Failed to connect to Google Sheets: ' + errorMsg);
    }
  }

  async fetchData(options = {}) {
    try {
      if (!this.accessToken) {
        throw new Error('Access token not available');
      }

      this.validateConfig(['spreadsheetId']);

      const spreadsheetId = this.config.spreadsheetId;
      const worksheetName = options.worksheetName || 'Sheet1';
      // Use direct range format - works for any sheet
      const range = `A:Z`;

      // Get spreadsheet data
      const response = await axios.get(`${this.apiBaseUrl}/spreadsheets/${spreadsheetId}/values/${range}`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`
        }
      });

      const values = response.data.values || [];

      this.log('info', 'Data fetched from Google Sheets', {
        rows: values.length,
        worksheetName: worksheetName
      });

      return {
        data: values,
        rowCount: values.length,
        columnCount: values.length > 0 ? values[0].length : 0
      };
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      this.log('error', 'Data fetch failed', { message: errorMsg });

      if (error.response?.status === 401) {
        throw new AuthenticationError('Invalid or expired access token');
      }

      throw new ValidationError('Failed to fetch data from Google Sheets: ' + errorMsg);
    }
  }

  async sendData(payload) {
    try {
      if (!this.accessToken) {
        throw new Error('Access token not available');
      }

      this.validateConfig(['spreadsheetId']);

      const spreadsheetId = this.config.spreadsheetId;
      const worksheetName = payload.worksheetName || 'Sheet1';
      const values = payload.values || [];

      // Append data to worksheet
      const response = await axios.post(
        `${this.apiBaseUrl}/spreadsheets/${spreadsheetId}/values/${worksheetName}!A1:Z:append?valueInputOption=RAW`,
        {
          values: Array.isArray(values[0]) ? values : [values]
        },
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      this.log('info', 'Data written to Google Sheets', {
        updates: response.data.updates.updatedRows,
        worksheet: worksheetName
      });

      return {
        success: true,
        rowsAdded: response.data.updates.updatedRows
      };
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      this.log('error', 'Data send failed', { message: errorMsg });

      if (error.response?.status === 401) {
        throw new AuthenticationError('Invalid or expired access token');
      }

      throw new ValidationError('Failed to write data to Google Sheets: ' + errorMsg);
    }
  }

  async listSpreadsheets() {
    try {
      if (!this.accessToken) {
        throw new Error('Access token not available');
      }

      // Use Google Drive API to list spreadsheets
      const response = await axios.get('https://www.googleapis.com/drive/v3/files', {
        params: {
          q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
          spaces: 'drive',
          fields: 'files(id, name, createdTime, modifiedTime, webViewLink)',
          pageSize: 100,
          orderBy: 'modifiedTime desc'
        },
        headers: {
          Authorization: `Bearer ${this.accessToken}`
        }
      });

      const spreadsheets = (response.data.files || []).map(file => ({
        id: file.id,
        name: file.name,
        createdTime: file.createdTime,
        modifiedTime: file.modifiedTime,
        url: file.webViewLink
      }));

      this.log('info', 'Spreadsheets listed successfully', { count: spreadsheets.length });

      return spreadsheets;
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      this.log('error', 'Failed to list spreadsheets', { message: errorMsg });

      if (error.response?.status === 401) {
        throw new AuthenticationError('Invalid or expired access token');
      }

      throw new ValidationError('Failed to list spreadsheets: ' + errorMsg);
    }
  }

  async authenticate() {
    // OAuth authentication is handled by startOAuthFlow/exchangeCodeForToken
    throw new Error('Use OAuth flow for authentication');
  }

  async handleWebhook(payload, signature) {
    // Google Sheets doesn't support webhooks in this integration
    throw new Error('Webhooks not supported for Google Sheets');
  }
}

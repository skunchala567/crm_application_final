// =====================================================
// Integration Hub API Routes
// Express routes for integration management
// =====================================================

import express from 'express';
import { stateManager } from './oauth-state-manager.js';

export function createIntegrationHubRoutes(service, authenticate, requireCrmAccess) {
  const router = express.Router();

  // ============= OAuth Callback (Public - No Auth Required) =============
  // Must be before authentication middleware
  router.get('/oauth/callback', async (req, res, next) => {
    try {
      const { code, state, error, error_description } = req.query;

      // Handle OAuth errors from provider
      if (error) {
        const errorMsg = error_description || `OAuth error: ${error}`;
        console.error('OAuth error:', errorMsg);
        return res.redirect(`http://localhost:3000/oauth-error?error=${encodeURIComponent(errorMsg)}`);
      }

      if (!code || !state) {
        const err = 'Missing code or state';
        console.error('OAuth callback error:', err);
        return res.redirect(`http://localhost:3000/oauth-error?error=${encodeURIComponent(err)}`);
      }

      // For now, default organizationId to 1 (will be improved in future with state management)
      const organizationId = 1;

      // Try to extract integrationId from state using state manager, fallback to 1
      let integrationId = 1;
      try {
        // The state manager stores { integrationId, organizationId, etc }
        // But we're being lenient - if it fails, we'll use default
      } catch (err) {
        // Could not parse state metadata
      }

      // Exchange code for token - completeOAuthFlow will use state to validate
      const result = await service.completeOAuthFlow(integrationId, organizationId, code, state);

      if (!result) {
        return res.redirect(`http://localhost:3000/oauth-error?error=${encodeURIComponent('Failed to complete OAuth flow')}`);
      }

      // Use integrationId from result if available
      const finalIntegrationId = result.integrationConfigId || integrationId;

      // Redirect to integrations page
      res.redirect(`http://localhost:3000/integrations?oauth=success&integrationId=${finalIntegrationId}`);
    } catch (error) {
      console.error('OAuth callback error:', error.message);
      next(error);
    }
  });

  // Apply authentication to all routes
  router.use(authenticate);
  router.use(requireCrmAccess);

  // ============= Integration Management =============

  // List integrations
  router.get('/integrations', async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const { status, type, provider, page = 1, limit = 20 } = req.query;

      const integrations = await service.listIntegrations(organizationId, {
        status,
        type,
        provider,
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        data: integrations,
        pagination: { page, limit, total: integrations.length }
      });
    } catch (error) {
      next(error);
    }
  });

  // Get integration details
  router.get('/integrations/:id', async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.id);

      const integration = await service.getIntegration(integrationId, organizationId);
      if (!integration) {
        return res.status(404).json({ success: false, message: 'Integration not found' });
      }

      res.json({ success: true, data: integration });
    } catch (error) {
      next(error);
    }
  });

  // Debug: Check what token is stored
  router.get('/integrations/:id/debug/token-info', async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.id);

      const integration = await service.getIntegration(integrationId, organizationId);
      if (!integration) {
        return res.status(404).json({ success: false, message: 'Integration not found' });
      }

      const token = integration.config?.accessToken || '';

      res.json({
        success: true,
        data: {
          tokenLength: token.length,
          tokenPrefix: token.substring(0, 30),
          tokenSuffix: token.substring(Math.max(0, token.length - 20)),
          hasToken: token.length > 0,
          phoneNumberId: integration.config?.phoneNumberId,
          businessAccountId: integration.config?.businessAccountId
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // Create integration
  router.post('/integrations', async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const { integrationName, integrationType, providerName, config } = req.body;

      if (!integrationName || !integrationType || !providerName) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: integrationName, integrationType, providerName'
        });
      }

      const integration = await service.createIntegration(
        organizationId,
        { integrationName, integrationType, providerName, config },
        req.user?.id || null
      );

      res.status(201).json({ success: true, data: integration });
    } catch (error) {
      next(error);
    }
  });

  // Update integration
  router.put('/integrations/:id', async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.id);
      const { integrationName, config, status } = req.body;

      // Only include provided fields
      const updateData = {};
      if (integrationName !== undefined) updateData.integrationName = integrationName;
      if (config !== undefined) updateData.config = config;
      if (status !== undefined) updateData.status = status;

      const updated = await service.updateIntegration(
        integrationId,
        organizationId,
        updateData,
        req.user?.id || null
      );

      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  });

  // Delete/Disconnect integration
  router.delete('/integrations/:id', async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.id);

      await service.deleteIntegration(integrationId, organizationId, req.user.id);

      res.json({ success: true, message: 'Integration disconnected' });
    } catch (error) {
      next(error);
    }
  });

  // ============= Connection Testing =============

  router.post('/integrations/:id/test-connection', async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.id);

      const result = await service.testConnection(integrationId, organizationId);

      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ============= OAuth Management =============

  // Start OAuth flow
  router.post('/integrations/:id/auth/start', async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.id);
      const { callbackUrl } = req.body;

      // Get integration to check provider type
      const integration = await service.getIntegration(integrationId, organizationId);
      if (!integration) {
        return res.status(404).json({ success: false, message: 'Integration not found' });
      }

      // WhatsApp doesn't use OAuth - just activate it
      if (integration.provider_name === 'whatsapp') {
        await service.configs.updateSyncStatus(integrationId, organizationId, {
          status: 'active',
          lastErrorMessage: null,
          lastSyncedAt: null,
          nextSyncAt: null
        });
        return res.json({ success: true, data: { message: 'WhatsApp activated successfully' } });
      }

      // OAuth flow for other providers
      if (!callbackUrl) {
        return res.status(400).json({
          success: false,
          message: 'callbackUrl is required'
        });
      }

      const { authUrl, state } = await service.startOAuthFlow(
        integrationId,
        organizationId,
        callbackUrl
      );

      // Store state in session (implementation specific)
      req.session = req.session || {};
      req.session.oauthState = state;

      res.json({ success: true, data: { authUrl, state } });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  });

  // OAuth callback
  router.post('/integrations/:id/auth/callback', async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.id);
      const { code, state } = req.body;

      if (!code || !state) {
        return res.status(400).json({
          success: false,
          message: 'code and state are required'
        });
      }

      // Verify state (implementation specific)
      // if (req.session?.oauthState !== state) {
      //   throw new Error('State mismatch - possible CSRF attack');
      // }

      const result = await service.completeOAuthFlow(
        integrationId,
        organizationId,
        code,
        state
      );

      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  });

  // Refresh OAuth token
  router.post('/integrations/:id/auth/refresh', async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.id);

      const result = await service.refreshOAuthToken(integrationId, organizationId);

      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  });

  // Disconnect OAuth
  router.post('/integrations/:id/auth/disconnect', async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.id);

      const result = await service.disconnectOAuth(integrationId, organizationId, req.user.id);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // ============= Sync Operations =============

  // Start manual sync
  router.post('/integrations/:id/sync/manual', async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.id);
      const { options } = req.body;

      const result = await service.startSync(
        integrationId,
        organizationId,
        'manual',
        options || {},
        req.user.id
      );

      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  });

  // Get sync status
  router.get('/integrations/:id/sync/jobs/:jobId', async (req, res, next) => {
    try {
      const jobId = parseInt(req.params.jobId);

      const status = await service.getSyncStatus(jobId);

      res.json({ success: true, data: status });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  });

  // Get sync history
  router.get('/integrations/:id/sync/history', async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.id);
      const { status, since, page = 1, limit = 20 } = req.query;

      const history = await service.getSyncHistory(integrationId, organizationId, {
        status,
        since,
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.json({ success: true, data: history });
    } catch (error) {
      next(error);
    }
  });

  // ============= Field Mapping =============

  router.get('/integrations/:id/field-mappings', async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.id);

      const mappings = await service.getFieldMappings(integrationId, organizationId);

      res.json({ success: true, data: mappings });
    } catch (error) {
      next(error);
    }
  });

  router.post('/integrations/:id/field-mappings', async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.id);
      const mappingData = req.body;

      await service.createFieldMapping(integrationId, organizationId, mappingData, req.user.id);

      res.status(201).json({ success: true, message: 'Field mapping created' });
    } catch (error) {
      next(error);
    }
  });

  // ============= Error Management =============

  router.get('/integrations/:id/errors', async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.id);

      const errors = await service.getErrors(integrationId, organizationId);

      res.json({ success: true, data: errors });
    } catch (error) {
      next(error);
    }
  });

  router.post('/integrations/:id/errors/:errorId/resolve', async (req, res, next) => {
    try {
      const errorId = parseInt(req.params.errorId);
      const { resolutionNotes } = req.body;

      await service.resolveError(errorId, resolutionNotes);

      res.json({ success: true, message: 'Error marked as resolved' });
    } catch (error) {
      next(error);
    }
  });

  // ============= Audit Logs =============

  router.get('/integrations/:id/audit-logs', async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.id);

      const logs = await service.getAuditLogs(integrationId, organizationId);

      res.json({ success: true, data: logs });
    } catch (error) {
      next(error);
    }
  });

  // ============= Data Import/Export =============

  // Import data from external source
  router.post('/integrations/:id/import', async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.id);
      const { options } = req.body || {};

      const result = await service.importData(integrationId, organizationId, options);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // Export data to external destination
  router.post('/integrations/:id/export', async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.id);
      const { options } = req.body || {};

      const result = await service.exportData(integrationId, organizationId, options);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // ============= Spreadsheet Management =============

  // List available spreadsheets
  router.get('/integrations/:integrationId/spreadsheets', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);

      const spreadsheets = await service.listSpreadsheets(integrationId, organizationId);

      res.json({ success: true, data: spreadsheets });
    } catch (error) {
      next(error);
    }
  });

  // Select a spreadsheet for this integration
  router.post('/integrations/:integrationId/spreadsheets/:sheetId/select', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);
      const sheetId = req.params.sheetId;
      const { sheetName } = req.body;

      if (!sheetId || !sheetName) {
        return res.status(400).json({
          success: false,
          message: 'Missing sheetId or sheetName'
        });
      }

      const result = await service.selectSpreadsheet(integrationId, organizationId, sheetId, sheetName);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // Get spreadsheet preview (first few rows and headers)
  router.get('/integrations/:integrationId/spreadsheets/:sheetId/preview', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);
      const sheetId = req.params.sheetId;

      const preview = await service.getSpreadsheetPreview(integrationId, organizationId, sheetId);

      res.json({ success: true, data: preview });
    } catch (error) {
      next(error);
    }
  });

  // ============= Field Mapping =============

  const CRM_FIELDS = [
    { name: 'student_name', label: 'Student Name', type: 'text' },
    { name: 'phone', label: 'Phone', type: 'text' },
    { name: 'alternate_phone', label: 'Alternate Phone', type: 'text' },
    { name: 'email', label: 'Email', type: 'text' },
    { name: 'applying_class', label: 'Applying Class', type: 'text' },
    { name: 'parent_name', label: 'Parent Name', type: 'text' },
    { name: 'city', label: 'City', type: 'text' },
    { name: 'remarks', label: 'Remarks', type: 'text' },
    { name: 'lead_score', label: 'Lead Score', type: 'number' }
  ];

  // Get sheet headers for mapping
  router.get('/integrations/:integrationId/field-mapping/headers', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);

      const headers = await service.getSheetHeaders(integrationId, organizationId);

      res.json({
        success: true,
        data: {
          sheetHeaders: headers,
          crmFields: CRM_FIELDS
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // Get current field mapping
  router.get('/integrations/:integrationId/field-mapping', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);

      const mapping = await service.getFieldMapping(integrationId, organizationId);

      res.json({
        success: true,
        data: {
          mappings: mapping,
          crmFields: CRM_FIELDS
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // Save field mapping
  router.post('/integrations/:integrationId/field-mapping', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);
      const { mappings } = req.body;

      if (!mappings || typeof mappings !== 'object') {
        return res.status(400).json({
          success: false,
          message: 'Invalid mappings provided'
        });
      }

      const result = await service.saveFieldMapping(integrationId, organizationId, mappings);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // ============= Data Sync =============

  // Import data from Google Sheets to CRM
  router.post('/integrations/:integrationId/import', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);

      const result = await service.importData(integrationId, organizationId);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // Export data from CRM to Google Sheets
  router.post('/integrations/:integrationId/export', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);

      const result = await service.exportData(integrationId, organizationId);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // ============= WhatsApp Messaging =============

  // Send message to individual lead
  // Send individual message to phone number
  router.post('/integrations/:integrationId/whatsapp/send', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);
      const { phoneNumber, message, templateId } = req.body;

      if (!phoneNumber || !message) {
        return res.status(400).json({
          success: false,
          message: 'phoneNumber and message are required'
        });
      }

      const result = await service.sendWhatsAppMessage(
        integrationId,
        organizationId,
        phoneNumber,
        message,
        { templateId }
      );

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // Send bulk messages to phone numbers from Excel/CSV
  router.post('/integrations/:integrationId/whatsapp/send-bulk', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);
      const { phoneNumbers, message, templateId } = req.body;

      if (!phoneNumbers || !Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'phoneNumbers array is required'
        });
      }

      if (!message) {
        return res.status(400).json({
          success: false,
          message: 'message is required'
        });
      }

      const result = await service.sendWhatsAppBulkMessages(
        integrationId,
        organizationId,
        phoneNumbers,
        message,
        { templateId }
      );

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // Get WhatsApp message templates
  router.get('/integrations/:integrationId/whatsapp/templates', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);

      const templates = await service.getWhatsAppTemplates(integrationId, organizationId);

      res.json({ success: true, data: templates });
    } catch (error) {
      next(error);
    }
  });

  // ============= Metadata =============

  router.get('/providers', async (req, res, next) => {
    try {
      const providers = service.listAvailableProviders();

      res.json({
        success: true,
        data: providers.map(name => ({
          id: name,
          name: name.replace(/_/g, ' ').toUpperCase()
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  // ============= Error Handler =============

  router.use((error, req, res, next) => {
    console.error('[Integration Hub Error]', error);

    const statusCode = error.statusCode || 500;
    const code = error.code || 'integration_error';
    const message = error.message || 'An unexpected error occurred';

    res.status(statusCode).json({
      success: false,
      error: {
        code,
        message,
        details: error.details
      }
    });
  });

  // ============= OAuth Management =============

  // Initiate OAuth flow
  router.post('/oauth/initiate', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const { integrationId, providerName } = req.body;

      if (!integrationId || !providerName) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: integrationId, providerName'
        });
      }

      // Always use the redirect URI from environment (more secure)
      const redirectUrl = process.env.GOOGLE_REDIRECT_URI;
      if (!redirectUrl) {
        return res.status(500).json({
          success: false,
          message: 'Server configuration error: GOOGLE_REDIRECT_URI not set'
        });
      }

      const { authUrl } = await service.startOAuthFlow(
        integrationId,
        organizationId,
        redirectUrl
      );

      res.json({ success: true, data: { authUrl } });
    } catch (error) {
      next(error);
    }
  });

  // Refresh OAuth token
  router.post('/oauth/refresh/:integrationId', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);

      const result = await service.refreshOAuthToken(integrationId, organizationId);

      res.json({ success: true, data: { refreshed: true, expiresAt: result.expires_at } });
    } catch (error) {
      next(error);
    }
  });

  // Disconnect OAuth
  router.post('/oauth/disconnect/:integrationId', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);

      await service.disconnectOAuth(integrationId, organizationId, req.user?.id || null);

      res.json({ success: true, message: 'OAuth disconnected' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

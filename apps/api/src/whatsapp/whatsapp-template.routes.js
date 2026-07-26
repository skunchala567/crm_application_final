// =====================================================
// WhatsApp Template Routes - API-First
// All endpoints delegate to service layer
// AiSensy is source of truth
// =====================================================

import express from 'express';
import { WhatsAppTemplateService } from './whatsapp-template.service.js';

export function createWhatsAppTemplateRoutes(pool, authenticate, logger = console) {
  const router = express.Router();
  const service = new WhatsAppTemplateService(pool, logger);

  // ============= Integration Management =============

  /**
   * GET /whatsapp/integrations
   * List integrations (for selecting which one to use)
   */
  router.get('/integrations', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const { provider } = req.query;

      let query = 'SELECT id, name, type, status, project_id, project_api_password, config, created_at FROM crm_integrations WHERE organization_id = ? AND deleted_at IS NULL';
      const params = [organizationId];

      if (provider) {
        query += ' AND type = ?';
        params.push(provider.toUpperCase());
      }

      const [integrations] = await pool.query(query, params);

      const formatted = integrations.map(i => {
        let config = {};
        try {
          config = typeof i.config === 'string' ? JSON.parse(i.config) : (i.config || {});
        } catch {
          config = {};
        }

        const projectId = i.project_id || config.projectId || config.project_id;
        const projectApiPassword = i.project_api_password
          || config.projectApiPassword
          || config.project_api_password;

        return {
          id: i.id,
          name: i.name,
          integration_name: i.name,
          type: i.type,
          status: i.status,
          has_credentials: !!(projectId && projectApiPassword),
          created_at: i.created_at
        };
      });

      res.json({ success: true, data: formatted });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /whatsapp/integrations/:integrationId
   * Get single integration details
   */
  router.get('/integrations/:integrationId', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);

      if (isNaN(integrationId)) {
        return res.status(400).json({ success: false, message: 'Invalid integration ID' });
      }

      const [integrations] = await pool.query(
        'SELECT id, name, type, status, created_at FROM crm_integrations WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
        [integrationId, organizationId]
      );

      if (integrations.length === 0) {
        return res.status(404).json({ success: false, message: 'Integration not found' });
      }

      const i = integrations[0];
      res.json({
        success: true,
        data: {
          id: i.id,
          name: i.name,
          integration_name: i.name,
          type: i.type,
          status: i.status,
          created_at: i.created_at
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // ============= Template CRUD =============

  /**
   * GET /whatsapp/integrations/:integrationId/templates
   * List all templates from AiSensy (source of truth)
   */
  router.get('/integrations/:integrationId/templates', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);

      if (isNaN(integrationId)) {
        return res.status(400).json({ success: false, message: 'Invalid integration ID' });
      }

      const { status, category, search, limit = 20, offset = 0 } = req.query;

      const templates = await service.listTemplates(organizationId, integrationId, {
        status,
        category,
        search
      });

      // Apply pagination
      const paginatedTemplates = templates.slice(
        parseInt(offset),
        parseInt(offset) + parseInt(limit)
      );

      res.json({
        success: true,
        data: paginatedTemplates,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: templates.length
        }
      });
    } catch (error) {
      logger.error('[Routes] Failed to list templates', { error: error.message });
      res.status(500).json({
        success: false,
        error: { message: error.message }
      });
    }
  });

  /**
   * GET /whatsapp/integrations/:integrationId/templates/:aisensy_template_id
   * Get single template details from AiSensy
   */
  router.get('/integrations/:integrationId/templates/:aisensy_template_id', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);
      const aisensy_template_id = req.params.aisensy_template_id;

      if (isNaN(integrationId)) {
        return res.status(400).json({ success: false, message: 'Invalid integration ID' });
      }

      const template = await service.getTemplate(organizationId, integrationId, aisensy_template_id);

      if (!template) {
        return res.status(404).json({ success: false, message: 'Template not found' });
      }

      res.json({ success: true, data: template });
    } catch (error) {
      logger.error('[Routes] Failed to get template', { error: error.message });
      res.status(error.statusCode || 500).json({
        success: false,
        error: { message: error.message }
      });
    }
  });

  /**
   * POST /whatsapp/integrations/:integrationId/templates
   * Create and submit new template to AiSensy
   */
  router.post('/integrations/:integrationId/templates', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);

      if (isNaN(integrationId)) {
        return res.status(400).json({ success: false, message: 'Invalid integration ID' });
      }

      const template = await service.createTemplate(organizationId, integrationId, req.body);

      res.status(201).json({ success: true, data: template });
    } catch (error) {
      logger.error('[Routes] Failed to create template', {
        error: error.message,
        validationErrors: error.validationErrors
      });

      if (error.statusCode === 400) {
        return res.status(400).json({
          success: false,
          message: error.message,
          errors: error.validationErrors
        });
      }

      if (error.message.includes('already exists')) {
        return res.status(409).json({
          success: false,
          message: error.message
        });
      }

      res.status(500).json({
        success: false,
        error: { message: error.message }
      });
    }
  });

  /**
   * DELETE /whatsapp/integrations/:integrationId/templates/:aisensy_template_id
   * Delete template from AiSensy
   */
  router.delete('/integrations/:integrationId/templates/:aisensy_template_id', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);
      const aisensy_template_id = req.params.aisensy_template_id;

      if (isNaN(integrationId)) {
        return res.status(400).json({ success: false, message: 'Invalid integration ID' });
      }

      await service.deleteTemplate(organizationId, integrationId, aisensy_template_id);

      res.json({ success: true, message: 'Template deleted' });
    } catch (error) {
      logger.error('[Routes] Failed to delete template', { error: error.message });
      res.status(error.statusCode || 500).json({
        success: false,
        error: { message: error.message }
      });
    }
  });

  // ============= Sync Operations =============

  /**
   * POST /whatsapp/integrations/:integrationId/sync
   * Sync all templates from AiSensy
   */
  router.post('/integrations/:integrationId/sync', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);

      if (isNaN(integrationId)) {
        return res.status(400).json({ success: false, message: 'Invalid integration ID' });
      }

      const result = await service.syncTemplates(organizationId, integrationId);

      res.json({
        success: true,
        data: result,
        message: `Synced ${result.count} templates from AiSensy`
      });
    } catch (error) {
      logger.error('[Routes] Sync failed', { error: error.message });
      res.status(500).json({
        success: false,
        error: { message: error.message }
      });
    }
  });

  /**
   * GET /whatsapp/integrations/:integrationId/templates/status/counts
   * Get template counts by status
   */
  router.get('/integrations/:integrationId/templates/status/counts', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);

      if (isNaN(integrationId)) {
        return res.status(400).json({ success: false, message: 'Invalid integration ID' });
      }

      const counts = await service.getStatusCounts(organizationId, integrationId);

      res.json({
        success: true,
        data: counts
      });
    } catch (error) {
      logger.error('[Routes] Failed to get status counts', { error: error.message });
      res.status(500).json({
        success: false,
        error: { message: error.message }
      });
    }
  });

  // ============= Error Handler =============

  router.use((error, req, res, next) => {
    logger.error('[WhatsApp Template Error]', {
      message: error.message,
      status: error.statusCode,
      path: req.path,
      method: req.method
    });

    const statusCode = error.statusCode || 500;
    const message = error.message || 'An unexpected error occurred';

    res.status(statusCode).json({
      success: false,
      error: { message, details: error.details }
    });
  });

  return router;
}

export default createWhatsAppTemplateRoutes;

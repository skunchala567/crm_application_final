import express from 'express';
import { WhatsAppTemplateService } from './whatsapp-template.service.js';

export function createWhatsAppTemplateRoutes(pool, authenticate, logger = console) {
  const router = express.Router();
  const templateService = new WhatsAppTemplateService(pool, logger);

  // ============= Template CRUD =============

  // Create template
  router.post('/integrations/:integrationId/templates', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);

      const template = await templateService.createTemplate(
        organizationId,
        integrationId,
        req.body
      );

      res.status(201).json({ success: true, data: template });
    } catch (error) {
      next(error);
    }
  });

  // Get template list
  router.get('/integrations/:integrationId/templates', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);
      const { status, category, language, search, type, limit = 20, offset = 0 } = req.query;

      const templates = await templateService.listTemplates(
        organizationId,
        integrationId,
        {
          status,
          category,
          language,
          search,
          type,
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      );

      const total = await templateService.countTemplates(
        organizationId,
        integrationId,
        { status, category, language, search, type }
      );

      res.json({
        success: true,
        data: templates,
        pagination: { limit: parseInt(limit), offset: parseInt(offset), total }
      });
    } catch (error) {
      next(error);
    }
  });

  // Get single template
  router.get('/integrations/:integrationId/templates/:templateId', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);
      const templateId = parseInt(req.params.templateId);

      const template = await templateService.getTemplate(organizationId, integrationId, templateId);
      if (!template) {
        return res.status(404).json({ success: false, message: 'Template not found' });
      }

      res.json({ success: true, data: template });
    } catch (error) {
      next(error);
    }
  });

  // Update template
  router.put('/integrations/:integrationId/templates/:templateId', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);
      const templateId = parseInt(req.params.templateId);

      const template = await templateService.updateTemplate(
        organizationId,
        integrationId,
        templateId,
        req.body
      );

      res.json({ success: true, data: template });
    } catch (error) {
      next(error);
    }
  });

  // Delete template
  router.delete('/integrations/:integrationId/templates/:templateId', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);
      const templateId = parseInt(req.params.templateId);

      await templateService.deleteTemplate(organizationId, integrationId, templateId);

      res.json({ success: true, message: 'Template deleted' });
    } catch (error) {
      next(error);
    }
  });

  // ============= Template Actions =============

  // Submit template
  router.post('/integrations/:integrationId/templates/:templateId/submit', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);
      const templateId = parseInt(req.params.templateId);

      const template = await templateService.submitTemplate(
        organizationId,
        integrationId,
        templateId
      );

      res.json({ success: true, data: template, message: 'Template submitted for approval' });
    } catch (error) {
      next(error);
    }
  });

  // Clone template
  router.post('/integrations/:integrationId/templates/:templateId/clone', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);
      const templateId = parseInt(req.params.templateId);
      const { newName } = req.body;

      if (!newName) {
        return res.status(400).json({ success: false, message: 'newName is required' });
      }

      const template = await templateService.cloneTemplate(
        organizationId,
        integrationId,
        templateId,
        newName
      );

      res.status(201).json({ success: true, data: template, message: 'Template cloned successfully' });
    } catch (error) {
      next(error);
    }
  });

  // Archive template
  router.post('/integrations/:integrationId/templates/:templateId/archive', authenticate, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);
      const templateId = parseInt(req.params.templateId);

      await templateService.archiveTemplate(organizationId, integrationId, templateId);

      res.json({ success: true, message: 'Template archived' });
    } catch (error) {
      next(error);
    }
  });

  // Validate template
  router.post('/integrations/:integrationId/templates/validate', authenticate, async (req, res, next) => {
    try {
      const validation = templateService.validateTemplate(req.body);

      res.json({
        success: validation.valid,
        valid: validation.valid,
        errors: validation.errors
      });
    } catch (error) {
      next(error);
    }
  });

  // Get sync logs
  router.get('/integrations/:integrationId/templates/:templateId/sync-logs', authenticate, async (req, res, next) => {
    try {
      const templateId = parseInt(req.params.templateId);
      const { limit = 10 } = req.query;

      const logs = await templateService.getSyncLogs(templateId, parseInt(limit));

      res.json({ success: true, data: logs });
    } catch (error) {
      next(error);
    }
  });

  // Error handler
  router.use((error, req, res, next) => {
    logger.error('[WhatsApp Template Error]', error);

    const statusCode = error.statusCode || 500;
    const message = error.message || 'An unexpected error occurred';

    res.status(statusCode).json({
      success: false,
      error: { message, details: error.details }
    });
  });

  return router;
}

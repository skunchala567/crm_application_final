// =====================================================
// WhatsApp Webhook Routes
// Receives template status updates from AiSensy
// =====================================================

import express from 'express';

export function createWebhookRoutes(pool, logger = console) {
  const router = express.Router();

  /**
   * Webhook endpoint for template status updates
   * POST /api/webhooks/whatsapp/template-status
   *
   * Receives status updates when template approval status changes
   * Example payload from AiSensy:
   * {
   *   "id": "template_id",
   *   "name": "template_name",
   *   "status": "APPROVED",
   *   "rejection_reason": null,
   *   "category": "TRANSACTIONAL",
   *   "language": "English",
   *   "updated_at": 1648742718226
   * }
   */
  router.post('/whatsapp/template-status', async (req, res) => {
    try {
      const {
        id: aisensy_template_id,
        name,
        status,
        rejection_reason,
        rejection_category,
        category,
        language,
        updated_at
      } = req.body;

      logger.info('[Webhook] Template status update received', {
        aisensy_template_id,
        status,
        timestamp: new Date().toISOString()
      });

      // Validate required fields
      if (!aisensy_template_id || !status) {
        logger.warn('[Webhook] Missing required fields', req.body);
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: id and status'
        });
      }

      // Validate status value
      const validStatuses = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED'];
      if (!validStatuses.includes(status)) {
        logger.warn('[Webhook] Invalid status', { status });
        return res.status(400).json({
          success: false,
          message: `Invalid status: ${status}`
        });
      }

      // Find template by aisensy_template_id
      const [templates] = await pool.query(
        'SELECT id, status as current_status FROM whatsapp_templates WHERE aisensy_template_id = ?',
        [aisensy_template_id]
      );

      if (templates.length === 0) {
        logger.warn('[Webhook] Template not found in database', { aisensy_template_id });
        // Don't fail - AiSensy might send updates for templates we haven't synced yet
        return res.json({
          success: true,
          message: 'Template not found locally - will be synced later'
        });
      }

      const template = templates[0];
      const templateId = template.id;
      const previousStatus = template.current_status;

      // Update template status
      const updateData = {
        status: status,
        updated_at: new Date(),
        rejection_reason: rejection_reason || null
      };

      await pool.query(
        'UPDATE whatsapp_templates SET status = ?, rejection_reason = ?, updated_at = ? WHERE id = ?',
        [status, rejection_reason || null, updateData.updated_at, templateId]
      );

      logger.info('[Webhook] Template status updated', {
        templateId,
        previousStatus,
        newStatus: status,
        aisensy_template_id
      });

      // Log the webhook update in audit trail
      await pool.query(
        `INSERT INTO whatsapp_template_logs (
          template_id,
          integration_id,
          aisensy_template_id,
          action,
          status,
          previous_status,
          rejection_reason,
          rejection_category,
          webhook_received_at,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          templateId,
          null, // Will be updated based on template
          aisensy_template_id,
          'WEBHOOK_UPDATE',
          status,
          previousStatus,
          rejection_reason || null,
          rejection_category || null,
          new Date()
        ]
      );

      // Return success response to AiSensy
      res.json({
        success: true,
        message: 'Webhook processed successfully',
        templateId: templateId,
        status: status
      });

    } catch (error) {
      logger.error('[Webhook] Error processing webhook', {
        error: error.message,
        body: req.body
      });

      res.status(500).json({
        success: false,
        message: 'Error processing webhook',
        error: error.message
      });
    }
  });

  /**
   * Health check endpoint for webhook configuration
   * GET /api/webhooks/whatsapp/health
   */
  router.get('/whatsapp/health', (req, res) => {
    res.json({
      success: true,
      message: 'Webhook endpoint is active',
      timestamp: new Date().toISOString(),
      endpoint: '/api/webhooks/whatsapp/template-status'
    });
  });

  /**
   * Webhook configuration verification
   * POST /api/webhooks/whatsapp/verify
   * Receives a verification payload from AiSensy during setup
   */
  router.post('/whatsapp/verify', (req, res) => {
    logger.info('[Webhook] Verification request received', req.body);

    res.json({
      success: true,
      message: 'Webhook endpoint verified',
      timestamp: new Date().toISOString()
    });
  });

  return router;
}

export default createWebhookRoutes;

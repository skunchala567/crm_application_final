// =====================================================
// WhatsApp Webhook Routes
// Receives template status updates from AiSensy
// =====================================================

import express from 'express';

export function createWebhookRoutes(pool, logger = console) {
  const router = express.Router();

  const handleMessageWebhook = async (req, res) => {
    try {
      const root = req.body || {};
      const nested = root.data && typeof root.data === 'object'
        ? root.data
        : root.message && typeof root.message === 'object'
          ? root.message
          : root.eventData && typeof root.eventData === 'object'
            ? root.eventData
            : {};
      const payload = { ...root, ...nested };
      const messageId = payload.messageId || payload.message_id || payload.messageIdString
        || payload.id || payload.key?.id || root.id;
      const normalizedStatus = String(payload.status || 'RECEIVED').toUpperCase();
      const sender = String(payload.sender || payload.sender_type || payload.from_type || '').toUpperCase();
      const incomingSenders = new Set(['CONTACT', 'CUSTOMER', 'USER', 'CLIENT', 'RECEIVER']);
      const direction = String(
        payload.direction
        || root.direction
        || (incomingSenders.has(sender) || root.eventType === 'user-event' ? 'incoming' : 'outgoing')
      ).toLowerCase();
      const mobileDigits = String(
        direction === 'incoming'
          ? payload.from || payload.phone_number || payload.phoneNumber || payload.mobile
            || payload.wa_id || payload.contact?.phone || payload.user?.phone
          : payload.to || payload.destination || payload.phone_number || payload.phoneNumber
            || payload.mobile || payload.wa_id
      ).replace(/\D/g, '');
      const mobile = /^91[6-9]\d{9}$/.test(mobileDigits) ? mobileDigits.slice(2) : mobileDigits;
      const projectId = payload.project_id || payload.projectId || root.project_id || root.projectId;

      logger.info('[Webhook] WhatsApp message event received', {
        type: payload.type || root.type,
        messageId,
        projectId,
        phoneNumber: mobile,
        sender,
        direction
      });

      if (!messageId || !mobile) {
        return res.status(400).json({ success: false, message: 'messageId and mobile number are required' });
      }

      const [integrations] = await pool.query(
        `SELECT id, organization_id
         FROM crm_integrations
         WHERE deleted_at IS NULL
           AND (? IS NULL OR COALESCE(
             NULLIF(project_id, ''),
             NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.projectId')), ''),
             NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.project_id')), '')
           ) = ?)
           AND LOWER(COALESCE(provider, '')) = 'smartping'
         ORDER BY id
         LIMIT 1`,
        [projectId || null, projectId || null]
      );
      if (!integrations.length) {
        return res.status(404).json({ success: false, message: 'WhatsApp integration not found' });
      }
      const integration = integrations[0];
      const [existing] = await pool.query(
        'SELECT id, conversation_id FROM crm_whatsapp_messages WHERE message_id = ? LIMIT 1',
        [messageId]
      );

      if (existing.length) {
        await pool.query(
          `UPDATE crm_whatsapp_messages
           SET status = ?,
               delivered_at = IF(? = 'DELIVERED', COALESCE(delivered_at, NOW()), delivered_at),
               read_at = IF(? = 'READ', COALESCE(read_at, NOW()), read_at),
               failed_at = IF(? IN ('FAILED','REJECTED'), COALESCE(failed_at, NOW()), failed_at),
               failed_reason = COALESCE(?, failed_reason),
               api_response = ?, updated_at = NOW()
           WHERE id = ?`,
          [
            normalizedStatus,
            normalizedStatus,
            normalizedStatus,
            normalizedStatus,
            payload.failedReason || payload.failureReason || payload.error?.message || null,
            JSON.stringify(payload),
            existing[0].id
          ]
        );
        return res.json({ success: true, message: 'Message status updated' });
      }

      const messageContent = payload.message_content || {};
      const text = payload.text?.body || (typeof payload.text === 'string' ? payload.text : '')
        || messageContent.body || messageContent.text?.body
        || (typeof messageContent.text === 'string' ? messageContent.text : '')
        || messageContent.caption || payload.content?.text || payload.body || '';
      const mediaUrl = payload.media?.url || payload.url || messageContent.url || messageContent.link
        || messageContent.image?.url || messageContent.image?.link
        || messageContent.document?.url || messageContent.document?.link
        || messageContent.video?.url || messageContent.video?.link || null;
      const [conversationResult] = await pool.query(
        `INSERT INTO crm_whatsapp_conversations
          (organization_id, integration_id, mobile, contact_name, last_message,
           last_message_time, unread_count, status)
         VALUES (?, ?, ?, ?, ?, NOW(), ?, 'ACTIVE')
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           contact_name = COALESCE(VALUES(contact_name), contact_name),
           last_message = VALUES(last_message),
           last_message_time = NOW(),
           unread_count = unread_count + VALUES(unread_count),
           updated_at = NOW()`,
        [
          integration.organization_id,
          integration.id,
          mobile,
          payload.contact_name || payload.userName || null,
          text || `[${payload.type || 'message'}]`,
          direction === 'incoming' ? 1 : 0
        ]
      );
      const conversationId = conversationResult.insertId;
      const [messageResult] = await pool.query(
        `INSERT INTO crm_whatsapp_messages
          (conversation_id, integration_id, message_id, client_request_id,
           direction, type, message, media_url, caption, status, api_response,
           provider_timestamp, sent_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          conversationId,
          integration.id,
          messageId,
          `webhook:${messageId}`,
          direction,
          String(payload.type || 'text').toLowerCase(),
          text,
          mediaUrl,
          payload.caption || messageContent.caption || null,
          normalizedStatus,
          JSON.stringify(payload),
          payload.timestamp
            ? new Date(Number(payload.timestamp) < 1000000000000 ? Number(payload.timestamp) * 1000 : payload.timestamp)
            : new Date(),
          direction === 'outgoing' ? new Date() : null
        ]
      );
      if (mediaUrl) {
        await pool.query(
          `INSERT INTO crm_whatsapp_attachments
            (message_id, file_name, mime_type, url, thumbnail, size)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            messageResult.insertId,
            payload.media?.filename || payload.filename || null,
            payload.media?.mime_type || payload.mime_type || null,
            mediaUrl,
            payload.media?.thumbnail || payload.thumbnail || null,
            payload.media?.size || payload.size || null
          ]
        );
      }
      res.json({ success: true, message: 'WhatsApp message stored' });
    } catch (error) {
      logger.error('[Webhook] WhatsApp message processing failed', { message: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  };

  // Both paths are supported so existing integrations continue receiving
  // replies while newer AiSensy connections use the canonical endpoint.
  router.post('/whatsapp/messages', handleMessageWebhook);
  router.post('/smartping/webhook', handleMessageWebhook);

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
        'SELECT id, status as current_status FROM crm_whatsapp_templates WHERE aisensy_template_id = ?',
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
        'UPDATE crm_whatsapp_templates SET status = ?, rejection_reason = ?, updated_at = ? WHERE id = ?',
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
        `INSERT INTO crm_whatsapp_template_logs (
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

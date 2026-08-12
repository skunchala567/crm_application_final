// =====================================================
// WhatsApp Webhook Routes
// Receives template status updates from AiSensy
// =====================================================

import crypto from 'node:crypto';
import express from 'express';

/**
 * A first-time inbound message from a number with no matching lead becomes
 * one -- unbranched and unassigned until someone in the CRM claims it (see
 * leadScopedWhere in app.js, which is what keeps it hidden from everyone but
 * admins until then). Channel and source are both fixed to WhatsApp.
 *
 * Guarded with GET_LOCK, mirroring the public-enquiry-form lead-creation
 * path in app.js: two webhook deliveries for the same brand-new number
 * arriving close together must not create two leads.
 */
async function createLeadFromWhatsApp(pool, { businessUnitId, integrationId, mobile, normalizedMobile, contactName }, logger) {
  const lockName = `crm-whatsapp-lead:${businessUnitId}:${normalizedMobile}`;
  const connection = await pool.getConnection();
  try {
    const [[lock]] = await connection.query('SELECT GET_LOCK(?,10) AS acquired', [lockName]);
    if (!Number(lock.acquired)) return null;
    await connection.beginTransaction();
    const [[existing]] = await connection.query(
      `SELECT id FROM crm_leads WHERE normalized_phone=? AND deleted_at_utc IS NULL
       ORDER BY updated_at_utc DESC LIMIT 1`,
      [normalizedMobile]
    );
    if (existing) {
      await connection.commit();
      return existing.id;
    }
    // crm_lead_stages is scoped per business unit (041_business_unit_shared_lead_pipeline),
    // so 'new' must be looked up within this lead's own unit.
    const [[stage]] = await connection.query(
      `SELECT id FROM crm_lead_stages WHERE business_unit_id=? AND name='new' LIMIT 1`,
      [businessUnitId]
    );
    const [[source]] = await connection.query(`SELECT id FROM crm_lead_sources WHERE name='whatsapp' LIMIT 1`);
    const [[channel]] = await connection.query(`SELECT id FROM crm_lead_channels WHERE channel_code='whatsapp' LIMIT 1`);
    const [[creator]] = await connection.query(
      `SELECT COALESCE(
         i.created_by,
         (SELECT u.id FROM app_users u
          JOIN user_roles ur ON ur.user_id=u.id
          JOIN roles r ON r.id=ur.role_id
          WHERE r.normalized_name IN ('CRM_ADMIN','SUPER_ADMIN')
          ORDER BY u.id LIMIT 1)
       ) AS id
       FROM crm_integrations i WHERE i.id=?`,
      [integrationId]
    );
    if (!stage?.id || !creator?.id) {
      await connection.commit();
      return null;
    }
    const temporaryNumber = `PENDING-${crypto.randomUUID()}`;
    const [result] = await connection.query(
      `INSERT INTO crm_leads
        (business_unit_id, lead_number, branch_id, student_name, phone, normalized_phone,
         stage_id, source_id, channel_id, owner_employee_id, remarks, created_by_user_id)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        businessUnitId, temporaryNumber,
        contactName || `WhatsApp ${mobile}`,
        mobile, normalizedMobile,
        stage.id, source?.id || null, channel?.id || null,
        'Auto-created from an inbound WhatsApp message.',
        creator.id
      ]
    );
    const leadNumber = `ADM-${new Date().getFullYear()}-${String(result.insertId).padStart(6, '0')}`;
    await connection.query('UPDATE crm_leads SET lead_number=? WHERE id=?', [leadNumber, result.insertId]);
    await connection.commit();
    logger.info('[Webhook] Auto-created lead from inbound WhatsApp message', { leadId: result.insertId, mobile });
    return result.insertId;
  } catch (error) {
    await connection.rollback().catch(() => {});
    logger.error('[Webhook] Failed to auto-create lead from WhatsApp message', { message: error.message, mobile });
    return null;
  } finally {
    await connection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
    connection.release();
  }
}

export function createWebhookRoutes(pool, logger = console) {
  const router = express.Router();

  const handleMessageWebhook = async (req, res) => {
    try {
      const root = req.body || {};

      // ── Payload normalisation ────────────────────────────────────────────
      // Smartping wraps the actual message two levels deep:
      //   root → root.data (object) → root.data.message (object)
      // Older flat payloads (AiSensy, test calls) put fields directly in
      // root.data, root.message, or root.eventData.
      const dataLevel = root.data && typeof root.data === 'object' ? root.data : null;
      const nested =
        // Smartping v2: root.data.message holds the real message object
        (dataLevel?.message && typeof dataLevel.message === 'object') ? dataLevel.message
        // Flat data envelope: root.data has the fields directly
        : dataLevel
        // Legacy: root.message envelope
        ?? (root.message && typeof root.message === 'object' ? root.message : null)
        // Legacy: root.eventData envelope
        ?? (root.eventData && typeof root.eventData === 'object' ? root.eventData : null)
        ?? {};

      // Merge so root-level fields (project_id, topic, etc.) are accessible
      // alongside the unwrapped message fields.
      const payload = { ...root, ...nested };

      // ── Message ID ──────────────────────────────────────────────────────
      // Prefer the WhatsApp-native messageId (wamid.HBg...) over internal IDs.
      const messageId = payload.messageId || payload.message_id || payload.messageIdString
        || nested.id || payload.id || payload.key?.id || root.id;

      // ── Status / sender / direction ─────────────────────────────────────
      const normalizedStatus = String(payload.status || 'RECEIVED').toUpperCase();
      const sender = String(payload.sender || payload.sender_type || payload.from_type || '').toUpperCase();
      const incomingSenders = new Set(['CONTACT', 'CUSTOMER', 'USER', 'CLIENT', 'RECEIVER']);
      // topic 'message.sender.user' means the end-user (contact) sent the message.
      const topicIsIncoming = typeof root.topic === 'string' && root.topic.includes('sender.user');
      const hasExplicitInboundPhone = !!(payload.from || payload.phone_number || payload.phoneNumber);
      const hasExplicitTo = !!(payload.to || payload.destination);
      const direction = String(
        payload.direction
        || root.direction
        || (incomingSenders.has(sender) || root.eventType === 'user-event'
            || topicIsIncoming
            || (hasExplicitInboundPhone && !hasExplicitTo)
          ? 'incoming'
          : 'outgoing')
      ).toLowerCase();

      // ── Phone number ─────────────────────────────────────────────────────
      // Smartping incoming payloads use 'phone_number'. Outbound status
      // callbacks use 'to' / 'destination'. Always fall back across both so
      // a missing 'sender' field never drops a valid message.
      const mobileDigits = String(
        direction === 'incoming'
          ? payload.from || payload.phone_number || payload.phoneNumber || payload.mobile
            || payload.wa_id || payload.contact?.phone || payload.user?.phone
            || payload.to || payload.destination
          : payload.to || payload.destination || payload.phone_number || payload.phoneNumber
            || payload.mobile || payload.wa_id || payload.from
      ).replace(/\D/g, '');
      const mobile = /^91[6-9]\d{9}$/.test(mobileDigits) ? mobileDigits.slice(2) : mobileDigits;

      // project_id lives at root level in Smartping's envelope.
      const projectId = root.project_id || root.projectId || payload.project_id || payload.projectId;

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
      const normalizedMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
      // The lead also says which business the conversation belongs to. An
      // inbound from a number nobody has as a lead cannot be attributed, so
      // it falls to the default unit rather than appearing in every unit.
      const [[linkedLead]] = await pool.query(
        `SELECT id, business_unit_id AS businessUnitId FROM crm_leads
         WHERE normalized_phone=? AND deleted_at_utc IS NULL
         ORDER BY updated_at_utc DESC LIMIT 1`,
        [normalizedMobile]
      );
      const [[fallbackUnit]] = linkedLead?.businessUnitId ? [[null]] : await pool.query(
        'SELECT id FROM crm_business_units WHERE is_default=TRUE ORDER BY id LIMIT 1'
      );
      const conversationUnitId = linkedLead?.businessUnitId || fallbackUnit?.id || null;
      let leadId = linkedLead?.id || null;
      if (!leadId && direction === 'incoming' && normalizedMobile && conversationUnitId) {
        leadId = await createLeadFromWhatsApp(pool, {
          businessUnitId: conversationUnitId,
          integrationId: integration.id,
          mobile,
          normalizedMobile,
          contactName: payload.contact_name || payload.userName || null,
        }, logger);
      }
      const [conversationResult] = await pool.query(
        `INSERT INTO crm_whatsapp_conversations
          (organization_id, business_unit_id, integration_id, mobile, contact_name, lead_id, last_message,
           last_message_time, unread_count, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, 'ACTIVE')
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           business_unit_id = COALESCE(business_unit_id, VALUES(business_unit_id)),
           contact_name = COALESCE(VALUES(contact_name), contact_name),
           lead_id = COALESCE(lead_id, VALUES(lead_id)),
           last_message = VALUES(last_message),
           last_message_time = NOW(),
           unread_count = unread_count + VALUES(unread_count),
           updated_at = NOW()`,
        [
          integration.organization_id,
          conversationUnitId,
          integration.id,
          mobile,
          payload.contact_name || payload.userName || null,
          leadId,
          text || `[${payload.type || 'message'}]`,
          direction === 'incoming' ? 1 : 0
        ]
      );
      const conversationId = conversationResult.insertId;
      const [messageResult] = await pool.query(
        `INSERT INTO crm_whatsapp_messages
          (conversation_id, integration_id, lead_id, message_id, client_request_id,
           direction, type, message, media_url, caption, status, api_response,
           provider_timestamp, sent_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          conversationId,
          integration.id,
          leadId,
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
  // Smartping registered the bare domain as its webhook URL, so message
  // events also arrive at the mount root with no path of their own.
  router.post('/', handleMessageWebhook);

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

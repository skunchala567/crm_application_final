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
  let visibilitySchemaReady = false;
  let pricingSchemaReady = false;

  async function ensureWhatsAppPricingSchema() {
    if (pricingSchemaReady) return;
    const [columns] = await pool.query(`
      SELECT column_name AS columnName
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'crm_integrations'
        AND column_name IN ('whatsapp_utility_message_price','whatsapp_marketing_message_price')
    `);
    const existing = new Set((columns || []).map(row => String(row.columnName || row.COLUMN_NAME || '').toLowerCase()));
    if (!existing.has('whatsapp_utility_message_price')) {
      await pool.query(`ALTER TABLE crm_integrations ADD COLUMN whatsapp_utility_message_price DECIMAL(10,4) NULL`);
    }
    if (!existing.has('whatsapp_marketing_message_price')) {
      await pool.query(`ALTER TABLE crm_integrations ADD COLUMN whatsapp_marketing_message_price DECIMAL(10,4) NULL`);
    }
    pricingSchemaReady = true;
  }

  async function ensureTemplateVisibilitySchema() {
    if (visibilitySchemaReady) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS crm_whatsapp_template_user_visibility (
        template_id INT NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (template_id, user_id),
        KEY ix_whatsapp_template_visibility_user (user_id),
        CONSTRAINT fk_whatsapp_template_visibility_template FOREIGN KEY (template_id)
          REFERENCES crm_whatsapp_templates(id) ON DELETE CASCADE,
        CONSTRAINT fk_whatsapp_template_visibility_user FOREIGN KEY (user_id)
          REFERENCES app_users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    visibilitySchemaReady = true;
  }

  const templateAdmin = user => (user?.roles || []).some(role => ['ADMIN','CRM_ADMIN'].includes(String(role).toUpperCase()));

  async function attachAndFilterTemplateVisibility(templates, user) {
    await ensureTemplateVisibilitySchema();
    const ids = [...new Set((templates || []).map(template => Number(template.id)).filter(Number.isFinite))];
    if (!ids.length) return [];
    const [rows] = await pool.query(
      `SELECT v.template_id AS templateId,v.user_id AS userId,
              COALESCE(e.employee_name,CONCAT_WS(' ',p.first_name,p.last_name),u.email) AS name,
              u.email
       FROM crm_whatsapp_template_user_visibility v
       JOIN app_users u ON u.id=v.user_id AND u.is_active=TRUE
       LEFT JOIN employees e ON e.id=u.employee_id
       LEFT JOIN crm_user_profiles p ON p.user_id=u.id
       WHERE v.template_id IN (${ids.map(() => '?').join(',')})
       ORDER BY name`,
      ids,
    );
    const map = new Map();
    for (const row of rows) {
      const key = Number(row.templateId);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ id: Number(row.userId), name: row.name || row.email, email: row.email });
    }
    const canSeeAll = templateAdmin(user);
    return templates
      .map(template => ({
        ...template,
        visibleUsers: map.get(Number(template.id)) || [],
        visibleUserIds: (map.get(Number(template.id)) || []).map(item => item.id),
      }))
      .filter(template => canSeeAll || template.visibleUserIds.includes(Number(user?.id)));
  }

  async function saveTemplateVisibility(templateId, userIds) {
    await ensureTemplateVisibilitySchema();
    const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map(Number).filter(value => Number.isInteger(value) && value > 0))];
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(`DELETE FROM crm_whatsapp_template_user_visibility WHERE template_id=?`, [Number(templateId)]);
      for (const userId of ids) {
        await connection.execute(
          `INSERT IGNORE INTO crm_whatsapp_template_user_visibility(template_id,user_id) VALUES(?,?)`,
          [Number(templateId), userId],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // ============= Integration Management =============

  /**
   * GET /whatsapp/integrations
   * List integrations (for selecting which one to use)
   */
  router.get('/integrations', authenticate, async (req, res, next) => {
    try {
      await ensureWhatsAppPricingSchema();
      const organizationId = req.user?.id || 1;
      const { provider } = req.query;

      let query = 'SELECT * FROM crm_integrations WHERE organization_id = ? AND deleted_at IS NULL';
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
          whatsappUtilityMessagePrice: i.whatsapp_utility_message_price ?? config.whatsappUtilityMessagePrice ?? null,
          whatsappMarketingMessagePrice: i.whatsapp_marketing_message_price ?? config.whatsappMarketingMessagePrice ?? null,
          created_at: i.created_at
        };
      });

      res.json({ success: true, data: formatted });
    } catch (error) {
      next(error);
    }
  });

  router.get('/dashboard', authenticate, async (req, res, next) => {
    try {
      await ensureWhatsAppPricingSchema();
      const organizationId = req.user?.id || 1;
      const days = Math.min(Math.max(Number(req.query.days || 7), 1), 365);
      const from = String(req.query.from || '').slice(0, 10);
      const to = String(req.query.to || '').slice(0, 10);
      const integrationId = req.query.integrationId ? Number(req.query.integrationId) : null;
      const branchId = req.query.branchId ? Number(req.query.branchId) : null;
      const params = [organizationId];
      let dateFilter = 'AND COALESCE(m.sent_at,m.created_at) >= DATE_SUB(CURDATE(), INTERVAL ? DAY)';
      if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
        dateFilter = 'AND DATE(COALESCE(m.sent_at,m.created_at)) BETWEEN ? AND ?';
        params.push(from, to);
      } else {
        params.push(days);
      }
      let integrationFilter = '';
      if (integrationId) {
        integrationFilter = ' AND m.integration_id = ?';
        params.push(integrationId);
      }
      let branchFilter = '';
      if (branchId) {
        branchFilter = ' AND l.branch_id = ?';
        params.push(branchId);
      }
      const [branchOptions] = await pool.query(`
        SELECT id, branch_name AS name
        FROM branches
        WHERE is_active=TRUE
        ORDER BY branch_name
      `);
      const [rows] = await pool.query(`
        SELECT DATE(COALESCE(m.sent_at,m.created_at)) AS day,
               m.integration_id AS integrationId,
               COALESCE(i.name, CONCAT('Integration ',m.integration_id)) AS integrationName,
               COALESCE(i.whatsapp_utility_message_price,0) AS utilityPrice,
               COALESCE(i.whatsapp_marketing_message_price,0) AS marketingPrice,
               COALESCE(l.branch_id,0) AS branchId,
               COALESCE(b.branch_name,'No branch') AS branchName,
               COALESCE(m.direction,'outgoing') AS direction,
               COALESCE(m.status,'UNKNOWN') AS status,
               COALESCE(m.template_name,'') AS templateName,
               COALESCE(m.campaign_name,'') AS campaignName,
               COUNT(*) AS messages
        FROM crm_whatsapp_messages m
        JOIN crm_integrations i ON i.id=m.integration_id
        LEFT JOIN crm_whatsapp_conversations wc ON wc.id=m.conversation_id
        LEFT JOIN crm_leads l ON l.id=COALESCE(m.lead_id,wc.lead_id) AND l.deleted_at_utc IS NULL
        LEFT JOIN branches b ON b.id=l.branch_id
        WHERE i.organization_id=?
          AND i.deleted_at IS NULL
          AND UPPER(COALESCE(m.status,'UNKNOWN')) NOT IN ('FAILED','REJECTED','ERROR')
          ${dateFilter}
          ${integrationFilter}
          ${branchFilter}
        GROUP BY DATE(COALESCE(m.sent_at,m.created_at)),m.integration_id,i.name,
                 i.whatsapp_utility_message_price,i.whatsapp_marketing_message_price,
                 COALESCE(l.branch_id,0),COALESCE(b.branch_name,'No branch'),
                 COALESCE(m.direction,'outgoing'),COALESCE(m.status,'UNKNOWN'),
                 COALESCE(m.template_name,''),COALESCE(m.campaign_name,'')
        ORDER BY day DESC
      `, params);
      const summary = { totalMessages: 0, utilityMessages: 0, marketingMessages: 0, incomingMessages: 0, delivered: 0, failed: 0, pending: 0, estimatedSpend: 0, utilitySpend: 0, marketingSpend: 0 };
      const dayMap = new Map();
      const integrationMap = new Map();
      const branchMap = new Map();
      const campaignMap = new Map();
      for (const row of rows) {
        const count = Number(row.messages || 0);
        const status = String(row.status || '').toUpperCase();
        const direction = String(row.direction || '').toLowerCase();
        const isIncoming = direction === 'incoming';
        const isMarketing = !isIncoming && Boolean(String(row.campaignName || '').trim());
        const category = isIncoming ? 'incoming' : isMarketing ? 'marketing' : 'utility';
        const price = category === 'marketing' ? Number(row.marketingPrice || 0) : category === 'utility' ? Number(row.utilityPrice || 0) : 0;
        const isChargeable = ['DELIVERED','READ','SENT','SUCCESS'].includes(status);
        const spend = isChargeable ? count * price : 0;
        summary.totalMessages += count;
        if (category === 'utility') { summary.utilityMessages += count; summary.utilitySpend += spend; }
        if (category === 'marketing') { summary.marketingMessages += count; summary.marketingSpend += spend; }
        if (category === 'incoming') summary.incomingMessages += count;
        if (['DELIVERED','READ','SENT','SUCCESS'].includes(status)) summary.delivered += count;
        else summary.pending += count;
        summary.estimatedSpend += spend;
        const dayKey = row.day instanceof Date ? row.day.toISOString().slice(0,10) : String(row.day).slice(0,10);
        const day = dayMap.get(dayKey) || { day: dayKey, utility: 0, marketing: 0, incoming: 0, spend: 0 };
        day[category] = (day[category] || 0) + count;
        day.spend += spend;
        dayMap.set(dayKey, day);
        const integration = integrationMap.get(row.integrationId) || { id: Number(row.integrationId), name: row.integrationName, messages: 0, spend: 0 };
        integration.messages += count;
        integration.spend += spend;
        integrationMap.set(row.integrationId, integration);
        const branchKey = String(row.branchId || 0);
        const branch = branchMap.get(branchKey) || { id: Number(row.branchId || 0), name: row.branchName || 'No branch', utility: 0, marketing: 0, incoming: 0, messages: 0, spend: 0 };
        branch[category] = (branch[category] || 0) + count;
        branch.messages += count;
        branch.spend += spend;
        branchMap.set(branchKey, branch);
        const campaignKey = String(row.campaignName || '').trim() || 'No campaign';
        const campaign = campaignMap.get(campaignKey) || { name: campaignKey, utility: 0, marketing: 0, incoming: 0, messages: 0, spend: 0 };
        campaign[category] = (campaign[category] || 0) + count;
        campaign.messages += count;
        campaign.spend += spend;
        campaignMap.set(campaignKey, campaign);
      }
      res.json({
        success: true,
        data: {
          summary,
          daily: Array.from(dayMap.values()).sort((a,b)=>a.day.localeCompare(b.day)),
          integrations: Array.from(integrationMap.values()).sort((a,b)=>b.messages-a.messages),
          branches: branchOptions.map(item => ({ id: Number(item.id), name: item.name })),
          branchWise: Array.from(branchMap.values()).sort((a,b)=>b.messages-a.messages),
          campaignWise: Array.from(campaignMap.values()).sort((a,b)=>b.messages-a.messages),
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/template-visibility-users', authenticate, async (req, res, next) => {
    try {
      const [users] = await pool.query(`
        SELECT DISTINCT u.id,
               COALESCE(e.employee_name,CONCAT_WS(' ',p.first_name,p.last_name),u.email) AS name,
               u.email
        FROM app_users u
        JOIN user_roles ur ON ur.user_id=u.id
        JOIN roles r ON r.id=ur.role_id
        LEFT JOIN employees e ON e.id=u.employee_id
        LEFT JOIN crm_user_profiles p ON p.user_id=u.id
        WHERE u.is_active=TRUE
          AND r.normalized_name IN ('ADMIN','CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR','CRM_VIEWER')
        ORDER BY name
      `);
      res.json({ success: true, data: users.map(user => ({ id: Number(user.id), name: user.name || user.email, email: user.email })) });
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
      const visibleTemplates = await attachAndFilterTemplateVisibility(templates, req.user);

      // Apply pagination
      const paginatedTemplates = visibleTemplates.slice(
        parseInt(offset),
        parseInt(offset) + parseInt(limit)
      );

      res.json({
        success: true,
        data: paginatedTemplates,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: visibleTemplates.length
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
      await saveTemplateVisibility(template.id, req.body.visibleUserIds);

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

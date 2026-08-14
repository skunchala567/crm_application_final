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

  /**
   * The WhatsApp accounts this user may send from.
   *
   * An administrator sees every connected account. Everyone else sees the
   * accounts mapped to the branches they are assigned to -- which is what
   * gives a counsellor an account to pick at all, rather than an empty
   * selector and a send that cannot be attributed.
   *
   * A branch with no mapping yields nothing rather than everything: sending
   * from an arbitrary school's WhatsApp number is worse than being told the
   * branch has not been set up.
   */
  router.get('/accounts', authenticate, async (req, res, next) => {
    try {
      const isAdmin = req.user.roles?.some((role) =>
        ['CRM_ADMIN', 'SUPER_ADMIN'].includes(String(role).toUpperCase()));

      const [rows] = isAdmin
        ? await pool.query(
          `SELECT i.id, i.name, NULL AS branchId, NULL AS branchName, FALSE AS isDefault
             FROM crm_integrations i
            WHERE i.provider IN ('smartping','whatsapp','aisensy')
            ORDER BY i.name`)
        : await pool.execute(
          `SELECT DISTINCT i.id, i.name, b.id AS branchId, b.branch_name AS branchName,
                  bwa.is_default AS isDefault
             FROM crm_branch_whatsapp_accounts bwa
             JOIN crm_integrations i ON i.id = bwa.integration_id
             JOIN branches b ON b.id = bwa.branch_id AND b.is_active = 1
             JOIN crm_user_branches cub ON cub.branch_id = bwa.branch_id AND cub.user_id = ?
            ORDER BY bwa.is_default DESC, i.name`,
          [Number(req.user.id)]);

      res.json({
        data: rows.map((row) => ({
          id: Number(row.id),
          name: row.name,
          branchId: row.branchId ? Number(row.branchId) : null,
          branchName: row.branchName || null,
          isDefault: Boolean(Number(row.isDefault)),
        })),
      });
    } catch (error) { next(error); }
  });

  /** Which branches an account serves. Administration only. */
  router.get('/accounts/:id/branches', authenticate, async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        `SELECT branch_id AS branchId, is_default AS isDefault
           FROM crm_branch_whatsapp_accounts WHERE integration_id = ?`,
        [Number(req.params.id)]);
      res.json({ data: rows.map((r) => ({ branchId: Number(r.branchId), isDefault: Boolean(Number(r.isDefault)) })) });
    } catch (error) { next(error); }
  });

  /** Replace the branches an account serves. */
  router.put('/accounts/:id/branches', authenticate, async (req, res, next) => {
    const isAdmin = req.user.roles?.some((role) =>
      ['CRM_ADMIN', 'SUPER_ADMIN'].includes(String(role).toUpperCase()));
    if (!isAdmin) return res.status(403).json({ message: 'Only a CRM administrator can map WhatsApp accounts to branches' });

    const integrationId = Number(req.params.id);
    const branchIds = [...new Set((req.body?.branchIds || [])
      .map(Number).filter((id) => Number.isInteger(id) && id > 0))];

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('DELETE FROM crm_branch_whatsapp_accounts WHERE integration_id = ?', [integrationId]);
      for (const branchId of branchIds) {
        // A branch sends from one account by default; assigning it here makes
        // this that default and clears any other for the same branch.
        await connection.execute('UPDATE crm_branch_whatsapp_accounts SET is_default = FALSE WHERE branch_id = ?', [branchId]);
        await connection.execute(
          `INSERT INTO crm_branch_whatsapp_accounts (branch_id, integration_id, is_default, created_by_user_id)
           VALUES (?,?,TRUE,?)`,
          [branchId, integrationId, Number(req.user.id) || null]);
      }
      await connection.commit();
      res.json({ message: `Account mapped to ${branchIds.length} branch(es)` });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally { connection.release(); }
  });

  /** The whole branch -> accounts mapping, for the settings screen. */

  /**
   * Where enquiries from this WhatsApp account become leads.
   *
   * Read alongside the branches the account already sends from, so the screen
   * can suggest a branch instead of asking blind.
   */
  router.get('/accounts/:id/lead-intake', authenticate, async (req, res, next) => {
    try {
      const integrationId = Number(req.params.id);
      const [[settings]] = await pool.execute(
        `SELECT integration_id AS integrationId, auto_create_lead AS autoCreateLead,
                business_unit_id AS businessUnitId, branch_id AS branchId,
                assignment_mode AS assignmentMode, owner_employee_id AS ownerEmployeeId
         FROM crm_whatsapp_lead_intake WHERE integration_id=?`,
        [integrationId],
      );
      const [branches] = await pool.execute(
        `SELECT b.id, b.branch_name AS name FROM crm_branch_whatsapp_accounts bwa
         JOIN branches b ON b.id = bwa.branch_id AND b.is_active = TRUE
         WHERE bwa.integration_id = ? ORDER BY b.branch_name`,
        [integrationId],
      );
      res.json({
        data: settings || {
          integrationId, autoCreateLead: 1, businessUnitId: null,
          branchId: null, assignmentMode: 'unassigned', ownerEmployeeId: null,
        },
        mappedBranches: branches,
      });
    } catch (error) { next(error); }
  });

  router.put('/accounts/:id/lead-intake', authenticate, async (req, res, next) => {
    try {
      const integrationId = Number(req.params.id);
      const mode = ['unassigned', 'rule', 'fixed'].includes(req.body.assignmentMode) ? req.body.assignmentMode : 'unassigned';
      // A fixed assignment with nobody named would silently behave as
      // unassigned, so say so rather than saving something that does nothing.
      if (mode === 'fixed' && !Number(req.body.ownerEmployeeId)) {
        return res.status(400).json({ message: 'Choose the counsellor these leads should go to' });
      }
      await pool.execute(
        `INSERT INTO crm_whatsapp_lead_intake
           (integration_id, auto_create_lead, business_unit_id, branch_id, assignment_mode, owner_employee_id, updated_by_user_id)
         VALUES (?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           auto_create_lead=VALUES(auto_create_lead), business_unit_id=VALUES(business_unit_id),
           branch_id=VALUES(branch_id), assignment_mode=VALUES(assignment_mode),
           owner_employee_id=VALUES(owner_employee_id), updated_by_user_id=VALUES(updated_by_user_id)`,
        [
          integrationId,
          req.body.autoCreateLead === false ? 0 : 1,
          Number(req.body.businessUnitId) || null,
          Number(req.body.branchId) || null,
          mode,
          mode === 'fixed' ? Number(req.body.ownerEmployeeId) : null,
          Number(req.user?.id) || null,
        ],
      );
      res.json({ message: 'WhatsApp lead intake saved' });
    } catch (error) { next(error); }
  });

  router.get('/branch-accounts', authenticate, async (_req, res, next) => {
    try {
      const [rows] = await pool.query(
        `SELECT branch_id AS branchId, integration_id AS integrationId, is_default AS isDefault
           FROM crm_branch_whatsapp_accounts
          ORDER BY branch_id, is_default DESC, integration_id`);
      res.json({
        data: rows.map((r) => ({
          branchId: Number(r.branchId),
          integrationId: Number(r.integrationId),
          isDefault: Boolean(Number(r.isDefault)),
        })),
      });
    } catch (error) { next(error); }
  });

  /**
   * Replace the mapping for the branches supplied.
   *
   * Saved per branch rather than per account so the default is deterministic:
   * the first account listed for a branch is its default. Writing account by
   * account made the default depend on which account happened to be saved
   * last, which is not something the screen can control.
   *
   * Only the branches in the payload are touched, so two administrators
   * editing different branches do not overwrite each other.
   */
  router.put('/branch-accounts', authenticate, async (req, res, next) => {
    const isAdmin = req.user.roles?.some((role) =>
      ['CRM_ADMIN', 'SUPER_ADMIN'].includes(String(role).toUpperCase()));
    if (!isAdmin) return res.status(403).json({ message: 'Only a CRM administrator can map WhatsApp accounts to branches' });

    const entries = Array.isArray(req.body?.branches) ? req.body.branches : [];
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      let written = 0;
      for (const entry of entries) {
        const branchId = Number(entry?.branchId);
        if (!Number.isInteger(branchId) || branchId <= 0) continue;
        const integrationIds = [...new Set((entry?.integrationIds || [])
          .map(Number).filter((id) => Number.isInteger(id) && id > 0))];

        await connection.execute('DELETE FROM crm_branch_whatsapp_accounts WHERE branch_id = ?', [branchId]);
        for (const [index, integrationId] of integrationIds.entries()) {
          await connection.execute(
            `INSERT INTO crm_branch_whatsapp_accounts (branch_id, integration_id, is_default, created_by_user_id)
             VALUES (?,?,?,?)`,
            [branchId, integrationId, index === 0 ? 1 : 0, Number(req.user.id) || null]);
          written += 1;
        }
      }
      await connection.commit();
      res.json({ message: `Saved ${written} branch/account link(s)` });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally { connection.release(); }
  });

  /** Who may use a template. Empty means nobody but administrators. */
  router.get('/templates/:id/users', authenticate, async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        'SELECT user_id AS userId FROM crm_whatsapp_template_user_visibility WHERE template_id = ?',
        [Number(req.params.id)]);
      res.json({ data: rows.map((r) => Number(r.userId)) });
    } catch (error) { next(error); }
  });

  router.put('/templates/:id/users', authenticate, async (req, res, next) => {
    const isAdmin = req.user.roles?.some((role) =>
      ['CRM_ADMIN', 'SUPER_ADMIN'].includes(String(role).toUpperCase()));
    if (!isAdmin) return res.status(403).json({ message: 'Only a CRM administrator can assign templates' });

    const templateId = Number(req.params.id);
    const userIds = [...new Set((req.body?.userIds || [])
      .map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('DELETE FROM crm_whatsapp_template_user_visibility WHERE template_id = ?', [templateId]);
      for (const userId of userIds) {
        await connection.execute(
          'INSERT IGNORE INTO crm_whatsapp_template_user_visibility (template_id, user_id) VALUES (?,?)',
          [templateId, userId]);
      }
      await connection.commit();
      res.json({ message: `Template shared with ${userIds.length} user(s)` });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally { connection.release(); }
  });

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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    visibilitySchemaReady = true;
  }

  const templateAdmin = user => (user?.roles || []).some(role => ['CRM_ADMIN','SUPER_ADMIN'].includes(String(role).toUpperCase()));

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

  /**
   * Resolve a template by whichever identifier the caller has.
   *
   * The list screen sends the internal id, while these routes were written to
   * look up by aisensy_template_id -- so Edit answered "Template not found"
   * for every template. A template created locally and not yet synced has no
   * aisensy id at all, so accepting both is the only thing that works for all
   * of them.
   */
  async function resolveTemplateKey(integrationId, key) {
    const [[row]] = await pool.execute(
      `SELECT aisensy_template_id AS aisensyId FROM crm_whatsapp_templates
        WHERE integration_id = ? AND deleted_at IS NULL AND (aisensy_template_id = ? OR id = ?)
        LIMIT 1`,
      [integrationId, String(key), Number(key) || 0]);
    return row?.aisensyId ?? key;
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
      const organizationId = req.user?.organizationId || 1;
      const { provider } = req.query;

      let query = 'SELECT * FROM crm_integrations WHERE organization_id = ? AND deleted_at IS NULL';
      const params = [organizationId];

      if (provider) {
        // Older rows carry the ENUM in `type`; hub-created rows also set
        // `provider` (e.g. 'smartping'). Accept either so an account is not
        // hidden by which of the two columns happened to be filled in.
        query += " AND (UPPER(COALESCE(type, '')) = ? OR UPPER(COALESCE(provider, '')) = ?)";
        params.push(provider.toUpperCase(), provider.toUpperCase());
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
      const organizationId = req.user?.organizationId || 1;
      const days = Math.min(Math.max(Number(req.query.days || 7), 1), 365);
      const from = String(req.query.from || '').slice(0, 10);
      const to = String(req.query.to || '').slice(0, 10);
      const integrationId = req.query.integrationId ? Number(req.query.integrationId) : null;
      // The branch picker is a multi-select and sends a comma-separated list.
      // `Number('3,5')` is NaN, so more than one branch used to filter nothing.
      const branchIdList = String(req.query.branchId || '')
        .split(',')
        .map(value => Number(value.trim()))
        .filter(value => Number.isInteger(value) && value > 0);
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
      if (branchIdList.length) {
        branchFilter = ` AND l.branch_id IN (${branchIdList.map(() => '?').join(',')})`;
        params.push(...branchIdList);
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
          AND r.normalized_name IN ('CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR','CRM_VIEWER','SUPER_ADMIN')
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
      const organizationId = req.user?.organizationId || 1;
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
      const integrationId = parseInt(req.params.integrationId);

      if (isNaN(integrationId)) {
        return res.status(400).json({ success: false, message: 'Invalid integration ID' });
      }

      /*
       * The organisation comes from the integration, not from the caller.
       *
       * This read `req.user?.id`, treating a user id as an organisation id.
       * Every account and template here belongs to organisation 1, so only
       * user 1 ever saw a template: a counsellor got an empty list however
       * their branch was mapped. Which templates a user may actually use is
       * decided below by attachAndFilterTemplateVisibility, which is the
       * mechanism intended for it.
       */
      const [[owner]] = await pool.execute(
        'SELECT organization_id AS organizationId FROM crm_integrations WHERE id = ? LIMIT 1',
        [integrationId]);
      if (!owner) return res.status(404).json({ success: false, message: 'WhatsApp account not found' });
      const organizationId = Number(owner.organizationId) || 1;

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
      const integrationId = parseInt(req.params.integrationId);
      if (isNaN(integrationId)) {
        return res.status(400).json({ success: false, message: 'Invalid integration ID' });
      }
      const [[owner]] = await pool.execute(
        'SELECT organization_id AS organizationId FROM crm_integrations WHERE id = ? LIMIT 1', [integrationId]);
      const organizationId = Number(owner?.organizationId) || 1;
      const aisensy_template_id = await resolveTemplateKey(integrationId, req.params.aisensy_template_id);

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
      const integrationId = parseInt(req.params.integrationId);
      // Same as the listing: the organisation belongs to the account, not to
      // whoever happens to be creating the template. Filing it under the
      // creator's user id would hide it from the list, which resolves the
      // organisation from the integration.
      const [[templateOwner]] = await pool.execute(
        'SELECT organization_id AS organizationId FROM crm_integrations WHERE id = ? LIMIT 1',
        [integrationId]);
      const organizationId = Number(templateOwner?.organizationId) || 1;

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
      const integrationId = parseInt(req.params.integrationId);
      if (isNaN(integrationId)) {
        return res.status(400).json({ success: false, message: 'Invalid integration ID' });
      }
      const [[owner]] = await pool.execute(
        'SELECT organization_id AS organizationId FROM crm_integrations WHERE id = ? LIMIT 1', [integrationId]);
      const organizationId = Number(owner?.organizationId) || 1;
      const aisensy_template_id = await resolveTemplateKey(integrationId, req.params.aisensy_template_id);

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
      const organizationId = req.user?.organizationId || 1;
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
      const organizationId = req.user?.organizationId || 1;
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

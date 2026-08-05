import { Router } from 'express';
import { encryptToken, getMasterKey } from '../integration-hub/crypto-utils.js';
import {
  listPages, subscribePageToLeadgen, unsubscribePage,
  listLeadForms, listFormLeads, debugToken, GRAPH_VERSION,
} from './meta-client.js';
import {
  loadMetaConfig, saveMetaConfig, redactMetaConfig, META_PROVIDER,
} from './meta-config.js';
import { importMetaLead, decryptPageToken, mapFieldData } from './meta-lead.service.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parseJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function requireConfigured(config, needs = []) {
  if (!config) throw Object.assign(new Error('Meta integration is not configured'), { status: 400 });
  for (const key of needs) {
    if (!config[key]) {
      throw Object.assign(new Error(`Meta integration is missing ${key}. Save it in Settings first.`), { status: 400 });
    }
  }
}

export function createMetaRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin, logger = console) {
  const router = Router();
  router.use(authenticate, requireCrmAccess);

  const publicBase = () => (process.env.API_PUBLIC_URL || process.env.PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');

  // ---------------- Config ----------------

  router.get('/config', wrap(async (_req, res) => {
    const config = await loadMetaConfig(pool, { useCache: false });
    const base = publicBase();
    res.json({
      success: true,
      data: {
        configured: Boolean(config?.appSecret && config?.systemUserToken),
        graphVersion: GRAPH_VERSION,
        // Meta requires an https URL it can reach; localhost will not work.
        webhookUrl: base ? `${base}/api/meta/webhook` : '(set PUBLIC_API_BASE_URL to display)',
        config: redactMetaConfig(config),
      },
    });
  }));

  router.put('/config', requireUserAdmin, wrap(async (req, res) => {
    const saved = await saveMetaConfig(pool, req.body || {}, {
      organizationId: Number(req.user?.organizationId || 1),
      userId: Number(req.user?.id) || null,
    });
    res.json({ success: true, data: redactMetaConfig(saved) });
  }));

  /** Validate the system user token against Meta and report scopes/expiry. */
  router.post('/config/test', requireUserAdmin, wrap(async (_req, res) => {
    const config = await loadMetaConfig(pool, { useCache: false });
    requireConfigured(config, ['appId', 'appSecret', 'systemUserToken']);
    const info = await debugToken(config.systemUserToken, config.appId, config.appSecret, { logger });
    res.json({
      success: true,
      data: {
        valid: Boolean(info?.is_valid),
        appId: info?.app_id ?? null,
        type: info?.type ?? null,
        // 0 means "never expires", which is what a system user token should be.
        expiresAt: info?.expires_at ? new Date(info.expires_at * 1000).toISOString() : null,
        scopes: info?.scopes || [],
      },
    });
  }));

  // ---------------- Pages ----------------

  router.get('/pages', wrap(async (_req, res) => {
    const [rows] = await pool.execute(
      `SELECT id, page_id, page_name, is_subscribed, subscribed_at_utc, subscribe_error,
              business_unit_id, branch_id, is_active, updated_at_utc
         FROM crm_meta_pages ORDER BY page_name ASC`,
    );
    res.json({ success: true, data: rows });
  }));

  /**
   * Discover every Page the system user manages, store each Page's own token,
   * and subscribe it to leadgen notifications.
   *
   * One Page failing must not abort the run, so each is isolated -- a Page the
   * token cannot manage is reported and skipped rather than killing the sync.
   */
  router.post('/pages/sync', requireUserAdmin, wrap(async (req, res) => {
    const config = await loadMetaConfig(pool, { useCache: false });
    requireConfigured(config, ['systemUserToken']);

    const shouldSubscribe = req.body?.subscribe !== false && config.autoSubscribePages !== false;
    const masterKey = getMasterKey();
    const pages = await listPages(config.systemUserToken, { logger });
    const results = [];

    for (const page of pages) {
      const pageId = String(page.id);
      let subscribed = false;
      let subscribeError = null;

      if (shouldSubscribe) {
        try {
          subscribed = await subscribePageToLeadgen(pageId, page.access_token, { logger });
          if (!subscribed) subscribeError = 'Meta returned success=false';
        } catch (error) {
          subscribeError = error.message;
        }
      }

      await pool.execute(
        `INSERT INTO crm_meta_pages
           (integration_id, page_id, page_name, access_token_encrypted,
            is_subscribed, subscribed_at_utc, subscribe_error)
         VALUES (?,?,?,?,?,${subscribed ? 'CURRENT_TIMESTAMP(6)' : 'NULL'},?)
         ON DUPLICATE KEY UPDATE
           integration_id=VALUES(integration_id),
           page_name=VALUES(page_name),
           access_token_encrypted=VALUES(access_token_encrypted),
           is_subscribed=VALUES(is_subscribed),
           subscribed_at_utc=COALESCE(VALUES(subscribed_at_utc), subscribed_at_utc),
           subscribe_error=VALUES(subscribe_error),
           updated_at_utc=CURRENT_TIMESTAMP(6)`,
        [
          Number(config.integrationId), pageId, page.name || null,
          page.access_token ? encryptToken(page.access_token, masterKey) : null,
          subscribed ? 1 : 0, subscribeError,
        ],
      );

      logger.info?.(`[Meta] ${subscribed ? 'OK  ' : 'SKIP'} ${page.name} (${pageId})`);
      results.push({ pageId, name: page.name || null, subscribed, error: subscribeError });
    }

    res.json({
      success: true,
      data: {
        total: results.length,
        subscribed: results.filter((r) => r.subscribed).length,
        failed: results.filter((r) => r.error).length,
        pages: results,
      },
    });
  }));

  router.patch('/pages/:pageId', requireUserAdmin, wrap(async (req, res) => {
    const fields = [];
    const params = [];
    for (const [column, key] of [
      ['business_unit_id', 'businessUnitId'],
      ['branch_id', 'branchId'],
      ['is_active', 'isActive'],
    ]) {
      if (req.body?.[key] !== undefined) {
        fields.push(`${column}=?`);
        params.push(key === 'isActive' ? (req.body[key] ? 1 : 0) : (Number(req.body[key]) || null));
      }
    }
    if (!fields.length) return res.status(400).json({ message: 'No updatable fields supplied' });
    params.push(String(req.params.pageId));
    const [result] = await pool.execute(
      `UPDATE crm_meta_pages SET ${fields.join(', ')}, updated_at_utc=CURRENT_TIMESTAMP(6) WHERE page_id=?`,
      params,
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Page not found' });
    res.json({ success: true });
  }));

  router.post('/pages/:pageId/unsubscribe', requireUserAdmin, wrap(async (req, res) => {
    const [[page]] = await pool.execute(`SELECT * FROM crm_meta_pages WHERE page_id=? LIMIT 1`, [String(req.params.pageId)]);
    if (!page) return res.status(404).json({ message: 'Page not found' });
    const token = decryptPageToken(page);
    if (!token) return res.status(400).json({ message: 'No usable Page token; re-sync Pages' });

    const ok = await unsubscribePage(page.page_id, token, { logger });
    await pool.execute(
      `UPDATE crm_meta_pages SET is_subscribed=0, updated_at_utc=CURRENT_TIMESTAMP(6) WHERE page_id=?`,
      [page.page_id],
    );
    res.json({ success: true, data: { unsubscribed: ok } });
  }));

  // ---------------- Forms ----------------

  router.get('/forms', wrap(async (req, res) => {
    const pageId = req.query.pageId ? String(req.query.pageId) : null;
    const [rows] = pageId
      ? await pool.execute(`SELECT * FROM crm_meta_forms WHERE page_id=? ORDER BY form_name ASC`, [pageId])
      : await pool.execute(`SELECT * FROM crm_meta_forms ORDER BY form_name ASC`);
    res.json({
      success: true,
      data: rows.map((row) => ({ ...row, field_mapping: parseJson(row.field_mapping, {}) })),
    });
  }));

  /** Pull the Page's lead forms and their question names for mapping. */
  router.post('/pages/:pageId/forms/sync', requireUserAdmin, wrap(async (req, res) => {
    const [[page]] = await pool.execute(`SELECT * FROM crm_meta_pages WHERE page_id=? LIMIT 1`, [String(req.params.pageId)]);
    if (!page) return res.status(404).json({ message: 'Page not found' });
    const token = decryptPageToken(page);
    if (!token) return res.status(400).json({ message: 'No usable Page token; re-sync Pages' });

    const forms = await listLeadForms(page.page_id, token, { logger });
    for (const form of forms) {
      await pool.execute(
        `INSERT INTO crm_meta_forms (page_id, form_id, form_name, form_status, last_synced_at_utc)
         VALUES (?,?,?,?,CURRENT_TIMESTAMP(6))
         ON DUPLICATE KEY UPDATE
           page_id=VALUES(page_id), form_name=VALUES(form_name),
           form_status=VALUES(form_status), last_synced_at_utc=CURRENT_TIMESTAMP(6)`,
        [page.page_id, String(form.id), form.name || null, form.status || null],
      );
    }

    res.json({
      success: true,
      data: forms.map((form) => ({
        formId: String(form.id),
        name: form.name || null,
        status: form.status || null,
        // Surfacing question names lets the UI build the mapping dropdowns.
        questions: (form.questions || []).map((q) => ({ key: q.key || q.name, label: q.label, type: q.type })),
      })),
    });
  }));

  router.patch('/forms/:formId', requireUserAdmin, wrap(async (req, res) => {
    const fields = [];
    const params = [];
    const columnMap = [
      ['business_unit_id', 'businessUnitId'], ['branch_id', 'branchId'],
      ['source_id', 'sourceId'], ['channel_id', 'channelId'], ['campaign_id', 'campaignId'],
      ['stage_id', 'stageId'], ['substage_id', 'substageId'],
      ['owner_employee_id', 'ownerEmployeeId'], ['class_id', 'classId'],
      ['curriculum_id', 'curriculumId'],
    ];
    for (const [column, key] of columnMap) {
      if (req.body?.[key] !== undefined) {
        fields.push(`${column}=?`);
        params.push(Number(req.body[key]) || null);
      }
    }
    if (req.body?.academicYear !== undefined) {
      fields.push('academic_year=?');
      params.push(req.body.academicYear || null);
    }
    if (req.body?.isActive !== undefined) {
      fields.push('is_active=?');
      params.push(req.body.isActive ? 1 : 0);
    }
    if (req.body?.fieldMapping !== undefined) {
      fields.push('field_mapping=?');
      params.push(JSON.stringify(req.body.fieldMapping || {}));
    }
    if (!fields.length) return res.status(400).json({ message: 'No updatable fields supplied' });

    params.push(String(req.params.formId));
    const [result] = await pool.execute(
      `UPDATE crm_meta_forms SET ${fields.join(', ')}, updated_at_utc=CURRENT_TIMESTAMP(6) WHERE form_id=?`,
      params,
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Form not found' });
    res.json({ success: true });
  }));

  /**
   * Pull historical leads for a form.
   *
   * Also the fallback ingest path when Meta cannot reach the webhook (local
   * dev, or before the app is live). Safe to re-run: the ledger dedupes.
   */
  router.post('/forms/:formId/backfill', requireUserAdmin, wrap(async (req, res) => {
    const config = await loadMetaConfig(pool, { useCache: false });
    requireConfigured(config, []);

    const formId = String(req.params.formId);
    const [[form]] = await pool.execute(`SELECT * FROM crm_meta_forms WHERE form_id=? LIMIT 1`, [formId]);
    if (!form) return res.status(404).json({ message: 'Form not found. Sync forms for its Page first.' });

    const [[page]] = await pool.execute(`SELECT * FROM crm_meta_pages WHERE page_id=? LIMIT 1`, [form.page_id]);
    const token = decryptPageToken(page);
    if (!token) return res.status(400).json({ message: 'No usable Page token; re-sync Pages' });

    // Default to the stored watermark so repeat runs stay cheap.
    const since = req.body?.since !== undefined
      ? (Number(req.body.since) || null)
      : (form.last_backfill_time ? Number(form.last_backfill_time) : null);

    const leads = await listFormLeads(formId, token, { sinceEpochSeconds: since, logger });

    const summary = { fetched: leads.length, imported: 0, duplicate: 0, failed: 0, skipped: 0, reenquired: 0 };
    let watermark = since || 0;

    for (const lead of leads) {
      const createdTime = lead.created_time ? Math.floor(new Date(lead.created_time).getTime() / 1000) : null;
      if (createdTime && createdTime > watermark) watermark = createdTime;

      const result = await importMetaLead(pool, {
        leadgenId: String(lead.id),
        formId,
        pageId: form.page_id,
        adId: lead.ad_id || null,
        campaignMetaId: lead.campaign_id || null,
        createdTime,
        leadData: lead,
        intakeSource: 'backfill',
        config,
        logger,
      });
      if (summary[result.status] !== undefined) summary[result.status] += 1;
    }

    if (watermark) {
      await pool.execute(
        `UPDATE crm_meta_forms SET last_backfill_time=?, last_synced_at_utc=CURRENT_TIMESTAMP(6) WHERE form_id=?`,
        [watermark, formId],
      );
    }

    res.json({ success: true, data: { ...summary, watermark } });
  }));

  /** Preview how a form's questions currently map, without importing. */
  router.get('/forms/:formId/mapping-preview', wrap(async (req, res) => {
    const formId = String(req.params.formId);
    const [[form]] = await pool.execute(`SELECT * FROM crm_meta_forms WHERE form_id=? LIMIT 1`, [formId]);
    if (!form) return res.status(404).json({ message: 'Form not found' });

    const [[recent]] = await pool.execute(
      `SELECT raw_payload FROM crm_meta_lead_imports
        WHERE form_id=? AND raw_payload IS NOT NULL ORDER BY id DESC LIMIT 1`,
      [formId],
    );
    if (!recent) {
      return res.json({ success: true, data: { sample: null, message: 'No captured lead yet to preview against' } });
    }

    const payload = parseJson(recent.raw_payload, {});
    const { record, unmapped } = mapFieldData(payload.field_data, parseJson(form.field_mapping, {}));
    res.json({ success: true, data: { mapped: record, unmapped } });
  }));

  // ---------------- Import ledger ----------------

  router.get('/imports', wrap(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const status = req.query.status ? String(req.query.status) : null;
    const [rows] = status
      ? await pool.query(
        `SELECT i.*, l.lead_number FROM crm_meta_lead_imports i
           LEFT JOIN crm_leads l ON l.id = i.lead_id
          WHERE i.status=? ORDER BY i.id DESC LIMIT ?`, [status, limit])
      : await pool.query(
        `SELECT i.*, l.lead_number FROM crm_meta_lead_imports i
           LEFT JOIN crm_leads l ON l.id = i.lead_id
          ORDER BY i.id DESC LIMIT ?`, [limit]);

    const [[counts]] = await pool.execute(
      `SELECT
         SUM(status='imported')  AS imported,
         SUM(status='duplicate') AS duplicates,
         SUM(status='failed')    AS failed,
         SUM(status='skipped')   AS skipped,
         SUM(status='pending')   AS pending
       FROM crm_meta_lead_imports`,
    );

    res.json({ success: true, data: { counts, imports: rows } });
  }));

  /** Re-run a failed import. Only 'failed' rows are re-claimable. */
  router.post('/imports/:leadgenId/retry', requireUserAdmin, wrap(async (req, res) => {
    const leadgenId = String(req.params.leadgenId);
    const [[row]] = await pool.execute(`SELECT * FROM crm_meta_lead_imports WHERE leadgen_id=? LIMIT 1`, [leadgenId]);
    if (!row) return res.status(404).json({ message: 'Import record not found' });
    if (row.status !== 'failed') {
      return res.status(409).json({ message: `Only failed imports can be retried (status: ${row.status})` });
    }

    const config = await loadMetaConfig(pool, { useCache: false });
    const result = await importMetaLead(pool, {
      leadgenId,
      formId: row.form_id,
      pageId: row.page_id,
      adId: row.ad_id,
      campaignMetaId: row.campaign_meta_id,
      createdTime: row.meta_created_time,
      intakeSource: 'retry',
      config,
      logger,
    });
    res.json({ success: true, data: result });
  }));

  return router;
}

export { META_PROVIDER };
export default createMetaRoutes;

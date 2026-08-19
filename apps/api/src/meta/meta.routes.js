import { Router } from 'express';
import { encryptToken, getMasterKey } from '../integration-hub/crypto-utils.js';
import { referenceBranchScopeSql } from '../rbac/branch-scope.js';
import {
  listPages, subscribePageToLeadgen, unsubscribePage,
  listLeadForms, listFormLeads, debugToken, getTokenOwner, GRAPH_VERSION,
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

  /**
   * Names for the routing pickers, so the screen never asks for a raw row id.
   *
   * `users` mirrors requireCrmAccess: an active account, CRM access not revoked,
   * and at least one CRM role. Anyone missing those cannot be the importing
   * user, so offering them would just produce failed imports.
   */
  router.get('/lookups', wrap(async (req, res) => {
    const [users] = await pool.execute(
      `SELECT u.id,
              COALESCE(e.employee_name, CONCAT_WS(' ', p.first_name, p.last_name), u.email) AS name,
              u.email
         FROM app_users u
         LEFT JOIN crm_user_access_status cuas ON cuas.user_id = u.id
         LEFT JOIN employees e ON e.id = u.employee_id
         LEFT JOIN crm_user_profiles p ON p.user_id = u.id
        WHERE u.is_active = TRUE
          AND COALESCE(cuas.is_active, 1) = 1
          AND EXISTS (
            SELECT 1 FROM user_roles ur
              JOIN roles r ON r.id = ur.role_id
             WHERE ur.user_id = u.id
               AND r.normalized_name IN ('CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR','CRM_VIEWER','SUPER_ADMIN'))
        ORDER BY name`,
    );
    // Routing sends leads into a branch, so only offer the caller's own.
    const branchScope = referenceBranchScopeSql(req.user, 'id');
    const [branches] = await pool.execute(
      `SELECT id, branch_name AS name FROM branches WHERE is_active = 1 AND ${branchScope.sql} ORDER BY branch_name`,
      branchScope.params,
    );
    const [businessUnits] = await pool.execute(
      `SELECT id, display_name AS name FROM crm_business_units
        WHERE is_active = TRUE ORDER BY is_default DESC, display_name`,
    );
    res.json({
      success: true,
      data: {
        users: users.map((row) => ({ id: Number(row.id), name: row.name, email: row.email })),
        branches: branches.map((row) => ({ id: Number(row.id), name: row.name })),
        businessUnits: businessUnits.map((row) => ({ id: Number(row.id), name: row.name })),
      },
    });
  }));

  // ---------------- Pages ----------------

  router.get('/pages', wrap(async (_req, res) => {
    const [rows] = await pool.execute(
      `SELECT id, page_id, page_name, meta_account_id, meta_account_name,
              is_subscribed, subscribed_at_utc, subscribe_error,
              business_unit_id, branch_id, is_active, updated_at_utc
         FROM crm_meta_pages
        ORDER BY meta_account_name IS NULL, meta_account_name ASC, page_name ASC`,
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
  /*
   * What Pages a token can see, without connecting any of them.
   *
   * Handing over a user token used to connect and subscribe every Page on
   * that Facebook account at once -- including Pages that have nothing to do
   * with admissions, each one then receiving lead webhooks. This answers the
   * question the screen actually needs to ask first, so the choice of which
   * Pages to connect stays with the person holding the token.
   *
   * Read-only: nothing is written, nothing is subscribed, and the supplied
   * token is used for this call and discarded.
   */
  router.post('/pages/discover', requireUserAdmin, wrap(async (req, res) => {
    const config = await loadMetaConfig(pool, { useCache: false });
    const suppliedToken = typeof req.body?.userToken === 'string' ? req.body.userToken.trim() : '';
    if (!suppliedToken) requireConfigured(config, ['systemUserToken']);
    else if (!config) throw Object.assign(new Error('Meta integration is not configured'), { status: 400 });
    const discoveryToken = suppliedToken || config.systemUserToken;

    let account;
    try {
      account = await getTokenOwner(discoveryToken, { logger });
    } catch (error) {
      throw Object.assign(
        new Error(`Could not identify the Facebook account for this token: ${error.message}`),
        { status: 400 },
      );
    }

    const pages = await listPages(discoveryToken, { logger });
    // Which of them the CRM already has, so the screen can say so rather than
    // offering to connect something that is already delivering leads.
    const [known] = await pool.execute(
      'SELECT page_id AS pageId, is_subscribed AS isSubscribed FROM crm_meta_pages',
    );
    const byId = new Map(known.map(row => [String(row.pageId), row]));

    res.json({
      success: true,
      data: {
        account: { id: account.id, name: account.name },
        pages: pages.map(page => ({
          pageId: String(page.id),
          name: page.name || null,
          alreadyConnected: byId.has(String(page.id)),
          alreadySubscribed: Boolean(byId.get(String(page.id))?.isSubscribed),
        })),
      },
    });
  }));

  router.post('/pages/sync', requireUserAdmin, wrap(async (req, res) => {
    const config = await loadMetaConfig(pool, { useCache: false });

    // A token in the body discovers Pages from THAT Facebook account; without
    // one we fall back to the stored system user token as before. The supplied
    // token is used for discovery only and never stored -- each Page's own
    // token is what gets persisted, and that is what every leadgen call uses.
    const suppliedToken = typeof req.body?.userToken === 'string' ? req.body.userToken.trim() : '';
    if (!suppliedToken) requireConfigured(config, ['systemUserToken']);
    else if (!config) throw Object.assign(new Error('Meta integration is not configured'), { status: 400 });

    const discoveryToken = suppliedToken || config.systemUserToken;

    // Label the Pages with the account they came from. A token that cannot
    // identify itself is not usable for discovery either, so fail loudly.
    let account;
    try {
      account = await getTokenOwner(discoveryToken, { logger });
    } catch (error) {
      throw Object.assign(
        new Error(`Could not identify the Facebook account for this token: ${error.message}`),
        { status: 400 },
      );
    }

    const shouldSubscribe = req.body?.subscribe !== false && config.autoSubscribePages !== false;
    const masterKey = getMasterKey();
    const discovered = await listPages(discoveryToken, { logger });

    /*
     * Only the Pages asked for. Re-syncing a saved account sends no list and
     * still means "all of them", which is what that button has always done;
     * adding an account now sends the ones ticked on the screen.
     */
    const chosen = Array.isArray(req.body?.pageIds)
      ? new Set(req.body.pageIds.map(id => String(id)))
      : null;
    const pages = chosen ? discovered.filter(page => chosen.has(String(page.id))) : discovered;
    if (chosen && !pages.length) {
      throw Object.assign(new Error('None of the selected Pages are available on this token'), { status: 400 });
    }
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
           (integration_id, meta_account_id, meta_account_name, page_id, page_name,
            access_token_encrypted, is_subscribed, subscribed_at_utc, subscribe_error)
         VALUES (?,?,?,?,?,?,?,${subscribed ? 'CURRENT_TIMESTAMP(6)' : 'NULL'},?)
         ON DUPLICATE KEY UPDATE
           integration_id=VALUES(integration_id),
           meta_account_id=VALUES(meta_account_id),
           meta_account_name=VALUES(meta_account_name),
           page_name=VALUES(page_name),
           access_token_encrypted=VALUES(access_token_encrypted),
           is_subscribed=VALUES(is_subscribed),
           subscribed_at_utc=COALESCE(VALUES(subscribed_at_utc), subscribed_at_utc),
           subscribe_error=VALUES(subscribe_error),
           updated_at_utc=CURRENT_TIMESTAMP(6)`,
        [
          Number(config.integrationId), account.id, account.name,
          pageId, page.name || null,
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
        account: { id: account.id, name: account.name },
        total: results.length,
        subscribed: results.filter((r) => r.subscribed).length,
        failed: results.filter((r) => r.error).length,
        pages: results,
      },
    });
  }));

  /** Facebook accounts Pages have been connected through, with page counts. */
  router.get('/accounts', wrap(async (_req, res) => {
    const [rows] = await pool.execute(
      `SELECT meta_account_id   AS accountId,
              meta_account_name AS accountName,
              COUNT(*)                                   AS pageCount,
              SUM(is_subscribed = 1)                     AS subscribedCount,
              SUM(subscribe_error IS NOT NULL)           AS errorCount,
              MAX(updated_at_utc)                        AS lastSyncedAt
         FROM crm_meta_pages
        GROUP BY meta_account_id, meta_account_name
        ORDER BY meta_account_name IS NULL, meta_account_name ASC`,
    );
    res.json({ success: true, data: rows });
  }));

  /** Disconnect every Page discovered through one Facebook account. */
  router.delete('/accounts/:accountId', requireUserAdmin, wrap(async (req, res) => {
    const accountId = req.params.accountId === 'unknown' ? null : req.params.accountId;
    // The forms belong to the pages. Nothing enforces that in the schema --
    // crm_meta_forms has no foreign key -- so removing the pages alone left
    // their forms behind, still listed and still mapped to fields.
    await pool.execute(
      `DELETE f FROM crm_meta_forms f
         JOIN crm_meta_pages p ON p.page_id = f.page_id
        WHERE p.meta_account_id <=> ?`,
      [accountId],
    );
    const [result] = await pool.execute(
      'DELETE FROM crm_meta_pages WHERE meta_account_id <=> ?',
      [accountId],
    );
    res.json({ success: true, data: { removed: result.affectedRows } });
  }));

  /*
   * Disconnect one Page.
   *
   * Stops lead delivery at Meta first, then forgets the Page and the forms
   * that belong to it. Leads already imported are untouched, and so is the
   * import ledger -- disconnecting a Page says "stop sending", not "erase
   * what it sent".
   *
   * A failed unsubscribe does not block the removal. A revoked or expired
   * Page token is one of the reasons somebody wants rid of the Page, and
   * refusing to delete it would leave a row nothing can clear.
   */
  router.delete('/pages/:pageId', requireUserAdmin, wrap(async (req, res) => {
    const pageId = String(req.params.pageId);
    const [[page]] = await pool.execute('SELECT * FROM crm_meta_pages WHERE page_id=? LIMIT 1', [pageId]);
    if (!page) return res.status(404).json({ message: 'Page not found' });

    let unsubscribed = false;
    let unsubscribeError = null;
    const token = decryptPageToken(page);
    if (token) {
      try {
        unsubscribed = await unsubscribePage(pageId, token, { logger });
        if (!unsubscribed) unsubscribeError = 'Meta returned success=false';
      } catch (error) {
        unsubscribeError = error.message;
      }
    } else {
      unsubscribeError = 'No usable Page token stored';
    }

    const [forms] = await pool.execute('DELETE FROM crm_meta_forms WHERE page_id=?', [pageId]);
    await pool.execute('DELETE FROM crm_meta_pages WHERE page_id=?', [pageId]);
    logger.info?.(`[Meta] Disconnected page ${page.page_name || pageId}${unsubscribeError ? ` (unsubscribe: ${unsubscribeError})` : ''}`);

    res.json({
      success: true,
      data: {
        pageId,
        name: page.page_name || null,
        unsubscribed,
        formsRemoved: forms.affectedRows,
        // Surfaced rather than thrown: the Page is gone either way, but Meta
        // may still believe it is subscribed and that is worth knowing.
        warning: unsubscribeError ? `Removed from the CRM, but Meta could not be told to stop: ${unsubscribeError}` : null,
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

    const summary = { fetched: leads.length, pending: 0, imported: 0, duplicate: 0, failed: 0, skipped: 0, reenquired: 0 };
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
        // Backfill collects; review decides. Pass reviewless=true to import
        // straight away, which keeps the old behaviour available.
        holdForReview: req.body?.reviewless !== true,
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

  /**
   * Leads waiting for someone to look at them.
   *
   * Returns the answers Meta actually sent alongside how the form's mapping
   * reads them, so a wrong mapping shows up here rather than as a lead with a
   * blank name.
   */
  router.get('/imports/pending', wrap(async (_req, res) => {
    const [rows] = await pool.execute(
      `SELECT i.leadgen_id AS leadgenId, i.form_id AS formId, i.page_id AS pageId,
              i.intake_source AS intakeSource, i.raw_payload AS rawPayload,
              i.meta_created_time AS metaCreatedTime, i.created_at_utc AS receivedAt,
              f.form_name AS formName, f.field_mapping AS fieldMapping,
              p.page_name AS pageName
         FROM crm_meta_lead_imports i
         LEFT JOIN crm_meta_forms f ON f.form_id = i.form_id
         LEFT JOIN crm_meta_pages p ON p.page_id = i.page_id
        WHERE i.status='pending'
        ORDER BY i.id DESC
        LIMIT 200`,
    );
    const data = rows.map((row) => {
      const payload = typeof row.rawPayload === 'string' ? JSON.parse(row.rawPayload || '{}') : (row.rawPayload || {});
      const mapping = typeof row.fieldMapping === 'string' ? JSON.parse(row.fieldMapping || '{}') : (row.fieldMapping || {});
      const { record, unmapped } = mapFieldData(payload?.field_data, mapping);
      return {
        leadgenId: row.leadgenId,
        formId: row.formId, formName: row.formName,
        pageId: row.pageId, pageName: row.pageName,
        intakeSource: row.intakeSource,
        receivedAt: row.receivedAt,
        metaCreatedTime: row.metaCreatedTime,
        // Exactly what Meta sent, question by question.
        answers: Array.isArray(payload?.field_data)
          ? payload.field_data.map((field) => ({ name: field.name, value: (field.values || []).join(', ') }))
          : [],
        // And what the mapping makes of it, so the gap is visible.
        mapped: record,
        unmapped,
      };
    });
    res.json({ success: true, data });
  }));

  /** Turn a waiting lead into a CRM lead. */
  router.post('/imports/:leadgenId/approve', requireUserAdmin, wrap(async (req, res) => {
    const leadgenId = String(req.params.leadgenId);
    const [[row]] = await pool.execute('SELECT * FROM crm_meta_lead_imports WHERE leadgen_id=? LIMIT 1', [leadgenId]);
    if (!row) return res.status(404).json({ message: 'Import record not found' });
    if (row.status !== 'pending') {
      return res.status(409).json({ message: `Only waiting leads can be approved (status: ${row.status})` });
    }
    // Re-open the claim so importMetaLead can settle it, then let it run the
    // usual validation and mapping -- approval changes who decides, not how.
    await pool.execute("UPDATE crm_meta_lead_imports SET status='failed' WHERE leadgen_id=?", [leadgenId]);
    const config = await loadMetaConfig(pool, { useCache: false });
    const payload = typeof row.raw_payload === 'string' ? JSON.parse(row.raw_payload || 'null') : row.raw_payload;
    const result = await importMetaLead(pool, {
      leadgenId, formId: row.form_id, pageId: row.page_id, adId: row.ad_id,
      campaignMetaId: row.campaign_meta_id, createdTime: row.meta_created_time,
      leadData: payload, intakeSource: 'review', config, logger,
    });
    res.json({ success: true, data: result });
  }));

  /** Leave a waiting lead out of the CRM, with a note saying who and why. */
  router.post('/imports/:leadgenId/discard', requireUserAdmin, wrap(async (req, res) => {
    const leadgenId = String(req.params.leadgenId);
    const reason = String(req.body?.reason || '').trim().slice(0, 500) || 'Discarded during review';
    const [result] = await pool.execute(
      `UPDATE crm_meta_lead_imports
          SET status='skipped', error_message=?, updated_at_utc=CURRENT_TIMESTAMP(6)
        WHERE leadgen_id=? AND status='pending'`,
      [reason, leadgenId],
    );
    if (!result.affectedRows) return res.status(409).json({ message: 'That lead is no longer waiting for review' });
    res.json({ success: true, data: { leadgenId, status: 'skipped' } });
  }));

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

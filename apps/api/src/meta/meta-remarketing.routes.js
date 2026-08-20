import { Router } from 'express';
import { requireAdminOrPermission } from '../rbac/rbac.middleware.js';
import { listAdAccounts } from './meta-client.js';
import {
  resolveAudienceLeads, buildLeadFilterSql, matchKeysFor, buildAudienceRow,
  syncAudience, nextSyncAt, requireMarketingToken, marketingPermissionHint,
  createMetaAudience, readMetaAudience, removeMetaAudience,
} from './meta-remarketing.service.js';

/*
 * Meta Remarketing: CRM audiences, and the Custom Audiences they become.
 *
 * Mounted under /api/meta so it inherits the integrations.meta_lead_ads
 * permission rules the Lead Ads routes already answer to. Nothing here
 * touches the leadgen path; audiences read leads and talk to the Marketing
 * API, and that is all.
 */

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clean = (value, max = 255) => String(value ?? '').trim().slice(0, max);
const SYNC_INTERVALS = ['daily', 'every_6_hours', 'every_12_hours', 'weekly'];

/**
 * Meta's own words, plus what to do about them.
 *
 * Item for item, these are the failures the Marketing API actually returns;
 * a bare "(#100) Unsupported get request" tells an administrator nothing
 * about which permission is missing.
 */
function explainMetaError(error) {
  const message = String(error?.message || '');
  const code = error?.metaCode;
  if (error?.metaAuth || code === 190) {
    return 'The Meta token has expired or been revoked. Re-issue it under Connect to Meta, then try again.';
  }
  if (code === 100 || /permission/i.test(message)) return marketingPermissionHint;
  if (code === 200 || code === 10) return `Meta refused this request for lack of permission: ${message}. ${marketingPermissionHint}`;
  if (code === 17 || code === 4 || code === 613 || /rate limit/i.test(message)) {
    return 'Meta is rate limiting this ad account. The sync will be retried on the next cycle.';
  }
  if (code === 2 || /timeout|ETIMEDOUT|ECONNABORTED/i.test(message)) {
    return 'Meta did not respond in time. Nothing was lost — run the sync again.';
  }
  if (code === 2650 || /custom audience/i.test(message)) {
    return `Meta rejected the audience: ${message}. It may have been deleted in Ads Manager, or the ad account has not accepted the Custom Audience terms.`;
  }
  return message || 'Meta request failed';
}

export function createMetaRemarketingRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin, logger = console) {
  const router = Router();
  const canView = requireAdminOrPermission(pool, 'integrations.meta_lead_ads.view');
  router.use(authenticate, requireCrmAccess);

  /** Turns a Meta failure into something an administrator can act on. */
  const metaGuard = (fn) => async (req, res, next) => {
    try { await fn(req, res, next); } catch (error) {
      if (error?.status === 400 || error?.status === 404) return next(error);
      logger.error?.(`[Meta remarketing] ${req.method} ${req.path}: ${error.message}`);
      return res.status(error.status === 502 ? 502 : 500).json({
        success: false,
        message: explainMetaError(error),
        metaCode: error?.metaCode ?? null,
      });
    }
  };

  // ---------------- Ad accounts ----------------

  router.get('/ad-accounts', canView, wrap(async (_req, res) => {
    const [rows] = await pool.execute(
      `SELECT ad_account_id AS adAccountId, account_id AS accountId, name, currency,
              account_status AS accountStatus, business_name AS businessName, last_synced_at_utc AS lastSyncedAt
         FROM crm_meta_ad_accounts WHERE is_active=TRUE ORDER BY name`,
    );
    res.json({ success: true, data: rows });
  }));

  /** Discover ad accounts from the connected Meta account and store them. */
  router.post('/ad-accounts/sync', requireUserAdmin, metaGuard(async (req, res) => {
    const token = await requireMarketingToken(pool);
    const accounts = await listAdAccounts(token, { logger });
    for (const account of accounts) {
      await pool.execute(
        `INSERT INTO crm_meta_ad_accounts (ad_account_id, account_id, name, currency, account_status, business_name, business_unit_id, last_synced_at_utc)
         VALUES (?,?,?,?,?,?,?, CURRENT_TIMESTAMP(6))
         ON DUPLICATE KEY UPDATE name=VALUES(name), currency=VALUES(currency),
           account_status=VALUES(account_status), business_name=VALUES(business_name),
           is_active=TRUE, last_synced_at_utc=CURRENT_TIMESTAMP(6)`,
        [String(account.id), account.account_id || null, account.name || null, account.currency || null,
          account.account_status != null ? String(account.account_status) : null,
          account.business?.name || null, req.businessUnit?.id || null],
      );
    }
    res.json({ success: true, data: { discovered: accounts.length } });
  }));

  // ---------------- Preview, before anything is saved ----------------

  /**
   * How many leads a set of filters matches, and how many of those Meta can
   * actually use. The second number is the one that matters: a lead with
   * neither an email nor a phone cannot be matched, so counting it would
   * promise reach that does not exist.
   */
  router.post('/audiences/preview', canView, wrap(async (req, res) => {
    const audience = {
      business_unit_id: req.businessUnit.id,
      filters_json: req.body?.filters || {},
      exclude_filters_json: req.body?.excludeFilters || {},
    };
    const leads = await resolveAudienceLeads(pool, audience);
    const eligible = leads.filter((lead) => buildAudienceRow(lead));
    const sample = (req.body?.includeSample === false ? [] : leads.slice(0, 25)).map((lead) => ({
      id: Number(lead.id), name: lead.student_name, city: lead.city,
      hasEmail: Boolean(lead.email), hasPhone: Boolean(lead.phone || lead.normalized_phone),
      matchKeys: matchKeysFor(lead),
    }));
    res.json({ success: true, data: { matched: leads.length, eligible: eligible.length, sample } });
  }));

  // ---------------- Audiences ----------------

  router.get('/audiences', canView, wrap(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT a.id, a.name, a.description, a.ad_account_id AS adAccountId, acc.name AS adAccountName,
              a.meta_audience_id AS metaAudienceId, a.source, a.filters_json AS filters,
              a.exclude_filters_json AS excludeFilters, a.sync_type AS syncType, a.sync_interval AS syncInterval,
              a.status, a.crm_lead_count AS crmLeadCount, a.synced_lead_count AS syncedLeadCount,
              a.last_sync_at_utc AS lastSyncAt, a.next_sync_at_utc AS nextSyncAt, a.last_error AS lastError,
              a.created_at_utc AS createdAt, COALESCE(e.employee_name, u.email) AS createdBy
         FROM crm_remarketing_audiences a
         LEFT JOIN crm_meta_ad_accounts acc ON acc.ad_account_id = a.ad_account_id
         LEFT JOIN app_users u ON u.id = a.created_by_user_id
         LEFT JOIN employees e ON e.id = u.employee_id
        WHERE a.business_unit_id=? AND a.status <> 'deleted'
        ORDER BY a.created_at_utc DESC`,
      [req.businessUnit.id],
    );
    res.json({ success: true, data: rows });
  }));

  router.get('/audiences/:id', canView, wrap(async (req, res) => {
    const [[audience]] = await pool.execute(
      'SELECT * FROM crm_remarketing_audiences WHERE id=? AND business_unit_id=?',
      [req.params.id, req.businessUnit.id],
    );
    if (!audience) return res.status(404).json({ message: 'Audience not found' });
    const [[counts]] = await pool.execute(
      `SELECT COUNT(*) AS members, SUM(status='synced') AS synced, SUM(status='ineligible') AS ineligible,
              SUM(status='failed') AS failed
         FROM crm_remarketing_audience_members WHERE audience_id=?`, [audience.id],
    );
    res.json({ success: true, data: { ...audience, counts } });
  }));

  /** The leads currently in an audience — "Preview leads" / "View leads". */
  router.get('/audiences/:id/leads', canView, wrap(async (req, res) => {
    const [[audience]] = await pool.execute(
      'SELECT * FROM crm_remarketing_audiences WHERE id=? AND business_unit_id=?',
      [req.params.id, req.businessUnit.id],
    );
    if (!audience) return res.status(404).json({ message: 'Audience not found' });
    const leads = await resolveAudienceLeads(pool, audience, { limit: 500 });
    const [members] = await pool.execute(
      'SELECT lead_id AS leadId, status, last_synced_at_utc AS lastSyncedAt FROM crm_remarketing_audience_members WHERE audience_id=?',
      [audience.id],
    );
    const state = new Map(members.map((row) => [Number(row.leadId), row]));
    res.json({
      success: true,
      data: leads.map((lead) => ({
        id: Number(lead.id), name: lead.student_name, email: lead.email, phone: lead.phone,
        city: lead.city, matchKeys: matchKeysFor(lead), eligible: Boolean(buildAudienceRow(lead)),
        syncStatus: state.get(Number(lead.id))?.status || 'pending',
        lastSyncedAt: state.get(Number(lead.id))?.lastSyncedAt || null,
      })),
    });
  }));

  router.post('/audiences', requireUserAdmin, wrap(async (req, res) => {
    const name = clean(req.body?.name, 200);
    const adAccountId = clean(req.body?.adAccountId, 64);
    if (!name) return res.status(400).json({ message: 'Give the audience a name' });
    if (!adAccountId) return res.status(400).json({ message: 'Choose the Meta ad account this audience belongs to' });

    const syncType = req.body?.syncType === 'automatic' ? 'automatic' : 'manual';
    const syncInterval = SYNC_INTERVALS.includes(req.body?.syncInterval) ? req.body.syncInterval : null;
    if (syncType === 'automatic' && !syncInterval) {
      return res.status(400).json({ message: 'Choose how often an automatic audience should sync' });
    }

    const [result] = await pool.execute(
      `INSERT INTO crm_remarketing_audiences
         (business_unit_id, name, description, ad_account_id, source, filters_json, exclude_filters_json,
          sync_type, sync_interval, status, next_sync_at_utc, created_by_user_id)
       VALUES (?,?,?,?,?,?,?,?,?, 'draft', ?, ?)`,
      [req.businessUnit.id, name, clean(req.body?.description, 1000) || null, adAccountId,
        clean(req.body?.source, 40) || 'crm_leads',
        JSON.stringify(req.body?.filters || {}), JSON.stringify(req.body?.excludeFilters || {}),
        syncType, syncInterval,
        syncType === 'automatic' ? nextSyncAt({ sync_type: syncType, sync_interval: syncInterval }) : null,
        req.user.id],
    );
    res.status(201).json({ success: true, data: { id: Number(result.insertId) } });
  }));

  router.put('/audiences/:id', requireUserAdmin, wrap(async (req, res) => {
    const [[audience]] = await pool.execute(
      'SELECT * FROM crm_remarketing_audiences WHERE id=? AND business_unit_id=?',
      [req.params.id, req.businessUnit.id],
    );
    if (!audience) return res.status(404).json({ message: 'Audience not found' });
    const syncType = req.body?.syncType === 'automatic' ? 'automatic' : 'manual';
    const syncInterval = SYNC_INTERVALS.includes(req.body?.syncInterval) ? req.body.syncInterval : null;
    if (syncType === 'automatic' && !syncInterval) {
      return res.status(400).json({ message: 'Choose how often an automatic audience should sync' });
    }
    await pool.execute(
      `UPDATE crm_remarketing_audiences
          SET name=?, description=?, filters_json=?, exclude_filters_json=?, sync_type=?, sync_interval=?,
              next_sync_at_utc=?, updated_at_utc=CURRENT_TIMESTAMP(6)
        WHERE id=?`,
      [clean(req.body?.name, 200) || audience.name, clean(req.body?.description, 1000) || null,
        JSON.stringify(req.body?.filters || {}), JSON.stringify(req.body?.excludeFilters || {}),
        syncType, syncInterval,
        syncType === 'automatic' ? nextSyncAt({ sync_type: syncType, sync_interval: syncInterval }) : null,
        audience.id],
    );
    res.json({ success: true });
  }));

  /** Pause or resume automatic syncing without losing the definition. */
  router.post('/audiences/:id/pause', requireUserAdmin, wrap(async (req, res) => {
    const paused = req.body?.paused !== false;
    const [result] = await pool.execute(
      `UPDATE crm_remarketing_audiences SET status=?, next_sync_at_utc=IF(?, NULL, next_sync_at_utc)
        WHERE id=? AND business_unit_id=? AND status <> 'deleted'`,
      [paused ? 'paused' : 'active', paused ? 1 : 0, req.params.id, req.businessUnit.id],
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Audience not found' });
    res.json({ success: true, data: { paused } });
  }));

  /**
   * Sync now. `mode=full` re-uploads everyone, which is what "Refresh
   * audience" means; the default sends only what changed.
   */
  router.post('/audiences/:id/sync', requireUserAdmin, metaGuard(async (req, res) => {
    const [[audience]] = await pool.execute(
      'SELECT id FROM crm_remarketing_audiences WHERE id=? AND business_unit_id=?',
      [req.params.id, req.businessUnit.id],
    );
    if (!audience) return res.status(404).json({ message: 'Audience not found' });
    const result = await syncAudience(pool, audience.id, {
      triggeredBy: 'manual', userId: req.user.id,
      mode: req.body?.mode === 'full' ? 'full' : 'delta', logger,
    });
    res.json({ success: true, data: result });
  }));

  /**
   * Delete the CRM audience, and optionally the Meta one.
   *
   * Two separate things on purpose: removing the CRM definition should not
   * silently destroy an audience that live ads may be targeting. The UI asks
   * for confirmation before passing deleteMeta.
   */
  router.delete('/audiences/:id', requireUserAdmin, metaGuard(async (req, res) => {
    const [[audience]] = await pool.execute(
      'SELECT * FROM crm_remarketing_audiences WHERE id=? AND business_unit_id=?',
      [req.params.id, req.businessUnit.id],
    );
    if (!audience) return res.status(404).json({ message: 'Audience not found' });
    const deleteMeta = String(req.query.deleteMeta || '') === 'true';
    let metaDeleted = false;
    let metaWarning = null;

    if (deleteMeta && audience.meta_audience_id) {
      try {
        await removeMetaAudience(pool, audience.meta_audience_id, { logger });
        metaDeleted = true;
      } catch (error) {
        // The CRM row still goes: an audience Meta no longer recognises must
        // not be undeletable here.
        metaWarning = explainMetaError(error);
      }
    }
    await pool.execute(
      `UPDATE crm_remarketing_audiences SET status='deleted', next_sync_at_utc=NULL WHERE id=?`, [audience.id],
    );
    res.json({ success: true, data: { metaDeleted, metaAudienceId: audience.meta_audience_id, warning: metaWarning } });
  }));

  // ---------------- Sync history ----------------

  router.get('/sync-logs', canView, wrap(async (req, res) => {
    const audienceId = req.query.audienceId ? Number(req.query.audienceId) : null;
    const [rows] = await pool.execute(
      `SELECT s.id, s.audience_id AS audienceId, a.name AS audienceName, s.meta_audience_id AS metaAudienceId,
              s.action, s.status, s.started_at_utc AS startedAt, s.completed_at_utc AS completedAt,
              s.leads_considered AS leadsConsidered, s.leads_added AS leadsAdded, s.leads_removed AS leadsRemoved,
              s.leads_failed AS leadsFailed, s.leads_skipped AS leadsSkipped, s.error_message AS errorMessage,
              s.meta_response AS metaResponse, s.triggered_by AS triggeredBy,
              COALESCE(e.employee_name, u.email) AS triggeredByUser
         FROM crm_remarketing_sync_logs s
         JOIN crm_remarketing_audiences a ON a.id = s.audience_id
         LEFT JOIN app_users u ON u.id = s.triggered_by_user_id
         LEFT JOIN employees e ON e.id = u.employee_id
        WHERE a.business_unit_id=? ${audienceId ? 'AND s.audience_id=?' : ''}
        ORDER BY s.started_at_utc DESC LIMIT 200`,
      audienceId ? [req.businessUnit.id, audienceId] : [req.businessUnit.id],
    );
    res.json({ success: true, data: rows });
  }));

  // ---------------- Lead-level visibility ----------------

  /** Which audiences one lead belongs to, for the lead drawer's tab. */
  router.get('/leads/:leadId/audiences', canView, wrap(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT a.id AS audienceId, a.name, a.meta_audience_id AS metaAudienceId, a.status AS audienceStatus,
              m.status AS syncStatus, m.match_keys AS matchKeys, m.last_synced_at_utc AS lastSyncedAt
         FROM crm_remarketing_audience_members m
         JOIN crm_remarketing_audiences a ON a.id = m.audience_id
        WHERE m.lead_id=? AND a.business_unit_id=? AND a.status <> 'deleted'
        ORDER BY a.name`,
      [req.params.leadId, req.businessUnit.id],
    );
    res.json({ success: true, data: rows });
  }));

  return router;
}

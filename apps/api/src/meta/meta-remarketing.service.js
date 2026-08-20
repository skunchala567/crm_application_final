import { hashSha256 } from '../integration-hub/crypto-utils.js';
import { loadMetaConfig } from './meta-config.js';
import {
  createCustomAudience, deleteCustomAudience, getCustomAudience, updateAudienceUsers,
} from './meta-client.js';

/*
 * Turning CRM leads into a Meta Custom Audience.
 *
 * Two halves, kept apart on purpose:
 *
 *   resolveAudienceLeads  decides WHO is in the audience, using the same
 *                         vocabulary the Leads screen filters with.
 *   buildAudiencePayload  decides WHAT Meta is told about them -- and it is
 *                         the only place raw customer data is touched. It
 *                         returns hashes; nothing upstream sees a plain
 *                         email or phone, and nothing is logged.
 */

const MAX_BATCH = 5000; // Meta's per-request ceiling for /users

/* ---------------------------------------------------------------------
   Normalisation, exactly as Meta specifies it.

   Meta hashes the same way at their end and compares digests, so a value
   normalised differently simply never matches -- a silent loss of reach
   rather than an error. Each rule below is Meta's, not ours.
   --------------------------------------------------------------------- */

const trimLower = (value) => String(value ?? '').trim().toLowerCase();

/** Digits only, country code included, no plus. Indian numbers get 91. */
function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

/** Letters only: Meta strips punctuation, digits and spaces from names. */
const normalizeName = (value) => trimLower(value).replace(/[^a-z]/g, '');

/** Two-letter lowercase ISO country code. */
function normalizeCountry(value) {
  const text = trimLower(value);
  if (!text) return '';
  if (text.length === 2) return text;
  return { india: 'in', 'united states': 'us', usa: 'us', uae: 'ae', 'united arab emirates': 'ae' }[text] || '';
}

const normalizeCity = (value) => trimLower(value).replace(/[^a-z]/g, '');
const normalizeZip = (value) => trimLower(value).replace(/[^a-z0-9]/g, '');

/**
 * First and last name from whatever the CRM holds.
 *
 * A lead is stored as one "student name" and possibly a parent name. Meta
 * wants them separately, so the first token is the first name and the
 * remainder is the surname -- and a single-word name yields no surname
 * rather than repeating itself, which would match nobody.
 */
function splitName(fullName) {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  return { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : '' };
}

/*
 * Meta's schema order. Every row sent must line up with this array, with an
 * empty string where the lead has nothing -- Meta rejects ragged rows.
 */
export const AUDIENCE_SCHEMA = ['EMAIL', 'PHONE', 'FN', 'LN', 'CT', 'ST', 'COUNTRY', 'ZIP'];

/**
 * One lead as a row of hashes, or null when it carries nothing Meta can
 * match on.
 *
 * Email or phone alone is enough; a name and city with neither is not --
 * Meta will accept it and match almost nobody, so it is counted as
 * ineligible here rather than inflating the upload.
 */
export function buildAudienceRow(lead) {
  const email = trimLower(lead.email);
  const phone = normalizePhone(lead.phone || lead.normalized_phone);
  if (!email && !phone) return null;

  const { first, last } = splitName(lead.student_name || lead.parent_name);
  const values = [
    email,
    phone,
    normalizeName(first),
    normalizeName(last),
    normalizeCity(lead.city),
    normalizeName(lead.state),
    normalizeCountry(lead.country || 'India'),
    normalizeZip(lead.postal_code),
  ];
  // Hash after normalising, never before, and only non-empty values: a
  // hash of "" is a real digest that would match nothing and waste a field.
  return values.map((value) => (value ? hashSha256(value) : ''));
}

/** Which identifiers a lead can offer, for the eligibility column. */
export function matchKeysFor(lead) {
  const keys = [];
  if (trimLower(lead.email)) keys.push('email');
  if (normalizePhone(lead.phone || lead.normalized_phone)) keys.push('phone');
  if (splitName(lead.student_name || lead.parent_name).first) keys.push('name');
  if (normalizeCity(lead.city)) keys.push('city');
  return keys;
}

/** {schema, data} for /users. The only function that sees raw leads. */
export function buildAudiencePayload(leads) {
  const data = [];
  const skipped = [];
  for (const lead of leads) {
    const row = buildAudienceRow(lead);
    if (row) data.push(row);
    else skipped.push(Number(lead.id));
  }
  return { payload: { schema: AUDIENCE_SCHEMA, data }, skipped };
}

/* ---------------------------------------------------------------------
   Who is in the audience.

   The filter vocabulary is the CRM's own, so an audience is described the
   way a counsellor would describe a list of leads. Everything is bound as
   a parameter; nothing is interpolated.
   --------------------------------------------------------------------- */

const IN = (column, values) => ({ sql: `${column} IN (${values.map(() => '?').join(',')})`, params: values });

export function buildLeadFilterSql(filters = {}, { alias = 'l' } = {}) {
  const where = [];
  const params = [];
  const add = (clause, values = []) => { where.push(clause); params.push(...values); };
  const list = (value) => (Array.isArray(value) ? value : value ? [value] : []).filter((v) => v !== '' && v != null);

  const simple = [
    ['branchId', `${alias}.branch_id`], ['stageId', `${alias}.stage_id`], ['sourceId', `${alias}.source_id`],
    ['channelId', `${alias}.channel_id`], ['campaignId', `${alias}.campaign_id`], ['classId', `${alias}.class_id`],
    ['curriculumId', `${alias}.curriculum_id`], ['admissionTypeId', `${alias}.admission_type_id`],
    ['ownerEmployeeId', `${alias}.owner_employee_id`], ['academicYear', `${alias}.academic_year`],
    ['city', `${alias}.city`],
  ];
  for (const [key, column] of simple) {
    const values = list(filters[key]);
    if (values.length) { const c = IN(column, values); add(c.sql, c.params); }
  }

  if (filters.createdFrom) add(`DATE(${alias}.created_at_utc) >= ?`, [filters.createdFrom]);
  if (filters.createdTo) add(`DATE(${alias}.created_at_utc) <= ?`, [filters.createdTo]);

  // "Admission status" in CRM terms is the stage flagged as the admission
  // stage, which is configuration rather than a hardcoded stage name.
  if (filters.admissionStatus === 'admitted') {
    add(`EXISTS (SELECT 1 FROM crm_lead_stages st WHERE st.id=${alias}.stage_id AND st.is_admission_stage=TRUE)`);
  } else if (filters.admissionStatus === 'not_admitted') {
    add(`NOT EXISTS (SELECT 1 FROM crm_lead_stages st WHERE st.id=${alias}.stage_id AND st.is_admission_stage=TRUE)`);
  }

  /*
   * Meta-side filters read the import ledger rather than the lead, because
   * that is where the campaign, ad set, ad and form a lead arrived through
   * are recorded.
   */
  const metaFilters = [
    ['metaCampaignId', 'mi.campaign_meta_id'], ['metaAdsetId', 'mi.adgroup_id'],
    ['metaAdId', 'mi.ad_id'], ['metaFormId', 'mi.form_id'], ['metaPageId', 'mi.page_id'],
  ];
  for (const [key, column] of metaFilters) {
    const values = list(filters[key]);
    if (values.length) {
      add(`EXISTS (SELECT 1 FROM crm_meta_lead_imports mi WHERE mi.lead_id=${alias}.id AND ${column} IN (${values.map(() => '?').join(',')}))`, values);
    }
  }
  if (filters.metaOnly) {
    add(`EXISTS (SELECT 1 FROM crm_meta_lead_imports mi WHERE mi.lead_id=${alias}.id)`);
  }

  return { sql: where.length ? where.join(' AND ') : '1=1', params };
}

/**
 * The leads an audience currently matches.
 *
 * Include minus exclude, and only leads carrying an email or a phone --
 * anything else cannot be matched by Meta, so counting it would promise
 * reach that does not exist.
 */
export async function resolveAudienceLeads(pool, audience, { limit = null } = {}) {
  const filters = parseJson(audience.filters_json) || {};
  const excludes = parseJson(audience.exclude_filters_json) || {};
  const include = buildLeadFilterSql(filters);
  const params = [Number(audience.business_unit_id), ...include.params];

  let excludeSql = '';
  if (Object.keys(excludes).length) {
    const ex = buildLeadFilterSql(excludes, { alias: 'x' });
    excludeSql = ` AND NOT EXISTS (SELECT 1 FROM crm_leads x WHERE x.id=l.id AND ${ex.sql})`;
    params.push(...ex.params);
  }

  const [rows] = await pool.execute(
    `SELECT l.id, l.student_name, l.parent_name, l.email, l.phone, l.normalized_phone,
            l.city, l.state, l.country, l.postal_code
       FROM crm_leads l
      WHERE l.business_unit_id=? AND l.deleted_at_utc IS NULL
        AND (l.email IS NOT NULL AND l.email <> '' OR l.phone IS NOT NULL AND l.phone <> '')
        AND ${include.sql}${excludeSql}
      ORDER BY l.id${limit ? ` LIMIT ${Number(limit)}` : ''}`,
    params,
  );
  return rows;
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

/* ---------------------------------------------------------------------
   Talking to Meta.
   --------------------------------------------------------------------- */

/**
 * The system user token, refused early when it cannot do Marketing API
 * work.
 *
 * Lead Ads needs pages_show_list and leads_retrieval; Custom Audiences need
 * ads_management, which is a separate grant. A token can therefore fetch
 * leads perfectly and fail every call here -- so this says which permission
 * is missing instead of letting Meta answer with a bare "(#100)".
 */
export async function requireMarketingToken(pool) {
  const config = await loadMetaConfig(pool, { useCache: false });
  if (!config?.systemUserToken) {
    throw Object.assign(new Error('Connect the Meta integration first: no system user token is stored.'), { status: 400 });
  }
  return config.systemUserToken;
}

export const marketingPermissionHint =
  'This needs a Meta system user token with the ads_management permission. '
  + 'The token connected for Lead Ads only carries page and leads permissions, so audience calls are refused. '
  + 'Re-issue it in Business Settings → System Users with ads_management (and business_management to list ad accounts), '
  + 'assign the ad account to that system user, then save it under Connect to Meta.';

export async function createMetaAudience(pool, audience, { logger = console } = {}) {
  const token = await requireMarketingToken(pool);
  const body = await createCustomAudience(audience.ad_account_id, token, {
    name: audience.meta_audience_name || audience.name,
    description: audience.description,
  }, { logger });
  return String(body?.id || '');
}

export async function readMetaAudience(pool, metaAudienceId, { logger = console } = {}) {
  const token = await requireMarketingToken(pool);
  return getCustomAudience(metaAudienceId, token, { logger });
}

export async function removeMetaAudience(pool, metaAudienceId, { logger = console } = {}) {
  const token = await requireMarketingToken(pool);
  return deleteCustomAudience(metaAudienceId, token, { logger });
}

/**
 * Push one batch of leads at Meta, added or removed.
 *
 * Returns what happened per batch so a partial failure is reported as such
 * -- half an audience uploaded is not a success, and it is not a total
 * failure either.
 */
export async function pushAudienceMembers(pool, metaAudienceId, leads, { remove = false, logger = console } = {}) {
  const token = await requireMarketingToken(pool);
  const { payload, skipped } = buildAudiencePayload(leads);
  const results = { sent: 0, skipped: skipped.length, skippedIds: skipped, batches: [], failed: 0, lastResponse: null };
  if (!payload.data.length) return results;

  for (let index = 0; index < payload.data.length; index += MAX_BATCH) {
    const slice = { schema: payload.schema, data: payload.data.slice(index, index + MAX_BATCH) };
    try {
      const body = await updateAudienceUsers(metaAudienceId, token, slice, { remove, logger });
      results.sent += slice.data.length;
      results.lastResponse = body;
      results.batches.push({ size: slice.data.length, ok: true, received: body?.num_received ?? null });
    } catch (error) {
      results.failed += slice.data.length;
      results.batches.push({ size: slice.data.length, ok: false, error: error.message });
      // Keep going: a rejected batch should not strand the batches after it.
      logger.error?.(`[Meta] Audience ${remove ? 'removal' : 'upload'} batch failed: ${error.message}`);
    }
  }
  return results;
}

/* ---------------------------------------------------------------------
   One sync.

   The audience is materialised in crm_remarketing_audience_members, so a
   run only has to send what changed: leads that newly match are added,
   leads that stopped matching are removed. A full re-upload happens only
   when the audience has never synced, or when the caller asks for it.
   --------------------------------------------------------------------- */

const SYNC_INTERVAL_MS = {
  daily: 24 * 60 * 60 * 1000,
  every_6_hours: 6 * 60 * 60 * 1000,
  every_12_hours: 12 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

export function nextSyncAt(audience, from = new Date()) {
  if (audience.sync_type !== 'automatic') return null;
  const step = SYNC_INTERVAL_MS[audience.sync_interval] || SYNC_INTERVAL_MS.daily;
  return new Date(from.getTime() + step);
}

/**
 * Bring one audience in line with its filters.
 *
 * Every outcome lands in crm_remarketing_sync_logs -- including the failures,
 * which is the point: "nothing happened" and "Meta refused it" look the same
 * from the audience list otherwise.
 */
export async function syncAudience(pool, audienceId, {
  triggeredBy = 'manual', userId = null, mode = 'delta', logger = console,
} = {}) {
  const [[audience]] = await pool.execute('SELECT * FROM crm_remarketing_audiences WHERE id=? LIMIT 1', [audienceId]);
  if (!audience) throw Object.assign(new Error('Audience not found'), { status: 404 });
  if (audience.status === 'deleted') throw Object.assign(new Error('This audience has been deleted'), { status: 400 });

  const [log] = await pool.execute(
    `INSERT INTO crm_remarketing_sync_logs (audience_id, meta_audience_id, action, status, triggered_by, triggered_by_user_id)
     VALUES (?,?,?, 'running', ?, ?)`,
    [audience.id, audience.meta_audience_id, mode === 'full' ? 'refresh' : 'sync', triggeredBy, userId],
  );
  const logId = Number(log.insertId);
  const finish = async (status, fields = {}) => {
    await pool.execute(
      `UPDATE crm_remarketing_sync_logs
          SET status=?, completed_at_utc=CURRENT_TIMESTAMP(6), leads_considered=?, leads_added=?,
              leads_removed=?, leads_failed=?, leads_skipped=?, meta_response=?, error_message=?
        WHERE id=?`,
      [status, fields.considered || 0, fields.added || 0, fields.removed || 0, fields.failed || 0,
        fields.skipped || 0, fields.response ? JSON.stringify(fields.response) : null,
        fields.error ? String(fields.error).slice(0, 1000) : null, logId],
    );
    return { logId, status, ...fields };
  };

  try {
    // 1. An audience with no Meta id has never been created there.
    let metaAudienceId = audience.meta_audience_id;
    if (!metaAudienceId) {
      metaAudienceId = await createMetaAudience(pool, audience, { logger });
      await pool.execute('UPDATE crm_remarketing_audiences SET meta_audience_id=?, status=? WHERE id=?',
        [metaAudienceId, 'active', audience.id]);
      await pool.execute('UPDATE crm_remarketing_sync_logs SET meta_audience_id=? WHERE id=?', [metaAudienceId, logId]);
    }

    // 2. Who should be in it now, against who the CRM believes is in it.
    const leads = await resolveAudienceLeads(pool, audience);
    const desired = new Map(leads.map((lead) => [Number(lead.id), lead]));
    const [existing] = await pool.execute(
      'SELECT lead_id, status FROM crm_remarketing_audience_members WHERE audience_id=?', [audience.id],
    );
    const known = new Map(existing.map((row) => [Number(row.lead_id), row.status]));

    const toAdd = [...desired.values()].filter((lead) => {
      const state = known.get(Number(lead.id));
      return mode === 'full' || !state || state === 'pending' || state === 'removed' || state === 'failed';
    });
    const toRemoveIds = [...known.entries()]
      .filter(([leadId, state]) => !desired.has(leadId) && state !== 'removed')
      .map(([leadId]) => leadId);

    // 3. Removals first, so a lead that stopped matching stops being
    //    targeted even if the additions then fail.
    let removed = 0;
    if (toRemoveIds.length) {
      const [removeLeads] = await pool.query(
        `SELECT id, student_name, parent_name, email, phone, normalized_phone, city, state, country, postal_code
           FROM crm_leads WHERE id IN (?)`, [toRemoveIds],
      );
      const result = await pushAudienceMembers(pool, metaAudienceId, removeLeads, { remove: true, logger });
      removed = result.sent;
      await pool.query(
        `UPDATE crm_remarketing_audience_members SET status='removed', last_synced_at_utc=CURRENT_TIMESTAMP(6)
          WHERE audience_id=? AND lead_id IN (?)`, [audience.id, toRemoveIds],
      );
    }

    // 4. Additions.
    let added = 0;
    let failed = 0;
    let skipped = 0;
    let response = null;
    if (toAdd.length) {
      const result = await pushAudienceMembers(pool, metaAudienceId, toAdd, { remove: false, logger });
      added = result.sent;
      failed = result.failed;
      skipped = result.skipped;
      response = result.lastResponse;
      const skippedIds = new Set(result.skippedIds);
      for (const lead of toAdd) {
        const id = Number(lead.id);
        const state = skippedIds.has(id) ? 'ineligible' : (result.failed && !result.sent ? 'failed' : 'synced');
        await pool.execute(
          `INSERT INTO crm_remarketing_audience_members (audience_id, lead_id, status, match_keys, first_synced_at_utc, last_synced_at_utc)
           VALUES (?,?,?,?, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))
           ON DUPLICATE KEY UPDATE status=VALUES(status), match_keys=VALUES(match_keys),
             first_synced_at_utc=COALESCE(first_synced_at_utc, VALUES(first_synced_at_utc)),
             last_synced_at_utc=VALUES(last_synced_at_utc), error_message=NULL`,
          [audience.id, id, state, matchKeysFor(lead).join(',').slice(0, 120)],
        );
      }
    }

    // 5. Counts the list screen reads.
    const [[counts]] = await pool.execute(
      `SELECT COUNT(*) AS total, SUM(status='synced') AS synced
         FROM crm_remarketing_audience_members WHERE audience_id=?`, [audience.id],
    );
    const next = nextSyncAt(audience);
    await pool.execute(
      `UPDATE crm_remarketing_audiences
          SET crm_lead_count=?, synced_lead_count=?, last_sync_at_utc=CURRENT_TIMESTAMP(6),
              next_sync_at_utc=?, status=IF(status='paused','paused','active'), last_error=NULL
        WHERE id=?`,
      [desired.size, Number(counts.synced || 0), next, audience.id],
    );

    return finish(failed ? 'partial' : 'completed', {
      considered: desired.size, added, removed, failed, skipped, response,
    });
  } catch (error) {
    await pool.execute(
      `UPDATE crm_remarketing_audiences SET status='error', last_error=?, next_sync_at_utc=? WHERE id=?`,
      [String(error.message).slice(0, 1000), nextSyncAt(audience), audience.id],
    );
    await finish('failed', { error: error.message });
    throw error;
  }
}

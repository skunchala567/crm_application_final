import crypto from 'node:crypto';
import { decryptToken, getMasterKey } from '../integration-hub/crypto-utils.js';
import { getLead } from './meta-client.js';
import { recordLeadAttribution } from '../attribution/attribution-contract.js';
import { notifyEmployee } from '../notification-service.js';
import { resolveAssignmentRuleOwner } from '../assignment-rules/engine.js';

/**
 * Turns a Meta leadgen event into a CRM lead.
 *
 * Mirrors the POST /api/leads path deliberately: same advisory lock, same
 * (business_unit_id, branch_id, normalized_phone) dedupe key, same two-phase
 * lead_number write. Divergence there would let the two paths create
 * duplicate leads for the same person.
 */

const INTAKE_METHOD = 'integration';

// ---------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------

/** Meta's standard question names, plus loose matches for custom questions. */
const AUTO_RULES = [
  { field: 'email', test: (n) => n === 'email' || n.includes('email') },
  { field: 'phone', test: (n) => n.includes('phone') || n.includes('mobile') || n.includes('contact_number') },
  { field: 'studentName', test: (n) => n === 'full_name' || n === 'name' || n.includes('student_name') || n.includes('child_name') },
  { field: 'firstName', test: (n) => n === 'first_name' || n.includes('first_name') },
  { field: 'lastName', test: (n) => n === 'last_name' || n.includes('last_name') },
  { field: 'parentName', test: (n) => n.includes('parent') || n.includes('guardian') || n.includes('father') || n.includes('mother') },
  { field: 'alternatePhone', test: (n) => n.includes('alternate') || n.includes('whatsapp_number') },
  { field: 'city', test: (n) => n === 'city' || n.includes('city') || n.includes('location') },
  { field: 'applyingClass', test: (n) => n.includes('class') || n.includes('grade') || n.includes('standard') },
  { field: 'academicYear', test: (n) => n.includes('academic_year') || n.includes('session') },
];

function autoDetect(metaFieldName) {
  const name = String(metaFieldName || '').toLowerCase().trim();
  if (!name) return null;
  // Ordered: email/phone win over the looser name rules to avoid
  // "parent_email" landing in parentName.
  for (const rule of AUTO_RULES) {
    if (rule.test(name)) return rule.field;
  }
  return null;
}

/**
 * Collapse Meta's field_data array into a flat CRM record.
 *
 * @param {Array<{name:string, values:string[]}>} fieldData
 * @param {Object} mapping explicit { metaFieldName: crmField } overrides
 * @returns {{record: Object, unmapped: Object}}
 */
export function mapFieldData(fieldData, mapping = {}) {
  const record = {};
  const unmapped = {};
  let firstName = '';
  let lastName = '';

  for (const entry of Array.isArray(fieldData) ? fieldData : []) {
    const metaName = String(entry?.name || '').trim();
    if (!metaName) continue;
    const value = Array.isArray(entry?.values) ? entry.values.filter(Boolean).join(', ').trim() : '';
    if (!value) continue;

    const hasExplicitMapping = Object.prototype.hasOwnProperty.call(mapping, metaName);
    const target = hasExplicitMapping ? mapping[metaName] : autoDetect(metaName);

    if (!target) {
      // An explicit mapping of '' is the UI's "Ignore" option -- drop the
      // answer entirely. No mapping at all just means auto-detect could not
      // place it, so keep it rather than silently losing the data.
      if (!hasExplicitMapping) unmapped[metaName] = value;
      continue;
    }
    if (target === 'firstName') { firstName = value; continue; }
    if (target === 'lastName') { lastName = value; continue; }
    if (!record[target]) record[target] = value;
  }

  // Meta forms ask either full_name OR first+last, never reliably both.
  if (!record.studentName) {
    const joined = [firstName, lastName].filter(Boolean).join(' ').trim();
    if (joined) record.studentName = joined;
  }
  return { record, unmapped };
}

// ---------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------

/**
 * Atomically claim a leadgen_id for processing.
 *
 * The UNIQUE key on leadgen_id is the concurrency control: whoever wins the
 * INSERT owns the import. A duplicate-key collision means someone else has
 * it, and we only steal the claim back if their attempt ended in 'failed'.
 * Meta retries webhooks aggressively, so this runs hot.
 */
async function claimLeadgen(pool, { leadgenId, formId, pageId, adId, adgroupId, campaignMetaId, createdTime, intakeSource, rawPayload }) {
  try {
    await pool.execute(
      `INSERT INTO crm_meta_lead_imports
         (leadgen_id, form_id, page_id, ad_id, adgroup_id, campaign_meta_id,
          status, intake_source, attempts, meta_created_time, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 1, ?, ?)`,
      [
        String(leadgenId), formId || null, pageId || null, adId || null, adgroupId || null,
        campaignMetaId || null, intakeSource || 'webhook', createdTime || null,
        rawPayload ? JSON.stringify(rawPayload).slice(0, 60000) : null,
      ],
    );
    return { claimed: true, reason: 'new' };
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY') throw error;
    const [result] = await pool.execute(
      `UPDATE crm_meta_lead_imports
          SET status='pending', attempts=attempts+1, error_message=NULL,
              updated_at_utc=CURRENT_TIMESTAMP(6)
        WHERE leadgen_id=? AND status='failed'`,
      [String(leadgenId)],
    );
    return result.affectedRows > 0
      ? { claimed: true, reason: 'retry' }
      : { claimed: false, reason: 'already-processed' };
  }
}

async function settleLedger(pool, leadgenId, status, { leadId = null, error = null } = {}) {
  await pool.execute(
    `UPDATE crm_meta_lead_imports
        SET status=?, lead_id=?, error_message=?, updated_at_utc=CURRENT_TIMESTAMP(6)
      WHERE leadgen_id=?`,
    [status, leadId, error ? String(error).slice(0, 2000) : null, String(leadgenId)],
  );
}

// ---------------------------------------------------------------------
// Routing resolution
// ---------------------------------------------------------------------

function firstDefined(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

/**
 * Resolve where a lead lands. Precedence: form override -> page default ->
 * integration config -> database fallback.
 */
export async function resolveRouting(pool, { form, page, config }) {
  const businessUnitId = Number(firstDefined(form?.business_unit_id, page?.business_unit_id, config?.defaultBusinessUnitId, 1));
  const branchId = Number(firstDefined(form?.branch_id, page?.branch_id, config?.defaultBranchId, 0)) || null;

  let sourceId = Number(firstDefined(form?.source_id, config?.defaultSourceId, 0)) || null;
  if (!sourceId) {
    const [[row]] = await pool.execute(
      `SELECT id FROM crm_lead_sources WHERE name='meta_ads' AND is_active=1 LIMIT 1`,
    );
    sourceId = row ? Number(row.id) : null;
  }

  let channelId = Number(firstDefined(form?.channel_id, config?.defaultChannelId, 0)) || null;
  if (!channelId && sourceId) {
    const [[row]] = await pool.execute(`SELECT channel_id FROM crm_lead_sources WHERE id=? LIMIT 1`, [sourceId]);
    channelId = row?.channel_id ? Number(row.channel_id) : null;
  }

  let campaignId = Number(firstDefined(form?.campaign_id, config?.defaultCampaignId, 0)) || null;
  if (!campaignId) {
    const [[row]] = await pool.execute(
      `SELECT id FROM crm_campaigns WHERE campaign_code='meta_ads' AND is_active=1 LIMIT 1`,
    );
    campaignId = row ? Number(row.id) : null;
  }

  let stageId = Number(firstDefined(form?.stage_id, config?.defaultStageId, 0)) || null;
  if (!stageId) {
    const [[row]] = await pool.execute(
      `SELECT id FROM crm_lead_stages WHERE is_active=1 ORDER BY position ASC LIMIT 1`,
    );
    stageId = row ? Number(row.id) : null;
  }

  const actorUserId = Number(firstDefined(config?.actorUserId, 0)) || null;

  // No per-form or per-integration default owner -- fall back to whichever
  // Assignment Rule matches this lead's resolved branch and source, if any.
  let ownerEmployeeId = Number(firstDefined(form?.owner_employee_id, config?.defaultOwnerEmployeeId, 0)) || null;
  if (!ownerEmployeeId && branchId && sourceId) {
    ownerEmployeeId = await resolveAssignmentRuleOwner(pool, { businessUnitId, branchId, sourceId });
  }

  return {
    businessUnitId,
    branchId,
    sourceId,
    channelId,
    campaignId,
    stageId,
    substageId: Number(firstDefined(form?.substage_id, 0)) || null,
    ownerEmployeeId,
    academicYear: firstDefined(form?.academic_year, config?.defaultAcademicYear),
    classId: Number(firstDefined(form?.class_id, 0)) || null,
    curriculumId: Number(firstDefined(form?.curriculum_id, 0)) || null,
    actorUserId,
  };
}

// ---------------------------------------------------------------------
// Phone / validation helpers (kept byte-identical in behaviour to server.js)
// ---------------------------------------------------------------------

export function normalizeIndianMobile(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

export function isValidIndianMobile(value) {
  return /^[6-9]\d{9}$/.test(normalizeIndianMobile(value));
}

function cleanOptional(value, maxLength = 500) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLength) : null;
}

// ---------------------------------------------------------------------
// Lead persistence
// ---------------------------------------------------------------------

/**
 * Insert the lead, or append a source to an existing one.
 *
 * Uses the same GET_LOCK name and dedupe predicate as POST /api/leads so the
 * two paths serialise against each other rather than racing.
 */
async function persistLead(pool, { record, routing, unmapped, metaContext, logger }) {
  const normalizedPhone = normalizeIndianMobile(record.phone);
  const lockName = `crm-lead:${routing.businessUnitId}:${routing.branchId}:${normalizedPhone}`;
  const connection = await pool.getConnection();
  let locked = false;

  try {
    const [[lock]] = await connection.execute(`SELECT GET_LOCK(?,10) AS acquired`, [lockName]);
    locked = Number(lock?.acquired) === 1;
    if (!locked) {
      throw Object.assign(new Error('Could not acquire lead lock; another import is in flight'), { status: 409 });
    }

    await connection.beginTransaction();

    const [[existing]] = await connection.execute(
      `SELECT id, lead_number AS leadNumber FROM crm_leads
        WHERE business_unit_id=? AND branch_id=? AND normalized_phone=? AND deleted_at_utc IS NULL
        ORDER BY id LIMIT 1 FOR UPDATE`,
      [routing.businessUnitId, routing.branchId, normalizedPhone],
    );

    if (existing) {
      // Returning phone number. Record it as a re-enquiry from this source --
      // but source_history demands source+channel+campaign, so if any of the
      // three is unconfigured we can only mark it duplicate.
      if (!routing.sourceId || !routing.channelId || !routing.campaignId) {
        await connection.commit();
        return { outcome: 'duplicate', leadId: Number(existing.id), leadNumber: existing.leadNumber };
      }

      const [[sameSource]] = await connection.execute(
        `SELECT id FROM crm_lead_source_history WHERE lead_id=? AND source_id=? LIMIT 1`,
        [existing.id, routing.sourceId],
      );
      if (sameSource) {
        await connection.commit();
        return { outcome: 'duplicate', leadId: Number(existing.id), leadNumber: existing.leadNumber };
      }

      await connection.execute(
        `INSERT INTO crm_lead_source_history
           (lead_id, academic_year, source_id, channel_id, campaign_id,
            is_primary, intake_method, created_by_user_id)
         VALUES (?,?,?,?,?,FALSE,?,?)`,
        [
          existing.id, cleanOptional(routing.academicYear, 20) || '', routing.sourceId,
          routing.channelId, routing.campaignId, INTAKE_METHOD, routing.actorUserId,
        ],
      );
      await connection.execute(
        `UPDATE crm_leads SET re_enquired_at_utc=CURRENT_TIMESTAMP(6),
            updated_at_utc=CURRENT_TIMESTAMP(6), updated_by_user_id=? WHERE id=?`,
        [routing.actorUserId, existing.id],
      );
      await connection.execute(
        `INSERT INTO crm_lead_activities (lead_id, activity_type, summary, actor_user_id)
         VALUES (?,'re_enquired',?,?)`,
        [existing.id, `Re-enquiry from Meta Lead Ads (form ${metaContext.formId || 'unknown'})`, routing.actorUserId],
      );

      await connection.commit();
      return { outcome: 'reenquired', leadId: Number(existing.id), leadNumber: existing.leadNumber };
    }

    // New lead. lead_number is written in two phases because the human-facing
    // number embeds the autoincrement id.
    const temporaryNumber = `PENDING-${crypto.randomUUID()}`;
    const customValues = {
      metaLeadgenId: metaContext.leadgenId,
      metaFormId: metaContext.formId || null,
      metaPageId: metaContext.pageId || null,
      metaAdId: metaContext.adId || null,
      metaCampaignId: metaContext.campaignMetaId || null,
      metaIsOrganic: Boolean(metaContext.isOrganic),
      ...(Object.keys(unmapped).length ? { metaUnmappedAnswers: unmapped } : {}),
    };

    const remarkLines = ['Imported from Meta Lead Ads'];
    for (const [question, answer] of Object.entries(unmapped)) {
      remarkLines.push(`${question}: ${answer}`);
    }

    const [result] = await connection.execute(
      `INSERT INTO crm_leads
         (business_unit_id, lead_number, branch_id, student_name, phone, normalized_phone,
          alternate_phone, email, applying_class, class_id, curriculum_id, academic_year,
          parent_name, city, stage_id, source_id, owner_employee_id, channel_id, campaign_id,
          substage_id, lead_score, remarks, custom_values_json, created_by_user_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        routing.businessUnitId, temporaryNumber, routing.branchId,
        cleanOptional(record.studentName, 200), cleanOptional(record.phone, 30) || '', normalizedPhone,
        cleanOptional(record.alternatePhone, 30), cleanOptional(record.email, 254),
        cleanOptional(record.applyingClass, 50), routing.classId, routing.curriculumId,
        cleanOptional(routing.academicYear || record.academicYear, 20),
        cleanOptional(record.parentName, 200), cleanOptional(record.city, 100),
        routing.stageId, routing.sourceId, routing.ownerEmployeeId, routing.channelId,
        routing.campaignId, routing.substageId, 0,
        cleanOptional(remarkLines.join('\n'), 10000), JSON.stringify(customValues),
        routing.actorUserId,
      ],
    );

    const leadId = Number(result.insertId);
    const leadNumber = `ADM-${new Date().getFullYear()}-${String(leadId).padStart(6, '0')}`;
    await connection.execute(`UPDATE crm_leads SET lead_number=? WHERE id=?`, [leadNumber, leadId]);

    if (routing.sourceId && routing.channelId && routing.campaignId) {
      await connection.execute(
        `INSERT INTO crm_lead_source_history
           (lead_id, academic_year, source_id, channel_id, campaign_id,
            is_primary, intake_method, created_by_user_id)
         VALUES (?,?,?,?,?,TRUE,?,?)`,
        [
          leadId, cleanOptional(routing.academicYear, 20) || '', routing.sourceId,
          routing.channelId, routing.campaignId, INTAKE_METHOD, routing.actorUserId,
        ],
      );
    }

    await connection.execute(
      `INSERT INTO crm_lead_activities (lead_id, activity_type, summary, actor_user_id)
       VALUES (?,'created',?,?)`,
      [leadId, `Lead captured from Meta Lead Ads (form ${metaContext.formId || 'unknown'})`, routing.actorUserId],
    );

    await notifyEmployee(connection, {
      businessUnitId: Number(routing.businessUnitId),
      employeeId: Number(routing.ownerEmployeeId),
      actorUserId: Number(routing.actorUserId),
      type: 'lead_assigned',
      title: 'New lead added from Meta',
      message: `${cleanOptional(record.studentName, 200) || 'New lead'} · ${leadNumber}`,
      link: `/leads?lead=${leadId}`,
      entityType: 'lead',
      entityId: leadId,
    });

    await connection.commit();
    return { outcome: 'imported', leadId, leadNumber };
  } catch (error) {
    try { await connection.rollback(); } catch { /* rollback on a dead txn is not actionable */ }
    throw error;
  } finally {
    if (locked) {
      try { await connection.execute(`SELECT RELEASE_LOCK(?)`, [lockName]); } catch (releaseError) {
        logger?.warn?.('[Meta] Failed to release lead lock', { lockName, message: releaseError.message });
      }
    }
    connection.release();
  }
}

// ---------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------

export function decryptPageToken(page) {
  if (!page?.access_token_encrypted) return null;
  try {
    return decryptToken(page.access_token_encrypted, getMasterKey());
  } catch {
    return null;
  }
}

async function loadFormAndPage(pool, { formId, pageId }) {
  let form = null;
  if (formId) {
    const [[row]] = await pool.execute(`SELECT * FROM crm_meta_forms WHERE form_id=? LIMIT 1`, [String(formId)]);
    form = row || null;
  }
  const effectivePageId = pageId || form?.page_id || null;
  let page = null;
  if (effectivePageId) {
    const [[row]] = await pool.execute(`SELECT * FROM crm_meta_pages WHERE page_id=? LIMIT 1`, [String(effectivePageId)]);
    page = row || null;
  }
  return { form, page };
}

function parseJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

/**
 * Import a single Meta lead end to end.
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {Object} params
 * @param {string} params.leadgenId
 * @param {Object} [params.leadData] pre-fetched Graph payload (backfill path)
 * @returns {Promise<{status:string, leadId?:number, reason?:string}>}
 */
/**
 * Turn a class answer that is really an id into the class it names.
 *
 * A Meta form often asks its class question as `class_id` and answers it with
 * the CRM's own id -- "4". The field mapper matches any question containing
 * "class" into applyingClass, which is free text, so the lead ended up
 * displaying "4" with class_id left null. Resolving it here sets the real
 * foreign key and puts the readable name in applying_class, which is what the
 * Leads screen shows.
 *
 * A non-numeric answer ("Grade 4", "III") is left exactly as typed: only an id
 * that matches a real class is translated.
 */
async function resolveClassAnswer(pool, record, routing) {
  const answer = String(record.applyingClass ?? '').trim();
  if (!answer) return;
  if (!/^\d+$/.test(answer)) return;
  const [[cls]] = await pool.execute(
    'SELECT id, display_name AS displayName FROM crm_classes WHERE id=? AND is_active=TRUE LIMIT 1',
    [Number(answer)],
  );
  if (!cls) return;
  record.applyingClass = cls.displayName;
  if (!routing.classId) routing.classId = Number(cls.id);
  /*
   * The curriculum follows the class only when there is one answer. A class
   * offered under several curricula is genuinely ambiguous from a Meta form
   * that never asked, so it stays with whatever the form's routing set.
   */
  if (!routing.curriculumId && routing.branchId) {
    const [rows] = await pool.execute(
      `SELECT DISTINCT acc.curriculum_id AS curriculumId
         FROM crm_admission_class_configurations acc
         JOIN crm_admission_class_configuration_details d
           ON d.configuration_id = acc.id AND d.is_active = TRUE AND d.class_id = ?
        WHERE acc.branch_id = ? AND acc.is_active = TRUE`,
      [Number(cls.id), Number(routing.branchId)],
    );
    if (rows.length === 1) routing.curriculumId = Number(rows[0].curriculumId);
  }
}

export async function importMetaLead(pool, {
  leadgenId,
  formId = null,
  pageId = null,
  adId = null,
  adgroupId = null,
  campaignMetaId = null,
  createdTime = null,
  leadData = null,
  intakeSource = 'webhook',
  /*
   * Hold the lead for a person to look at instead of creating it.
   *
   * The answers a lead carries are worth reading before it becomes a record --
   * a form can ask anything, and a bad mapping is only obvious once you see
   * what came back. Held leads sit in the ledger as 'pending' with the full
   * payload, and Meta Lead Ads > Waiting for review turns them into leads.
   */
  holdForReview = false,
  config = {},
  logger = console,
}) {
  if (!leadgenId) return { status: 'skipped', reason: 'missing leadgen_id' };

  const claim = await claimLeadgen(pool, {
    leadgenId, formId, pageId, adId, adgroupId, campaignMetaId,
    createdTime, intakeSource, rawPayload: leadData,
  });
  if (!claim.claimed) {
    return { status: 'skipped', reason: claim.reason };
  }

  try {
    const { form, page } = await loadFormAndPage(pool, { formId, pageId });

    if (form && form.is_active === 0) {
      await settleLedger(pool, leadgenId, 'skipped', { error: 'Form is disabled' });
      return { status: 'skipped', reason: 'form disabled' };
    }
    if (page && page.is_active === 0) {
      await settleLedger(pool, leadgenId, 'skipped', { error: 'Page is disabled' });
      return { status: 'skipped', reason: 'page disabled' };
    }

    // Webhook deliveries carry ids only -- fetch the answers with the Page token.
    let payload = leadData;
    if (!payload) {
      const pageToken = decryptPageToken(page);
      if (!pageToken) {
        await settleLedger(pool, leadgenId, 'failed', { error: 'No usable Page access token; re-sync Pages' });
        return { status: 'failed', reason: 'missing page token' };
      }
      payload = await getLead(leadgenId, pageToken, { logger });
    }

    /*
     * Stop here when holding: the answers are now on the ledger row, so the
     * review screen can show exactly what Meta sent without anyone guessing.
     * Nothing is validated yet either -- a missing name or an odd phone is
     * something to see on screen, not a silent failure.
     */
    if (holdForReview) {
      await pool.execute(
        `UPDATE crm_meta_lead_imports
            SET raw_payload=?, status='pending', error_message=NULL,
                updated_at_utc=CURRENT_TIMESTAMP(6)
          WHERE leadgen_id=?`,
        [payload ? JSON.stringify(payload).slice(0, 60000) : null, String(leadgenId)],
      );
      return { status: 'pending', reason: 'held for review' };
    }

    const resolvedFormId = formId || payload?.form_id || form?.form_id || null;
    const { form: resolvedForm, page: resolvedPage } = resolvedFormId && !form
      ? await loadFormAndPage(pool, { formId: resolvedFormId, pageId })
      : { form, page };

    const mapping = parseJson(resolvedForm?.field_mapping, {});
    const { record, unmapped } = mapFieldData(payload?.field_data, mapping);

    if (!record.studentName) {
      await settleLedger(pool, leadgenId, 'failed', { error: 'Lead has no name field; configure the form field mapping' });
      return { status: 'failed', reason: 'missing name' };
    }
    if (!isValidIndianMobile(record.phone)) {
      await settleLedger(pool, leadgenId, 'failed', {
        error: `Phone "${record.phone || '(none)'}" is not a valid Indian mobile number`,
      });
      return { status: 'failed', reason: 'invalid phone' };
    }

    const routing = await resolveRouting(pool, { form: resolvedForm, page: resolvedPage, config });
    if (!routing.branchId) {
      await settleLedger(pool, leadgenId, 'failed', { error: 'No branch configured for this Page/form' });
      return { status: 'failed', reason: 'missing branch' };
    }
    // Needs the branch, so it runs once routing is known.
    await resolveClassAnswer(pool, record, routing);
    if (!routing.stageId) {
      await settleLedger(pool, leadgenId, 'failed', { error: 'No lead stage available' });
      return { status: 'failed', reason: 'missing stage' };
    }
    if (!routing.actorUserId) {
      await settleLedger(pool, leadgenId, 'failed', {
        error: 'No actor user configured (set actorUserId on the Meta integration)',
      });
      return { status: 'failed', reason: 'missing actor user' };
    }

    const result = await persistLead(pool, {
      record,
      routing,
      unmapped,
      metaContext: {
        leadgenId,
        formId: resolvedFormId,
        pageId: resolvedPage?.page_id || pageId,
        adId: adId || payload?.ad_id || null,
        adgroupId: adgroupId || payload?.adset_id || null,
        campaignMetaId: campaignMetaId || payload?.campaign_id || null,
        isOrganic: payload?.is_organic,
      },
      logger,
    });

    /*
     * Attribution for a Meta lead.
     *
     * There is no click identifier to capture here: these leads are filled in
     * on Meta's own form inside Facebook or Instagram and never land on our
     * website, so no fbclid is ever generated. The advertisement is instead
     * identified by the ids Meta hands us in the webhook, and the lead itself
     * by leadgen_id -- which is also what the Conversions API expects back
     * when we report an enrolment, so no personal data needs to be matched.
     *
     * Organic page submissions arrive with no ad ids at all; those record as
     * a touch with origin meta_lead_ads and no platform, which is honest --
     * the lead came from Meta but no advertisement paid for it.
     */
    if (result?.leadId && result.outcome !== 'duplicate') {
      await recordLeadAttribution(pool, result.leadId, {
        origin: 'meta_lead_ads',
        platformCode: 'meta',
        channelGroup: payload?.is_organic ? 'organic_social' : 'paid_social',
        platformLeadId: leadgenId,
        platformAdId: adId || payload?.ad_id || null,
        platformAdgroupId: adgroupId || payload?.adset_id || null,
        platformCampaignId: campaignMetaId || payload?.campaign_id || null,
        campaignName: resolvedForm?.form_name || null,
        capturedAt: createdTime || payload?.created_time || null,
      }, { origin: 'meta_lead_ads', logger });
    }

    const ledgerStatus = result.outcome === 'imported' ? 'imported'
      : result.outcome === 'reenquired' ? 'imported'
      : 'duplicate';
    await settleLedger(pool, leadgenId, ledgerStatus, { leadId: result.leadId });

    return { status: result.outcome, leadId: result.leadId, leadNumber: result.leadNumber };
  } catch (error) {
    logger.error?.('[Meta] Lead import failed', { leadgenId, message: error.message });
    await settleLedger(pool, leadgenId, 'failed', { error: error.message });
    return { status: 'failed', reason: error.message };
  }
}

export const __testing = { autoDetect, claimLeadgen, parseJson };

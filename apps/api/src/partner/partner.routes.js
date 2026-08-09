import { Router } from 'express';
import crypto from 'node:crypto';

/**
 * Partner write-back API.
 *
 * Built for the SmatBot AI voice qualification integration, but nothing here
 * is SmatBot-specific beyond a default partner name: any partner that scores
 * or qualifies a lead can use the same endpoint with its own key.
 *
 * Deliberately NOT the ordinary lead update API. That one authenticates a
 * person: the token expires, it carries that person's branch scope, and it
 * can change every field on the record. A partner needs none of that and
 * should not be handed it. This endpoint takes an API key, writes only the
 * qualification fields, and is scoped to one business unit.
 */

const CALL_STATUS = new Set([
  // Phase 1, AI call.
  'answered', 'no_answer', 'busy', 'failed',
  // Phase 2, representative call.
  'connected', 'rep_no_answer', 'lead_no_answer',
]);
const LEAD_QUALITY = new Set(['hot', 'warm', 'cold', 'lost']);
const CALL_ASSESSMENT = new Set(['qualified', 'short_call', 'insufficient_info']);
const FITMENT = new Set(['fit', 'partial', 'no_fit']);

const text = (value, max) => (value == null ? null : String(value).trim().slice(0, max) || null);
const hashKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

/**
 * ISO 8601 in, MySQL DATETIME out; anything unparseable becomes null.
 *
 * Written as local wall-clock, not UTC. Every _utc column in this schema
 * actually holds IST because the pool pins each connection to '+05:30', so
 * calling toISOString() here would store the value five and a half hours
 * early.
 */
function toSqlDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function createPartnerRoutes(pool) {
  const router = Router();

  /**
   * API-key authentication.
   *
   * Compared as hashes and in constant time, so neither a database leak nor
   * response timing hands the key over. A used key has its timestamp bumped
   * so an unused integration is visible.
   */
  async function authenticatePartner(req, res, next) {
    try {
      const presented = req.get('X-API-Key') || (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      if (!presented) return res.status(401).json({ success: false, message: 'X-API-Key header is required' });

      const [[key]] = await pool.execute(
        `SELECT id, business_unit_id AS businessUnitId, partner_key AS partnerKey, key_hash AS keyHash, scopes
           FROM crm_partner_api_keys
          WHERE key_hash = ? AND is_active = TRUE AND revoked_at_utc IS NULL
          LIMIT 1`,
        [hashKey(presented)],
      );
      if (!key) return res.status(401).json({ success: false, message: 'Invalid or revoked API key' });

      const presentedHash = Buffer.from(hashKey(presented));
      const storedHash = Buffer.from(key.keyHash);
      if (presentedHash.length !== storedHash.length
        || !crypto.timingSafeEqual(presentedHash, storedHash)) {
        return res.status(401).json({ success: false, message: 'Invalid or revoked API key' });
      }

      req.partner = key;
      pool.execute('UPDATE crm_partner_api_keys SET last_used_at_utc = NOW(6) WHERE id = ?', [key.id])
        .catch(() => {}); // Bookkeeping only; never fail the request over it.
      return next();
    } catch (error) {
      return next(error);
    }
  }

  const requireScope = (scope) => (req, res, next) => {
    const held = String(req.partner?.scopes || '').split(',').map((s) => s.trim());
    if (!held.includes(scope)) {
      return res.status(403).json({ success: false, message: `This key does not hold the ${scope} scope` });
    }
    return next();
  };

  /**
   * Resolve the lead the partner is talking about.
   *
   * Accepts either identifier, because "unique CRM record ID" is ambiguous:
   * the CRM has a numeric id and a lead number (ADM-2026-000621). Whichever
   * was sent at trigger comes back at write-back.
   *
   * Scoped to the key's business unit, so a key issued for one business
   * cannot write to another's leads.
   */
  async function findLead(businessUnitId, leadId) {
    const raw = String(leadId ?? '').trim();
    if (!raw) return null;
    const [[lead]] = await pool.execute(
      `SELECT id, lead_number AS leadNumber, student_name AS studentName, business_unit_id AS businessUnitId
         FROM crm_leads
        WHERE business_unit_id = ? AND deleted_at_utc IS NULL
          AND (lead_number = ? OR (? REGEXP '^[0-9]+$' AND id = ?))
        LIMIT 1`,
      [businessUnitId, raw, raw, Number(raw) || 0],
    );
    return lead || null;
  }

  /** Rejects an unknown enum value rather than storing it silently. */
  function checkEnum(value, allowed, field, errors) {
    const clean = text(value, 40);
    if (clean == null) return null;
    if (!allowed.has(clean)) {
      errors.push(`${field} must be one of: ${[...allowed].join(', ')}`);
      return null;
    }
    return clean;
  }

  /**
   * POST /api/partner/leads/qualification
   *
   * The write-back for both phases. Phase 1 is the AI pre-qualification,
   * phase 2 the representative call; they differ only in which fields carry
   * meaning, so one endpoint serves both.
   */
  router.post('/leads/qualification', authenticatePartner, requireScope('lead.qualification.write'),
    async (req, res, next) => {
      try {
        const body = req.body || {};
        const errors = [];

        const phase = Number(body.phase);
        if (![1, 2].includes(phase)) errors.push('phase must be 1 or 2');

        const lead = await findLead(req.partner.businessUnitId, body.lead_id ?? body.leadId);
        if (!lead) {
          return res.status(404).json({
            success: false,
            message: 'No lead in this business unit matches that lead_id',
          });
        }

        const callStatus = checkEnum(body.call_status, CALL_STATUS, 'call_status', errors);
        const leadQuality = checkEnum(body.lead_quality, LEAD_QUALITY, 'lead_quality', errors);
        const assessment = checkEnum(body.call_assessment, CALL_ASSESSMENT, 'call_assessment', errors);

        /*
         * The fitment dimensions are taken as a map rather than four fixed
         * columns. The specification names them for real estate (budget,
         * size, configuration, location); admissions will want different
         * ones, and this stores whatever is sent without a schema change.
         */
        const fitment = {};
        const incoming = body.fitment && typeof body.fitment === 'object' && !Array.isArray(body.fitment)
          ? body.fitment
          : Object.fromEntries(Object.entries(body)
            .filter(([key]) => key.endsWith('_fitment'))
            .map(([key, value]) => [key.replace(/_fitment$/, ''), value]));
        for (const [dimension, value] of Object.entries(incoming).slice(0, 20)) {
          const clean = checkEnum(value, FITMENT, `${dimension} fitment`, errors);
          if (clean) fitment[text(dimension, 40)] = clean;
        }

        if (errors.length) return res.status(400).json({ success: false, message: errors.join('; '), errors });

        const record = {
          businessUnitId: req.partner.businessUnitId,
          leadId: lead.id,
          partnerKey: req.partner.partnerKey,
          phase,
          callStatus,
          leadQuality,
          assessment,
          urgency: text(body.purchase_urgency, 120),
          budget: text(body.budget_footprint, 255),
          fitment: Object.keys(fitment).length ? JSON.stringify(fitment) : null,
          callAt: toSqlDateTime(body.call_timestamp),
          duration: Number.isFinite(Number(body.call_duration)) ? Math.max(0, Math.trunc(Number(body.call_duration))) : null,
          recordingUrl: text(body.recording_url || body.recordingUrl, 1000),
          summary: text(body.summary, 5000),
          salesRepId: text(body.sales_rep_id, 60),
          // A retried delivery must update, not duplicate.
          externalCallId: text(body.call_id || body.external_call_id, 120) || `phase-${phase}`,
        };

        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          await connection.execute(
            `INSERT INTO crm_lead_qualifications
               (business_unit_id, lead_id, partner_key, phase, call_status, lead_quality, call_assessment,
                purchase_urgency, budget_footprint, fitment_json, call_at_utc, call_duration_seconds,
                recording_url, summary, sales_rep_id, external_call_id, raw_payload)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
               call_status = VALUES(call_status), lead_quality = VALUES(lead_quality),
               call_assessment = VALUES(call_assessment), purchase_urgency = VALUES(purchase_urgency),
               budget_footprint = VALUES(budget_footprint), fitment_json = VALUES(fitment_json),
               call_at_utc = VALUES(call_at_utc), call_duration_seconds = VALUES(call_duration_seconds),
               recording_url = VALUES(recording_url), summary = VALUES(summary),
               sales_rep_id = VALUES(sales_rep_id), raw_payload = VALUES(raw_payload)`,
            [record.businessUnitId, record.leadId, record.partnerKey, record.phase, record.callStatus,
              record.leadQuality, record.assessment, record.urgency, record.budget, record.fitment,
              record.callAt, record.duration, record.recordingUrl, record.summary, record.salesRepId,
              record.externalCallId, JSON.stringify(body).slice(0, 60000)],
          );

          /*
           * The rating is copied onto the lead so the list can sort by it.
           * Phase 2 refines phase 1, per the specification, so a later phase
           * overwrites -- but a phase 1 arriving late must not undo phase 2.
           */
          if (record.leadQuality) {
            // Phase 2 always wins. Phase 1 writes only while no phase 2 has
            // rated this lead, so a late or replayed phase 1 cannot undo the
            // representative's own assessment.
            await connection.execute(
              `UPDATE crm_leads SET lead_quality = ?, lead_quality_at_utc = NOW(6)
                WHERE id = ?
                  AND (? = 2 OR NOT EXISTS (
                        SELECT 1 FROM crm_lead_qualifications q
                         WHERE q.lead_id = ? AND q.phase = 2 AND q.lead_quality IS NOT NULL))`,
              [record.leadQuality, record.leadId, phase, record.leadId],
            );
          }

          /*
           * The call itself joins the lead's activity feed, where the CRM
           * already shows CallerDesk and Smartflo calls with a player. An AI
           * call and a human call then read the same way.
           */
          const [[callConfig]] = await connection.execute(
            'SELECT id FROM crm_callerdesk_configs WHERE business_unit_id = ? ORDER BY id LIMIT 1',
            [record.businessUnitId],
          );
          // config_id is null when no telephony account is configured: an AI
          // call belongs to the partner, not to CallerDesk.
          if (record.recordingUrl || record.callAt) {
            await connection.execute(
              `INSERT INTO crm_call_activities
                 (config_id, business_unit_id, lead_id, callerdesk_sid, direction, destination_number,
                  status, call_result, started_at_utc, duration_seconds, talk_seconds, recording_url, notes)
               VALUES (?,?,?,?,'outbound',NULL,'completed',?,?,?,?,?,?)
               ON DUPLICATE KEY UPDATE
                 call_result = VALUES(call_result), started_at_utc = VALUES(started_at_utc),
                 duration_seconds = VALUES(duration_seconds), talk_seconds = VALUES(talk_seconds),
                 recording_url = VALUES(recording_url), notes = VALUES(notes)`,
              [callConfig?.id ?? null, record.businessUnitId, record.leadId,
                `${record.partnerKey}-${phase}-${record.externalCallId}`.slice(0, 120),
                // duration_seconds is NOT NULL on that table; a phase 1
                // payload carries no duration, and "unknown" is 0 there.
                record.callStatus, record.callAt, record.duration ?? 0, record.duration ?? 0,
                record.recordingUrl,
                [record.summary, record.urgency && `Urgency: ${record.urgency}`].filter(Boolean).join(' · ') || null],
            );
          }

          await connection.commit();
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }

        return res.json({
          success: true,
          data: {
            lead_id: lead.leadNumber,
            crm_lead_id: lead.id,
            phase,
            lead_quality: record.leadQuality,
            applied_at: new Date().toISOString(),
          },
        });
      } catch (error) {
        return next(error);
      }
    });

  /** Lets a partner confirm its key works before wiring anything up. */
  router.get('/ping', authenticatePartner, (req, res) => {
    res.json({
      success: true,
      data: { partner: req.partner.partnerKey, businessUnitId: req.partner.businessUnitId, scopes: req.partner.scopes },
    });
  });

  return router;
}

export default createPartnerRoutes;

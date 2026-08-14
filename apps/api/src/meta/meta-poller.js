/**
 * Pulls new Meta Lead Ads leads on a timer.
 *
 * Meta will not deliver webhooks for an unpublished app -- "No production
 * data, including from app admins, developers or testers, will be delivered
 * unless the app has been published" -- so until App Review completes, the
 * webhook cannot be the intake path no matter how it is configured. Somebody
 * had to press Backfill by hand for every lead.
 *
 * This runs the same backfill each form already supports, on a schedule. It is
 * the bridge, not the destination: once the app is published and the webhook
 * delivers, this keeps working as a safety net for anything a delivery misses,
 * because both paths share one ledger.
 *
 * Cheap and idempotent by construction:
 *   - each form carries last_backfill_time, so a run only asks Meta for leads
 *     newer than the last one it saw;
 *   - crm_meta_lead_imports has a UNIQUE leadgen_id, so a lead already taken
 *     by the webhook or an earlier run is recorded as a duplicate, not a
 *     second lead.
 */
import { listFormLeads } from './meta-client.js';
import { loadMetaConfig } from './meta-config.js';
import { importMetaLead, decryptPageToken } from './meta-lead.service.js';

/** One pass over every enabled form. */
export async function pollMetaForms(pool, logger = console) {
  const config = await loadMetaConfig(pool, { useCache: false });
  // Nothing configured, or no token to read leads with: stay silent rather
  // than logging an error every interval.
  if (!config?.systemUserToken) return { skipped: 'not configured' };

  const [forms] = await pool.execute(
    `SELECT f.form_id AS formId, f.page_id AS pageId, f.last_backfill_time AS watermark
     FROM crm_meta_forms f
     JOIN crm_meta_pages p ON p.page_id = f.page_id
     WHERE COALESCE(f.is_active, TRUE) = TRUE AND COALESCE(p.is_active, TRUE) = TRUE`,
  );
  if (!forms.length) return { forms: 0 };

  const totals = { forms: forms.length, fetched: 0, pending: 0, imported: 0, duplicate: 0, failed: 0, skipped: 0 };

  for (const form of forms) {
    try {
      const [[page]] = await pool.execute('SELECT * FROM crm_meta_pages WHERE page_id=? LIMIT 1', [form.pageId]);
      const token = decryptPageToken(page);
      if (!token) continue;

      const since = form.watermark ? Number(form.watermark) : null;
      const leads = await listFormLeads(form.formId, token, { sinceEpochSeconds: since, logger });
      totals.fetched += leads.length;
      let watermark = since || 0;

      for (const lead of leads) {
        const createdTime = lead.created_time ? Math.floor(new Date(lead.created_time).getTime() / 1000) : null;
        if (createdTime && createdTime > watermark) watermark = createdTime;
        const result = await importMetaLead(pool, {
          leadgenId: String(lead.id),
          formId: form.formId,
          pageId: form.pageId,
          adId: lead.ad_id || null,
          campaignMetaId: lead.campaign_id || null,
          createdTime,
          leadData: lead,
          // Named apart from a hand-pressed backfill so the ledger still shows
          // which leads arrived on their own.
          intakeSource: 'poll',
          // Held, not imported: a person reads the answers first on
          // Meta Lead Ads > Waiting for review.
          holdForReview: true,
          config,
          logger,
        });
        if (totals[result.status] !== undefined) totals[result.status] += 1;
      }

      if (watermark) {
        await pool.execute(
          'UPDATE crm_meta_forms SET last_backfill_time=?, last_synced_at_utc=CURRENT_TIMESTAMP(6) WHERE form_id=?',
          [watermark, form.formId],
        );
      }
    } catch (error) {
      // One bad form must not stop the others.
      logger.error?.('[Meta] Poll failed for form', { formId: form.formId, message: error.message });
    }
  }

  if (totals.pending || totals.imported || totals.failed) {
    logger.info?.('[Meta] Poll cycle', totals);
  }
  return totals;
}

/**
 * Starts the timer. Interval comes from META_POLL_INTERVAL_SECONDS, defaulting
 * to two minutes -- often enough that a lead feels immediate, rare enough to
 * stay well inside Meta's rate limits. Set it to 0 to switch polling off once
 * the webhook is live and trusted.
 */
export function startMetaPoller(pool, logger = console) {
  const seconds = Number(process.env.META_POLL_INTERVAL_SECONDS ?? 120);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    logger.info?.('[Meta] Lead polling disabled (META_POLL_INTERVAL_SECONDS=0)');
    return null;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await pollMetaForms(pool, logger);
    } catch (error) {
      logger.error?.('[Meta] Poll cycle failed', { message: error.message });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, seconds * 1000);
  timer.unref?.();
  // Give the rest of start-up a moment before the first pass.
  setTimeout(tick, 15000).unref?.();
  logger.info?.(`[Meta] Lead polling every ${seconds}s until the webhook is live`);
  return timer;
}

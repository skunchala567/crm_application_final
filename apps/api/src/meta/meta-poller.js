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
import { listMetaConfigs, markMetaIntegrationState } from './meta-config.js';
import { importMetaLead, decryptPageToken } from './meta-lead.service.js';

/** One pass over every enabled form. */
export async function pollMetaForms(pool, logger = console) {
  /*
   * Every account, not one.
   *
   * A Meta account belongs to a business unit, so a unit that connected its
   * own Facebook app has its own account -- and a cycle that loaded a single
   * config would work one unit's forms with another unit's credentials, or
   * skip them entirely when the unit that saved last had no token.
   *
   * Nothing configured, or no token anywhere to read leads with: stay silent
   * rather than logging an error every interval.
   */
  const configs = (await listMetaConfigs(pool)).filter((item) => item.systemUserToken);
  if (!configs.length) return { skipped: 'not configured' };
  const configByIntegration = new Map(configs.map((item) => [Number(item.integrationId), item]));

  /* The form's effective destination decides whether its leads wait.
     A form that names both a business unit and a branch -- its own, or the
     Page's -- has everything an import needs, so there is nothing for a
     person to decide and the lead goes straight in.

     integration_id says which account connected the Page, and so which
     account's config imports its leads. */
  const [forms] = await pool.execute(
    `SELECT f.form_id AS formId, f.page_id AS pageId, f.last_backfill_time AS watermark,
            p.integration_id AS integrationId,
            COALESCE(f.business_unit_id, p.business_unit_id) AS businessUnitId,
            COALESCE(f.branch_id, p.branch_id) AS branchId
     FROM crm_meta_forms f
     JOIN crm_meta_pages p ON p.page_id = f.page_id
     WHERE COALESCE(f.is_active, TRUE) = TRUE AND COALESCE(p.is_active, TRUE) = TRUE`,
  );
  if (!forms.length) return { forms: 0 };

  const totals = { forms: forms.length, fetched: 0, pending: 0, imported: 0, duplicate: 0, failed: 0, skipped: 0, unconfigured: 0 };
  // Which accounts actually completed work this cycle, for the state below.
  const polled = new Set();

  for (const form of forms) {
    const routed = Boolean(form.businessUnitId) && Boolean(form.branchId);
    /*
     * With one account there is nothing to choose between and nothing to
     * cross: every form is polled with it, exactly as before, including Pages
     * connected before accounts belonged to units and .env-only setups whose
     * Page rows point at an integration id that no longer exists.
     *
     * With several, the Page's own account is the only correct one, and a
     * Page whose account is missing waits rather than being read with
     * another unit's credentials.
     */
    const config = configs.length === 1
      ? configs[0]
      : configByIntegration.get(Number(form.integrationId)) || (form.integrationId == null ? configs[0] : null);
    if (!config) {
      /* The account this Page was connected through is gone, disabled, or has
         no token. Its forms are left alone rather than read with somebody
         else's credentials. */
      totals.unconfigured += 1;
      continue;
    }
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
          /*
           * Held only when the form cannot say where the lead belongs.
           *
           * Once a form names its business unit and branch, holding adds
           * nothing: the routing question a review answers is already
           * answered, and every lead would queue up waiting for somebody to
           * press a button that changes nothing. A form still missing either
           * one keeps waiting, because importing it would guess.
           */
          holdForReview: !routed,
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
      if (config.integrationId) polled.add(Number(config.integrationId));
    } catch (error) {
      // One bad form must not stop the others.
      logger.error?.('[Meta] Poll failed for form', { formId: form.formId, message: error.message });
    }
  }

  if (totals.pending || totals.imported || totals.failed) {
    logger.info?.('[Meta] Poll cycle', totals);
  }
  /* A completed cycle is proof the connection works, and it is the only
     thing that can honestly fill in "Last sync" on the Integrations tile --
     for each account that actually read its own forms. An account whose forms
     all failed, or that has none, is left as it was rather than being marked
     connected on somebody else's cycle. */
  for (const integrationId of polled) {
    await markMetaIntegrationState(pool, { connected: true, synced: true, integrationId, logger });
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

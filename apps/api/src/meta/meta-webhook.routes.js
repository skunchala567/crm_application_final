import crypto from 'node:crypto';
import { Router } from 'express';
import { importMetaLead } from './meta-lead.service.js';
import { listMetaConfigs } from './meta-config.js';

/**
 * Meta Lead Ads webhook receiver.
 *
 * Public (Meta calls it unauthenticated), so the app-secret HMAC over the raw
 * body is the ONLY thing separating a real delivery from a forged one. It is
 * enforced, not optional -- an unverified payload is rejected with 401.
 *
 * Requires req.rawBody, populated by the express.json({ verify }) hook in
 * server.js. Signing over a re-serialised body would not match Meta's bytes.
 *
 * One URL serves every business unit's Meta account, because Meta gives an app
 * one callback and the delivery says nothing about business units. The
 * signature is what identifies the account: the delivery is verified against
 * each configured app secret, and the one that matches is the account -- and
 * therefore the unit -- the lead belongs to. Nothing in the body is trusted
 * before that, so a forged payload cannot name an account.
 */

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Constant-time compare of Meta's X-Hub-Signature-256 against our own HMAC.
 * Length is checked first because timingSafeEqual throws on a size mismatch.
 */
export function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!rawBody || !signatureHeader || !appSecret) return false;
  const provided = String(signatureHeader).trim();
  if (!provided.startsWith('sha256=')) return false;

  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const providedHex = provided.slice('sha256='.length);
  if (providedHex.length !== expected.length) return false;

  try {
    return crypto.timingSafeEqual(Buffer.from(providedHex, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export function createMetaWebhookRoutes(pool, logger = console) {
  const router = Router();

  /**
   * Subscription handshake. Meta calls this once when the webhook URL is
   * saved and expects the raw challenge echoed back as text/plain.
   */
  router.get('/webhook', wrap(async (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    /* Any account's verify token will do: each unit subscribes its own app,
       and this one URL has to answer the handshake for all of them. */
    const configs = await listMetaConfigs(pool);
    const expected = configs.map((item) => item.verifyToken).filter(Boolean);

    if (!expected.length) {
      logger.warn?.('[Meta] Webhook verification attempted with no verify token configured');
      return res.status(503).send('Meta integration is not configured');
    }
    if (mode !== 'subscribe' || !expected.some((value) => String(token) === String(value))) {
      logger.warn?.('[Meta] Webhook verification rejected', { mode });
      return res.sendStatus(403);
    }
    logger.info?.('[Meta] Webhook verified');
    return res.status(200).type('text/plain').send(String(challenge ?? ''));
  }));

  /**
   * Leadgen delivery.
   *
   * Meta retries on any non-2xx and treats a slow response as failure, so we
   * ack immediately and import afterwards. Redelivery is safe: the ledger's
   * UNIQUE leadgen_id makes importMetaLead idempotent.
   */
  router.post('/webhook', wrap(async (req, res) => {
    const configs = (await listMetaConfigs(pool)).filter((item) => item.appSecret);
    if (!configs.length) {
      logger.error?.('[Meta] Webhook received but no app secret is configured');
      return res.status(503).json({ message: 'Meta integration is not configured' });
    }

    const signature = req.get('x-hub-signature-256');
    const verified = configs.filter((item) => verifyMetaSignature(req.rawBody, signature, item.appSecret));
    if (!verified.length) {
      logger.warn?.('[Meta] Rejected webhook with invalid signature', {
        hasRawBody: Boolean(req.rawBody),
        hasSignature: Boolean(signature),
        accountsTried: configs.length,
      });
      return res.status(401).json({ message: 'Invalid signature' });
    }
    /* Provisional: correct already when one account signed it, and refined per
       delivery below when several share one Facebook app -- then the Page the
       lead came from is what separates them. */
    const config = verified[0];

    const body = req.body || {};
    if (body.object !== 'page') {
      return res.sendStatus(200); // not ours; ack so Meta stops retrying
    }

    // Ack before importing -- Meta's timeout is short and unforgiving.
    res.sendStatus(200);

    const jobs = [];
    for (const entry of Array.isArray(body.entry) ? body.entry : []) {
      for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
        if (change.field !== 'leadgen') continue;
        const value = change.value || {};
        if (!value.leadgen_id) continue;
        jobs.push({
          leadgenId: String(value.leadgen_id),
          formId: value.form_id ? String(value.form_id) : null,
          pageId: value.page_id ? String(value.page_id) : String(entry.id || ''),
          adId: value.ad_id ? String(value.ad_id) : null,
          adgroupId: value.adgroup_id ? String(value.adgroup_id) : null,
          createdTime: value.created_time ? Number(value.created_time) : null,
        });
      }
    }

    if (!jobs.length) return;

    /*
     * Which account a Page belongs to, when more than one verified the
     * signature -- two units running the same Facebook app share its secret,
     * so the secret alone cannot separate them. The Page is connected under
     * exactly one account, and that is the account whose credentials and unit
     * the lead should be imported with.
     *
     * Only consulted for a Page one of the verified accounts owns: a Page
     * belonging to some other account is left with the provisional choice
     * rather than reaching outside the accounts that signed the delivery.
     */
    const accountForPage = async (pageId) => {
      if (verified.length === 1 || !pageId) return config;
      const [[page]] = await pool.execute('SELECT integration_id AS integrationId FROM crm_meta_pages WHERE page_id=? LIMIT 1', [pageId]);
      const owner = verified.find((item) => Number(item.integrationId) === Number(page?.integrationId));
      return owner || config;
    };

    // Sequential on purpose: bursts from one campaign usually share a branch,
    // and the per-phone advisory lock would just serialise them anyway.
    for (const job of jobs) {
      try {
        const account = await accountForPage(job.pageId);
        const result = await importMetaLead(pool, { ...job, intakeSource: 'webhook', config: account, logger });
        logger.info?.('[Meta] Webhook lead processed', {
          leadgenId: job.leadgenId,
          status: result.status,
          leadId: result.leadId ?? null,
          integrationId: account?.integrationId ?? null,
        });
      } catch (error) {
        // importMetaLead already records failures in the ledger; this only
        // catches a total failure of that bookkeeping.
        logger.error?.('[Meta] Webhook lead crashed', { leadgenId: job.leadgenId, message: error.message });
      }
    }
  }));

  return router;
}

export default createMetaWebhookRoutes;

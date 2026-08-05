import crypto from 'node:crypto';
import { Router } from 'express';
import { importMetaLead } from './meta-lead.service.js';
import { loadMetaConfig } from './meta-config.js';

/**
 * Meta Lead Ads webhook receiver.
 *
 * Public (Meta calls it unauthenticated), so the app-secret HMAC over the raw
 * body is the ONLY thing separating a real delivery from a forged one. It is
 * enforced, not optional -- an unverified payload is rejected with 401.
 *
 * Requires req.rawBody, populated by the express.json({ verify }) hook in
 * server.js. Signing over a re-serialised body would not match Meta's bytes.
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

    const config = await loadMetaConfig(pool);
    const expectedToken = config?.verifyToken;

    if (!expectedToken) {
      logger.warn?.('[Meta] Webhook verification attempted with no verify token configured');
      return res.status(503).send('Meta integration is not configured');
    }
    if (mode !== 'subscribe' || String(token) !== String(expectedToken)) {
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
    const config = await loadMetaConfig(pool);
    if (!config?.appSecret) {
      logger.error?.('[Meta] Webhook received but no app secret is configured');
      return res.status(503).json({ message: 'Meta integration is not configured' });
    }

    const signature = req.get('x-hub-signature-256');
    if (!verifyMetaSignature(req.rawBody, signature, config.appSecret)) {
      logger.warn?.('[Meta] Rejected webhook with invalid signature', {
        hasRawBody: Boolean(req.rawBody),
        hasSignature: Boolean(signature),
      });
      return res.status(401).json({ message: 'Invalid signature' });
    }

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

    // Sequential on purpose: bursts from one campaign usually share a branch,
    // and the per-phone advisory lock would just serialise them anyway.
    for (const job of jobs) {
      try {
        const result = await importMetaLead(pool, { ...job, intakeSource: 'webhook', config, logger });
        logger.info?.('[Meta] Webhook lead processed', {
          leadgenId: job.leadgenId,
          status: result.status,
          leadId: result.leadId ?? null,
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

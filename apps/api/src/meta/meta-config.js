import crypto from 'node:crypto';
import { encryptToken, decryptToken, getMasterKey } from '../integration-hub/crypto-utils.js';
import { unitScopeFilter, unitPreferenceOrder } from '../integration-scope.js';

/**
 * Config storage for the Meta Lead Ads integration.
 *
 * Lives in the consolidated crm_integrations table under
 * provider='meta_lead_ads'. Secrets are AES-256-GCM encrypted inside the
 * config JSON blob -- the same approach callerdesk/smartflo use, rather than
 * the plaintext dedicated columns google_sheets/smartping use.
 */

export const META_PROVIDER = 'meta_lead_ads';
// The `type` ENUM has no lead-ingest member; 'EMAIL' is the repo's existing
// catch-all (google_sheets uses it too). Everything keys off `provider`.
const META_TYPE = 'EMAIL';

const SECRET_KEYS = ['appSecret', 'systemUserToken', 'verifyToken'];

// Webhook bursts hit this on every delivery; a short TTL keeps it off the DB
// without making a settings change feel stale.
//
// Keyed by business unit, because the account is: one cache for everybody
// would hand whichever unit asked second the credentials of the unit that
// asked first. The key for "no unit" -- webhooks and the poller -- is its own
// entry rather than a shared one.
const CACHE_TTL_MS = 30000;
let cache = new Map();
const cacheKey = unitId => String(unitId || 'any');

export function invalidateMetaConfigCache() {
  cache = new Map();
}

function parseJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

/**
 * Fetch the raw integration row, newest first if somehow duplicated.
 *
 * With a business unit, its own account -- or one deliberately shared with
 * every unit -- and nothing else. Without one, the newest account of any unit:
 * Meta's webhook and the poller arrive with no unit to work from, and the app
 * secret that verifies a delivery has to be found before the payload can say
 * which unit it belongs to.
 */
export async function getMetaIntegrationRow(pool, unitId = null) {
  const unit = unitScopeFilter(unitId);
  const [[row]] = await pool.execute(
    `SELECT * FROM crm_integrations
      WHERE LOWER(COALESCE(provider,'')) = ? AND deleted_at IS NULL${unit.sql}
      ORDER BY ${unitPreferenceOrder(unitId)}id DESC LIMIT 1`,
    [META_PROVIDER, ...unit.params],
  );
  return row || null;
}

/**
 * Load and decrypt the config.
 * @returns {Promise<Object|null>} null when the integration is not set up
 */
/**
 * One row's usable config: secrets decrypted, environment values filling any
 * gap. Shared by the single-account load and the all-accounts listing, so a
 * webhook that has to try every account reads them exactly as a screen does.
 *
 * `row` may be null, which describes a .env-only setup -- credentials in the
 * environment and nothing saved yet.
 */
function hydrateConfig(row) {
  const stored = row ? parseJson(row.config, {}) : {};
  const config = row
    ? {
      ...stored,
      integrationId: Number(row.id),
      businessUnitId: row.business_unit_id == null ? null : Number(row.business_unit_id),
      status: row.status,
      name: row.name || 'Meta Lead Ads',
    }
    : { ...stored, integrationId: null, businessUnitId: null, status: 'ENV_ONLY', name: 'Meta Lead Ads' };

  let masterKey = null;
  try {
    masterKey = getMasterKey();
  } catch (error) {
    // Fail closed: without the key the secrets are unusable, and callers
    // treat a missing appSecret as "not configured".
    config.encryptionError = error.message;
  }

  if (masterKey) {
    for (const key of SECRET_KEYS) {
      const encrypted = stored[`${key}Encrypted`];
      delete config[`${key}Encrypted`];
      if (!encrypted) continue;
      try {
        config[key] = decryptToken(encrypted, masterKey);
      } catch {
        config[key] = null;
        config.encryptionError = `Could not decrypt ${key}; re-save the Meta credentials`;
      }
    }
  }

  // Environment fallbacks, so an existing .env-based setup works before
  // anything has been entered in the UI. Stored values always win.
  config.appId = config.appId || process.env.META_APP_ID || null;
  config.appSecret = config.appSecret || process.env.META_APP_SECRET || null;
  config.systemUserToken = config.systemUserToken || process.env.META_SYSTEM_USER_TOKEN || null;
  config.verifyToken = config.verifyToken || process.env.META_VERIFY_TOKEN || null;
  return config;
}

export async function loadMetaConfig(pool, { useCache = true, unitId = null } = {}) {
  const key = cacheKey(unitId);
  const cached = cache.get(key);
  if (useCache && cached && cached.expiresAt > Date.now()) return cached.value;

  const row = await getMetaIntegrationRow(pool, unitId);

  // No row yet is still usable if the credentials are in the environment --
  // otherwise a .env-only setup could never answer Meta's first webhook.
  if (!row && !process.env.META_APP_SECRET && !process.env.META_SYSTEM_USER_TOKEN) {
    return null;
  }

  const config = hydrateConfig(row);
  cache.set(key, { value: config, expiresAt: Date.now() + CACHE_TTL_MS });
  return config;
}

/**
 * Every Meta account, newest first.
 *
 * For the paths that cannot name a business unit before they have looked at
 * the account: the webhook has to find the account whose app secret signed a
 * delivery, and the poller has to work every account's forms rather than the
 * one belonging to whichever unit saved last. Each entry carries its
 * integrationId and businessUnitId, so the caller knows which unit it is
 * acting for.
 *
 * A .env-only setup yields the single environment account, matching what
 * loadMetaConfig has always returned for it.
 */
export async function listMetaConfigs(pool) {
  const [rows] = await pool.execute(
    `SELECT * FROM crm_integrations
      WHERE LOWER(COALESCE(provider,'')) = ? AND deleted_at IS NULL
      ORDER BY id DESC`,
    [META_PROVIDER],
  );
  if (!rows.length) {
    if (!process.env.META_APP_SECRET && !process.env.META_SYSTEM_USER_TOKEN) return [];
    return [hydrateConfig(null)];
  }
  return rows.map(hydrateConfig);
}

/** One named account, whichever unit it belongs to. */
export async function loadMetaConfigForIntegration(pool, integrationId) {
  const id = Number(integrationId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [[row]] = await pool.execute(
    `SELECT * FROM crm_integrations WHERE id=? AND LOWER(COALESCE(provider,'')) = ? AND deleted_at IS NULL LIMIT 1`,
    [id, META_PROVIDER],
  );
  return row ? hydrateConfig(row) : null;
}

/**
 * Create or update the integration row.
 *
 * Secrets are only rewritten when a new value is supplied, so the UI can
 * round-trip a redacted config without wiping credentials.
 */
export async function saveMetaConfig(pool, updates = {}, { organizationId = 1, userId = null, unitId = null } = {}) {
  const row = await getMetaIntegrationRow(pool, unitId);
  const existing = row ? parseJson(row.config, {}) : {};
  const masterKey = getMasterKey();

  const next = { ...existing };

  for (const key of SECRET_KEYS) {
    const incoming = updates[key];
    if (incoming === undefined || incoming === null) continue;
    const text = String(incoming).trim();
    if (!text || text === '••••••••') continue; // redacted placeholder from the UI
    next[`${key}Encrypted`] = encryptToken(text, masterKey);
    delete next[key];
  }

  // Non-secret settings pass through verbatim.
  const plainKeys = [
    'appId', 'defaultBusinessUnitId', 'defaultBranchId', 'defaultSourceId',
    'defaultChannelId', 'defaultCampaignId', 'defaultStageId',
    'defaultOwnerEmployeeId', 'defaultAcademicYear', 'actorUserId', 'autoSubscribePages',
  ];
  for (const key of plainKeys) {
    if (updates[key] !== undefined) next[key] = updates[key];
  }

  // Generated once, then shown to the user to paste into the Meta App dashboard.
  if (!next.verifyTokenEncrypted && !updates.verifyToken) {
    next.verifyTokenEncrypted = encryptToken(crypto.randomBytes(24).toString('hex'), masterKey);
  }

  const configJson = JSON.stringify(next);

  if (row) {
    await pool.execute(
      `UPDATE crm_integrations
          SET config=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?`,
      [configJson, userId, row.id],
    );
  } else {
    await pool.execute(
      `INSERT INTO crm_integrations
         (organization_id, business_unit_id, name, type, provider, config, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [organizationId, unitId, 'Meta Lead Ads', META_TYPE, META_PROVIDER, configJson, userId],
    );
  }

  invalidateMetaConfigCache();
  return loadMetaConfig(pool, { useCache: false, unitId });
}

/*
 * Reflect the live connection back onto the integration row.
 *
 * The Meta screens keep their own state -- the token in `config`, the pages
 * and forms in their own tables -- and used to leave `crm_integrations.status`
 * exactly as it was found. A row created through the Integration Hub starts
 * INACTIVE, so a fully working Meta connection still showed as not connected
 * on the Integrations tile, with "Last sync: Never" beside it.
 *
 * Only ever called with a fact: a token Meta has just accepted or rejected,
 * or a poll cycle that has just completed.
 */
export async function markMetaIntegrationState(pool, { connected, synced = false, integrationId = null, unitId = null, logger = console } = {}) {
  try {
    /* Whichever account the fact is about: a poll cycle reports the account
       whose forms it just read, and a token test the account of the unit that
       pressed the button. Without either it falls back to the newest, which
       is what this did when there could only be one. */
    const row = integrationId
      ? (await pool.execute(`SELECT id FROM crm_integrations WHERE id=? AND deleted_at IS NULL LIMIT 1`, [Number(integrationId)]))[0][0]
      : await getMetaIntegrationRow(pool, unitId);
    if (!row) return;
    const status = connected ? 'CONNECTED' : 'ERROR';
    await pool.execute(
      `UPDATE crm_integrations
          SET status=?,
              connected_at=COALESCE(connected_at, IF(?, CURRENT_TIMESTAMP, NULL)),
              last_sync_at=IF(?, CURRENT_TIMESTAMP, last_sync_at),
              updated_at=CURRENT_TIMESTAMP
        WHERE id=?`,
      [status, connected ? 1 : 0, synced ? 1 : 0, row.id],
    );
  } catch (error) {
    // Cosmetic: never let the tile's bookkeeping break a token test or a poll.
    logger.warn?.(`[Meta] could not update integration status: ${error.message}`);
  }
}

/** Strip secrets before sending config to the browser. */
export function redactMetaConfig(config) {
  if (!config) return null;
  const safe = { ...config };
  for (const key of SECRET_KEYS) {
    if (key === 'verifyToken') continue; // the user must be able to copy this one
    safe[key] = config[key] ? '••••••••' : null;
    safe[`has${key[0].toUpperCase()}${key.slice(1)}`] = Boolean(config[key]);
  }
  return safe;
}

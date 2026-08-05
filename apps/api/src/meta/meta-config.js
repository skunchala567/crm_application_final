import crypto from 'node:crypto';
import { encryptToken, decryptToken, getMasterKey } from '../integration-hub/crypto-utils.js';

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
const CACHE_TTL_MS = 30000;
let cache = { value: null, expiresAt: 0 };

export function invalidateMetaConfigCache() {
  cache = { value: null, expiresAt: 0 };
}

function parseJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

/** Fetch the raw integration row, newest first if somehow duplicated. */
export async function getMetaIntegrationRow(pool) {
  const [[row]] = await pool.execute(
    `SELECT * FROM crm_integrations
      WHERE LOWER(COALESCE(provider,'')) = ? AND deleted_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [META_PROVIDER],
  );
  return row || null;
}

/**
 * Load and decrypt the config.
 * @returns {Promise<Object|null>} null when the integration is not set up
 */
export async function loadMetaConfig(pool, { useCache = true } = {}) {
  if (useCache && cache.value && cache.expiresAt > Date.now()) return cache.value;

  const row = await getMetaIntegrationRow(pool);
  const stored = row ? parseJson(row.config, {}) : {};

  // No row yet is still usable if the credentials are in the environment --
  // otherwise a .env-only setup could never answer Meta's first webhook.
  if (!row && !process.env.META_APP_SECRET && !process.env.META_SYSTEM_USER_TOKEN) {
    return null;
  }

  const config = row
    ? { ...stored, integrationId: Number(row.id), status: row.status }
    : { ...stored, integrationId: null, status: 'ENV_ONLY' };

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

  cache = { value: config, expiresAt: Date.now() + CACHE_TTL_MS };
  return config;
}

/**
 * Create or update the integration row.
 *
 * Secrets are only rewritten when a new value is supplied, so the UI can
 * round-trip a redacted config without wiping credentials.
 */
export async function saveMetaConfig(pool, updates = {}, { organizationId = 1, userId = null } = {}) {
  const row = await getMetaIntegrationRow(pool);
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
         (organization_id, name, type, provider, config, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [organizationId, 'Meta Lead Ads', META_TYPE, META_PROVIDER, configJson, userId],
    );
  }

  invalidateMetaConfigCache();
  return loadMetaConfig(pool, { useCache: false });
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

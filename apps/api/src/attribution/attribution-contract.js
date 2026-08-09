/**
 * The attribution contract: the one agreed shape for "where did this lead
 * come from", used identically by the website, the mobile application and
 * every server-side intake path.
 *
 * This file is the authority. The browser capture script
 * (apps/web/public/crm-attribution.js) restates the same field names because
 * it has to run unbundled on sites we do not build; scripts/check-attribution
 * -contract.js fails the build if the two ever drift apart.
 *
 * Two rules make the rest of the system replaceable:
 *
 *   1. No field is named after a platform. A click identifier is the pair
 *      (clickIdType, clickId), never a column called `gclid`. Adding
 *      Microsoft Ads is a row in crm_attribution_platforms, not a migration.
 *   2. Translation to a platform's own vocabulary happens at the point of
 *      sending, not at capture and not in storage.
 */

/**
 * Every field the contract carries. Order is meaningful only for humans
 * reading the table; the drift check compares as a set.
 */
export const ATTRIBUTION_FIELDS = [
  'origin',
  'clickIdType',
  'clickId',
  'campaignSource',
  'campaignMedium',
  'campaignName',
  'campaignTerm',
  'campaignContent',
  'platformCampaignId',
  'platformAdgroupId',
  'platformAdId',
  'platformLeadId',
  'landingUrl',
  'referrerUrl',
  'deviceType',
  'capturedAt',
];

/** Where a lead physically entered the system. */
export const ORIGINS = [
  'website', 'mobile_app', 'meta_lead_ads', 'google_lead_form',
  'import', 'manual', 'other',
];

/**
 * UTM parameter -> our field name. The only place the platforms' names for
 * these appear.
 */
export const UTM_PARAM_MAP = {
  utm_source: 'campaignSource',
  utm_medium: 'campaignMedium',
  utm_campaign: 'campaignName',
  utm_term: 'campaignTerm',
  utm_content: 'campaignContent',
};

/** Longest value we will store per field, matching the column widths. */
const LIMITS = {
  origin: 40,
  clickIdType: 40,
  clickId: 512,
  campaignSource: 180,
  campaignMedium: 180,
  campaignName: 255,
  campaignTerm: 255,
  campaignContent: 255,
  platformCampaignId: 64,
  platformAdgroupId: 64,
  platformAdId: 64,
  platformLeadId: 64,
  landingUrl: 1000,
  referrerUrl: 1000,
  deviceType: 20,
};

const trim = (value, max) => {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
};

/**
 * Platform configuration, cached briefly. A short TTL rather than a manual
 * invalidation because the table changes about once a year and a stale
 * minute costs nothing.
 */
let platformCache = { at: 0, rows: [] };
const PLATFORM_TTL_MS = 60_000;

export async function loadAttributionPlatforms(pool, { fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && platformCache.rows.length && now - platformCache.at < PLATFORM_TTL_MS) {
    return platformCache.rows;
  }
  const [rows] = await pool.execute(
    `SELECT param_name, platform_code, click_id_type, channel_group, priority
       FROM crm_attribution_platforms
      WHERE is_active = TRUE
      ORDER BY priority ASC, id ASC`,
  );
  platformCache = { at: now, rows };
  return rows;
}

/**
 * Pick the click identifier out of whatever the visitor arrived with.
 *
 * A landing URL can carry several at once -- Google sends gclid and gbraid
 * together on some iOS traffic -- so the configured priority decides, and
 * the losers stay in raw_json rather than being thrown away.
 */
export function classifyClickId(params, platforms) {
  if (!params || typeof params !== 'object') return null;
  const lower = {};
  for (const [key, value] of Object.entries(params)) {
    if (value != null && String(value).trim()) lower[key.toLowerCase()] = String(value).trim();
  }
  for (const platform of platforms) {
    const value = lower[String(platform.param_name).toLowerCase()];
    if (value) {
      return {
        platformCode: platform.platform_code,
        channelGroup: platform.channel_group,
        clickIdType: platform.click_id_type,
        clickId: value.slice(0, LIMITS.clickId),
      };
    }
  }
  return null;
}

/**
 * Coerce anything an intake path hands us into the contract's shape.
 *
 * Accepts both our own field names and the raw platform parameter names, so
 * a caller can pass a parsed query string straight in. Unknown keys are
 * dropped from the typed fields but survive in raw_json.
 */
export function normalizeAttribution(input = {}, platforms = []) {
  const source = input && typeof input === 'object' ? input : {};

  // Accept either shape for the UTMs.
  const utm = {};
  for (const [param, field] of Object.entries(UTM_PARAM_MAP)) {
    utm[field] = source[field] ?? source[param] ?? null;
  }

  const classified = classifyClickId(source, platforms) || {};

  const origin = ORIGINS.includes(String(source.origin)) ? String(source.origin) : 'website';

  return {
    origin,
    platformCode: trim(source.platformCode ?? classified.platformCode, 60),
    channelGroup: trim(source.channelGroup ?? classified.channelGroup, 40),
    clickIdType: trim(source.clickIdType ?? classified.clickIdType, LIMITS.clickIdType),
    clickId: trim(source.clickId ?? classified.clickId, LIMITS.clickId),

    campaignSource: trim(utm.campaignSource, LIMITS.campaignSource),
    campaignMedium: trim(utm.campaignMedium, LIMITS.campaignMedium),
    campaignName: trim(utm.campaignName, LIMITS.campaignName),
    campaignTerm: trim(utm.campaignTerm, LIMITS.campaignTerm),
    campaignContent: trim(utm.campaignContent, LIMITS.campaignContent),

    platformCampaignId: trim(source.platformCampaignId, LIMITS.platformCampaignId),
    platformAdgroupId: trim(source.platformAdgroupId, LIMITS.platformAdgroupId),
    platformAdId: trim(source.platformAdId, LIMITS.platformAdId),
    platformLeadId: trim(source.platformLeadId, LIMITS.platformLeadId),

    landingUrl: trim(source.landingUrl, LIMITS.landingUrl),
    referrerUrl: trim(source.referrerUrl, LIMITS.referrerUrl),
    deviceType: trim(source.deviceType, LIMITS.deviceType),
    capturedAt: parseCapturedAt(source.capturedAt),
  };
}

/**
 * Client clocks are not trustworthy; reject anything absurd rather than store it.
 *
 * Accepts a number as a Unix timestamp because Meta reports created_time that
 * way, in seconds -- passing it to `new Date` unconverted would land in 1970
 * and be silently discarded by the sanity window below.
 */
function parseCapturedAt(value) {
  if (!value) return null;
  const numeric = typeof value === 'number' ? value : null;
  const date = numeric !== null
    ? new Date(numeric < 1e11 ? numeric * 1000 : numeric)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const skewMs = 48 * 60 * 60 * 1000;
  if (date.getTime() > Date.now() + skewMs) return null;
  if (date.getTime() < Date.now() - 365 * 24 * 60 * 60 * 1000) return null;
  return date;
}

/** True when there is anything worth recording. */
export function hasAnyAttribution(normalized) {
  if (!normalized) return false;
  return Boolean(
    normalized.clickId
    || normalized.campaignSource
    || normalized.campaignName
    || normalized.platformAdId
    || normalized.platformLeadId
    || normalized.platformCampaignId,
  );
}

/**
 * Store one touch against a lead.
 *
 * Touch 1 is the first advertisement that brought this person in and is
 * never overwritten; a later arrival from a different advertisement is
 * appended. Two submissions racing for the same touch number collide on the
 * unique key, so the loser retries with the next number instead of
 * overwriting the winner.
 *
 * Returns the touch number written, or null when there was nothing to write.
 * Never throws: a lead is worth more than its attribution, and the scope
 * document requires a lead with no tracking to be accepted regardless.
 */
export async function recordLeadAttribution(pool, leadId, rawInput, { origin, logger = console } = {}) {
  const id = Number(leadId);
  if (!Number.isInteger(id) || id <= 0) return null;

  try {
    const platforms = await loadAttributionPlatforms(pool);
    const data = normalizeAttribution({ ...(rawInput || {}), origin: origin ?? rawInput?.origin }, platforms);
    if (!hasAnyAttribution(data)) return null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [[row]] = await pool.execute(
        'SELECT COALESCE(MAX(touch_number), 0) AS maxTouch FROM crm_lead_attribution WHERE lead_id = ?',
        [id],
      );
      const touchNumber = Number(row?.maxTouch || 0) + 1;

      // Identical repeat submissions should not pile up touches.
      if (touchNumber > 1) {
        const [[dupe]] = await pool.execute(
          `SELECT id FROM crm_lead_attribution
            WHERE lead_id = ?
              AND COALESCE(click_id,'')      = COALESCE(?, '')
              AND COALESCE(campaign_name,'') = COALESCE(?, '')
              AND COALESCE(campaign_source,'') = COALESCE(?, '')
            LIMIT 1`,
          [id, data.clickId, data.campaignName, data.campaignSource],
        );
        if (dupe) return null;
      }

      try {
        await pool.execute(
          `INSERT INTO crm_lead_attribution
             (lead_id, touch_number, origin, platform_code, channel_group,
              click_id_type, click_id, campaign_source, campaign_medium,
              campaign_name, campaign_term, campaign_content,
              platform_campaign_id, platform_adgroup_id, platform_ad_id, platform_lead_id,
              landing_url, referrer_url, device_type, captured_at_utc, raw_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id, touchNumber, data.origin, data.platformCode, data.channelGroup,
            data.clickIdType, data.clickId, data.campaignSource, data.campaignMedium,
            data.campaignName, data.campaignTerm, data.campaignContent,
            data.platformCampaignId, data.platformAdgroupId, data.platformAdId, data.platformLeadId,
            data.landingUrl, data.referrerUrl, data.deviceType, data.capturedAt,
            JSON.stringify(rawInput ?? {}),
          ],
        );
        return touchNumber;
      } catch (error) {
        // Someone else took this touch number; recount and try the next.
        if (error?.code === 'ER_DUP_ENTRY') continue;
        throw error;
      }
    }
    return null;
  } catch (error) {
    logger?.warn?.(`[attribution] could not record touch for lead ${id}: ${error.message}`);
    return null;
  }
}

/** First touch for a lead -- the one conversion feedback should be sent against. */
export async function firstTouchForLead(pool, leadId) {
  const [[row]] = await pool.execute(
    `SELECT * FROM crm_lead_attribution WHERE lead_id = ? ORDER BY touch_number ASC LIMIT 1`,
    [Number(leadId)],
  );
  return row || null;
}

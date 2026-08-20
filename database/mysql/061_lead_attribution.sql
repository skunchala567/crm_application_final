SET NAMES utf8mb4;

-- =====================================================================
-- Lead attribution: which advertisement produced which lead.
--
-- Today the only attribution we keep is a `websiteAttribution` blob inside
-- crm_leads.custom_values_json. It has no schema, cannot be indexed, and
-- names its fields after the platforms it came from. Of 278 leads, 5 carry
-- the blob and none carry a usable click identifier -- so no lead in the
-- system can currently be matched back to an ad click.
--
-- Two tables:
--   crm_attribution_platforms  - configuration. Which URL parameter belongs
--                                to which platform. Adding a platform is a
--                                row here, not a code change.
--   crm_lead_attribution       - one row per touch, many touches per lead.
--                                Touch 1 is the first ad that brought them;
--                                later touches are recorded alongside it and
--                                never overwrite it.
--
-- Field names here are OURS. No column is called gclid or fbclid: a click
-- identifier is (click_id_type, click_id), so a new platform needs no new
-- column and the translation to each platform's own vocabulary happens at
-- the point of sending.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configuration: the URL parameters worth capturing.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_attribution_platforms (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- The query-string parameter as the platform writes it, e.g. 'gclid'.
  param_name      VARCHAR(60)  NOT NULL,
  -- Our name for the platform, used everywhere in the application.
  platform_code   VARCHAR(60)  NOT NULL,
  platform_label  VARCHAR(120) NOT NULL,
  -- Our name for this kind of identifier. Stored on the lead as
  -- click_id_type so nothing downstream needs to know the parameter name.
  click_id_type   VARCHAR(40)  NOT NULL,
  -- Coarse bucket for reporting: paid_search, paid_social, display, other.
  channel_group   VARCHAR(40)  NOT NULL DEFAULT 'other',
  -- Lower wins when a landing URL carries more than one identifier, which
  -- happens on Google iOS traffic (gclid alongside gbraid/wbraid).
  priority        INT          NOT NULL DEFAULT 100,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  notes           VARCHAR(255) NULL,
  created_at_utc  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_attribution_param (param_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seeded from the scope document. INSERT IGNORE so re-running never
-- clobbers a priority or label an administrator has since adjusted.
INSERT IGNORE INTO crm_attribution_platforms
  (param_name, platform_code, platform_label, click_id_type, channel_group, priority, notes) VALUES
  ('gclid',   'google_ads',    'Google Ads',            'gclid',        'paid_search', 10, 'Standard Google Ads click'),
  ('gbraid',  'google_ads',    'Google Ads',            'gbraid',       'paid_search', 20, 'iOS app-to-web, replaces gclid'),
  ('wbraid',  'google_ads',    'Google Ads',            'wbraid',       'paid_search', 21, 'iOS web-to-web, replaces gclid'),
  ('dclid',   'google_dv360',  'Google Display & Video','dclid',        'display',     30, 'Display and video click'),
  ('fbclid',  'meta',          'Meta',                  'fbclid',       'paid_social', 40, 'Facebook and Instagram click'),
  ('msclkid', 'microsoft_ads', 'Microsoft Ads',         'msclkid',      'paid_search', 50, 'Bing click'),
  ('ttclid',  'tiktok_ads',    'TikTok Ads',            'ttclid',       'paid_social', 60, 'Not in the original scope; inactive by default'),
  ('li_fat_id','linkedin_ads', 'LinkedIn Ads',          'li_fat_id',    'paid_social', 70, 'Not in the original scope; inactive by default');

-- The two beyond the scope document are seeded for convenience but off, so
-- turning them on later is a settings change rather than a deployment.
UPDATE crm_attribution_platforms SET is_active = FALSE
 WHERE param_name IN ('ttclid','li_fat_id') AND notes LIKE 'Not in the original scope%';

-- ---------------------------------------------------------------------
-- Data: one row per touch.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_lead_attribution (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id              BIGINT UNSIGNED NOT NULL,
  -- 1 is the first touch and is never overwritten. Later arrivals from a
  -- different advertisement are appended as 2, 3, ... per the scope doc.
  touch_number         INT UNSIGNED NOT NULL DEFAULT 1,

  -- Where the lead physically came in, in our vocabulary.
  origin               VARCHAR(40)  NOT NULL DEFAULT 'website',

  -- Resolved from crm_attribution_platforms at capture time.
  platform_code        VARCHAR(60)  NULL,
  channel_group        VARCHAR(40)  NULL,
  click_id_type        VARCHAR(40)  NULL,
  -- Google click identifiers run long; 512 leaves generous headroom.
  click_id             VARCHAR(512) NULL,

  -- UTM parameters, under our own names.
  campaign_source      VARCHAR(180) NULL,
  campaign_medium      VARCHAR(180) NULL,
  campaign_name        VARCHAR(255) NULL,
  campaign_term        VARCHAR(255) NULL,
  campaign_content     VARCHAR(255) NULL,

  -- Platform-side ids where the platform hands them to us directly, as
  -- Meta Lead Ads does. Strings, because they are opaque references.
  platform_campaign_id VARCHAR(64)  NULL,
  platform_adgroup_id  VARCHAR(64)  NULL,
  platform_ad_id       VARCHAR(64)  NULL,
  -- Meta's own lead reference, when the lead came from their hosted form.
  platform_lead_id     VARCHAR(64)  NULL,

  landing_url          VARCHAR(1000) NULL,
  referrer_url         VARCHAR(1000) NULL,
  device_type          VARCHAR(20)  NULL,

  -- When the visitor actually landed, as reported by the capture script.
  captured_at_utc      DATETIME(6)  NULL,
  -- When we stored it. Always trustworthy; captured_at_utc is client-supplied.
  received_at_utc      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

  -- Everything the capture sent, kept for auditing a disputed attribution.
  raw_json             JSON         NULL,

  created_at_utc       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),

  PRIMARY KEY (id),
  -- Makes "record the later ones separately" safe under concurrent submits.
  UNIQUE KEY uq_lead_touch (lead_id, touch_number),
  -- Conversion feedback starts from a click id, so this is the hot path.
  KEY ix_attr_click (click_id_type, click_id(191)),
  KEY ix_attr_platform_time (platform_code, received_at_utc),
  KEY ix_attr_campaign (campaign_name),
  KEY ix_attr_lead (lead_id),
  CONSTRAINT fk_lead_attribution_lead FOREIGN KEY (lead_id)
    REFERENCES crm_leads (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

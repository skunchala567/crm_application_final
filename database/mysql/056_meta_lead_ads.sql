USE attendance_biometric;
SET NAMES utf8mb4;

-- =====================================================================
-- Meta (Facebook/Instagram) Lead Ads integration
-- Pages -> Lead Forms -> Leads, with an idempotency ledger keyed on
-- Meta's leadgen_id so webhook retries can never double-import a lead.
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

-- Connected Facebook Pages. One row per Page the system user can manage.
CREATE TABLE IF NOT EXISTS crm_meta_pages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  integration_id INT NOT NULL,
  page_id VARCHAR(64) NOT NULL,
  page_name VARCHAR(255) NULL,
  -- Page access token, AES-256-GCM via INTEGRATION_MASTER_KEY. Never plaintext.
  access_token_encrypted TEXT NULL,
  is_subscribed BOOLEAN NOT NULL DEFAULT FALSE,
  subscribed_at_utc DATETIME(6) NULL,
  subscribe_error TEXT NULL,
  -- Routing defaults inherited by this Page's forms when the form has none.
  business_unit_id BIGINT UNSIGNED NULL,
  branch_id BIGINT UNSIGNED NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_meta_pages_page (page_id),
  KEY ix_crm_meta_pages_integration (integration_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lead forms belonging to a Page, with per-form field mapping and routing.
CREATE TABLE IF NOT EXISTS crm_meta_forms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  page_id VARCHAR(64) NOT NULL,
  form_id VARCHAR(64) NOT NULL,
  form_name VARCHAR(255) NULL,
  form_status VARCHAR(40) NULL,
  -- { "<meta_field_name>": "<crm_field>" }; empty object = auto-detect.
  field_mapping JSON NULL,
  -- Routing overrides. NULL falls back to the Page, then integration config.
  business_unit_id BIGINT UNSIGNED NULL,
  branch_id BIGINT UNSIGNED NULL,
  source_id BIGINT UNSIGNED NULL,
  channel_id BIGINT UNSIGNED NULL,
  campaign_id BIGINT UNSIGNED NULL,
  stage_id BIGINT UNSIGNED NULL,
  substage_id BIGINT UNSIGNED NULL,
  owner_employee_id BIGINT NULL,
  academic_year VARCHAR(20) NULL,
  class_id BIGINT UNSIGNED NULL,
  curriculum_id BIGINT UNSIGNED NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  -- Watermark for incremental backfill (Meta created_time, epoch seconds).
  last_backfill_time BIGINT UNSIGNED NULL,
  last_synced_at_utc DATETIME(6) NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_meta_forms_form (form_id),
  KEY ix_crm_meta_forms_page (page_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Idempotency ledger. The UNIQUE on leadgen_id is what makes webhook
-- redelivery and backfill overlap safe -- insert first, import second.
CREATE TABLE IF NOT EXISTS crm_meta_lead_imports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  leadgen_id VARCHAR(64) NOT NULL,
  form_id VARCHAR(64) NULL,
  page_id VARCHAR(64) NULL,
  ad_id VARCHAR(64) NULL,
  adgroup_id VARCHAR(64) NULL,
  campaign_meta_id VARCHAR(64) NULL,
  lead_id BIGINT UNSIGNED NULL,
  -- pending: claimed, not yet processed. Terminal: imported/duplicate/failed/skipped.
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  intake_source VARCHAR(20) NOT NULL DEFAULT 'webhook',
  error_message TEXT NULL,
  raw_payload JSON NULL,
  attempts INT NOT NULL DEFAULT 0,
  meta_created_time BIGINT UNSIGNED NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_meta_lead_imports_leadgen (leadgen_id),
  KEY ix_crm_meta_lead_imports_form (form_id, created_at_utc),
  KEY ix_crm_meta_lead_imports_status (status),
  KEY ix_crm_meta_lead_imports_lead (lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Link the seeded 'meta_ads' source to the 'social' channel.
-- validateSourceDetails() resolves source->channel through
-- crm_lead_source_history, which is empty for a brand-new source, so the
-- direct column link is what lets the first Meta lead through.
-- ---------------------------------------------------------------------
SET @has_source_channel = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'crm_lead_sources'
    AND column_name = 'channel_id'
);

SET @sql = IF(@has_source_channel > 0,
  'UPDATE crm_lead_sources s
     JOIN crm_lead_channels c ON c.channel_code = ''social''
      SET s.channel_id = c.id
    WHERE s.name = ''meta_ads'' AND s.channel_id IS NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

-- A campaign row for Meta traffic. crm_lead_source_history.campaign_id is
-- NOT NULL, so without this the re-enquiry path for a returning phone
-- number cannot record the new source and would have to skip the lead.
INSERT INTO crm_campaigns (campaign_code, display_name, category, is_active)
VALUES ('meta_ads', 'Meta Ads', 'Digital', TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), is_active = TRUE;

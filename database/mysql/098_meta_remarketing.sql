SET NAMES utf8mb4;

-- =====================================================================
-- Meta Remarketing: CRM leads as Meta Custom Audiences.
--
-- Built on the existing Meta Lead Ads integration rather than beside it --
-- the same crm_integrations row holds the credentials, and the same
-- crm_meta_pages/crm_meta_forms rows say which page and form a lead came
-- from. Nothing here changes how leads are fetched.
--
-- Five additions:
--   crm_meta_ad_accounts          the ad accounts an audience can live in
--   crm_remarketing_audiences     the audience definition and its Meta id
--   crm_remarketing_audience_members  which leads are in it, and their state
--   crm_remarketing_sync_logs     what each sync did, for the history tab
--   plus the columns a Meta customer-data match needs, and the campaign
--   names Meta sends that the CRM was discarding.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Lead columns a Meta Custom Audience can match on.
--
-- Meta matches on email, phone, name, city, state, country and postcode.
-- crm_leads carried the first four; a lead could therefore only ever be
-- matched on half of what Meta accepts, which lowers the match rate.
-- ---------------------------------------------------------------------
SET @has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_leads' AND column_name='state');
SET @ddl = IF(@has=0, 'ALTER TABLE crm_leads ADD COLUMN state VARCHAR(100) NULL AFTER city', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_leads' AND column_name='country');
SET @ddl = IF(@has=0, "ALTER TABLE crm_leads ADD COLUMN country VARCHAR(100) NULL DEFAULT 'India' AFTER state", 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_leads' AND column_name='postal_code');
SET @ddl = IF(@has=0, 'ALTER TABLE crm_leads ADD COLUMN postal_code VARCHAR(20) NULL AFTER country', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------
-- 2. The campaign names Meta sends with a lead.
--
-- crm_meta_lead_imports already stored campaign, adgroup and ad IDs. The
-- names were dropped, so "which campaign produced this lead" could only be
-- answered as an opaque number -- and an audience filtered by campaign has
-- to be readable to be chosen.
-- ---------------------------------------------------------------------
SET @has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_meta_lead_imports' AND column_name='campaign_name');
SET @ddl = IF(@has=0,
  'ALTER TABLE crm_meta_lead_imports
     ADD COLUMN campaign_name VARCHAR(255) NULL AFTER campaign_meta_id,
     ADD COLUMN adgroup_name VARCHAR(255) NULL AFTER campaign_name,
     ADD COLUMN ad_name VARCHAR(255) NULL AFTER adgroup_name,
     ADD COLUMN form_name VARCHAR(255) NULL AFTER ad_name,
     ADD COLUMN page_name VARCHAR(255) NULL AFTER form_name',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Filtered on when building an audience by Meta campaign or ad set.
SET @has = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='crm_meta_lead_imports' AND index_name='ix_meta_import_lead');
SET @ddl = IF(@has=0, 'ALTER TABLE crm_meta_lead_imports ADD INDEX ix_meta_import_lead (lead_id)', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------
-- 3. Ad accounts, discovered from the connected Meta account.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_meta_ad_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  integration_id INT NULL,
  business_unit_id BIGINT UNSIGNED NULL,
  -- Meta's own identifiers: act_123456 and the bare 123456.
  ad_account_id VARCHAR(64) NOT NULL,
  account_id VARCHAR(64) NULL,
  name VARCHAR(255) NULL,
  currency VARCHAR(10) NULL,
  account_status VARCHAR(40) NULL,
  business_name VARCHAR(255) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_synced_at_utc DATETIME(6) NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_meta_ad_account (ad_account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 4. The audience itself.
--
-- filters_json holds the same filter shape the Leads screen produces, so a
-- CRM user builds an audience with the vocabulary they already use. The
-- membership is not derived from it on the fly -- it is materialised into
-- crm_remarketing_audience_members, because a sync has to know what it sent
-- last time to work out what changed.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_remarketing_audiences (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(200) NOT NULL,
  description VARCHAR(1000) NULL,
  ad_account_id VARCHAR(64) NOT NULL,
  -- 'crm_leads' today; the column exists so a later source (customers,
  -- payments) does not need a schema change.
  source VARCHAR(40) NOT NULL DEFAULT 'crm_leads',
  filters_json JSON NULL,
  exclude_filters_json JSON NULL,
  -- NULL until Meta accepts the audience; that is what makes a CRM audience
  -- distinguishable from one that exists on both sides.
  meta_audience_id VARCHAR(64) NULL,
  meta_audience_name VARCHAR(255) NULL,
  sync_type ENUM('manual','automatic') NOT NULL DEFAULT 'manual',
  sync_interval ENUM('daily','every_6_hours','every_12_hours','weekly') NULL,
  status ENUM('draft','active','paused','error','deleted') NOT NULL DEFAULT 'draft',
  last_sync_at_utc DATETIME(6) NULL,
  next_sync_at_utc DATETIME(6) NULL,
  last_error VARCHAR(1000) NULL,
  crm_lead_count INT UNSIGNED NOT NULL DEFAULT 0,
  synced_lead_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_audience_unit (business_unit_id, status),
  -- The scheduler's claim query: what is due, soonest first.
  KEY ix_audience_due (sync_type, status, next_sync_at_utc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 5. Who is in the audience, and what Meta has been told about them.
--
-- One row per lead per audience. 'pending' is in the CRM set but not yet
-- sent; 'synced' has been uploaded; 'removing' has dropped out of the
-- filters and needs deleting at Meta; 'removed' has been deleted there.
-- Keeping removed rows is what lets a later re-match avoid re-uploading
-- somebody Meta already holds.
--
-- No personal data here -- only the lead id. The hashes are computed at
-- send time and never stored, so this table cannot leak a customer list.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_remarketing_audience_members (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  audience_id BIGINT UNSIGNED NOT NULL,
  lead_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending','synced','removing','removed','failed','ineligible') NOT NULL DEFAULT 'pending',
  -- Which identifiers this lead could actually offer Meta, for the
  -- eligibility count shown before a sync.
  match_keys VARCHAR(120) NULL,
  error_message VARCHAR(500) NULL,
  first_synced_at_utc DATETIME(6) NULL,
  last_synced_at_utc DATETIME(6) NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_audience_lead (audience_id, lead_id),
  KEY ix_member_state (audience_id, status),
  KEY ix_member_lead (lead_id),
  CONSTRAINT fk_member_audience FOREIGN KEY (audience_id) REFERENCES crm_remarketing_audiences(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 6. What each sync did.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_remarketing_sync_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  audience_id BIGINT UNSIGNED NOT NULL,
  meta_audience_id VARCHAR(64) NULL,
  action VARCHAR(40) NOT NULL DEFAULT 'sync',
  status ENUM('running','completed','failed','partial') NOT NULL DEFAULT 'running',
  started_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  completed_at_utc DATETIME(6) NULL,
  leads_considered INT UNSIGNED NOT NULL DEFAULT 0,
  leads_added INT UNSIGNED NOT NULL DEFAULT 0,
  leads_removed INT UNSIGNED NOT NULL DEFAULT 0,
  leads_failed INT UNSIGNED NOT NULL DEFAULT 0,
  leads_skipped INT UNSIGNED NOT NULL DEFAULT 0,
  -- Meta's own answer, kept verbatim for support questions. Requests are
  -- never logged: they carry the hashed customer list.
  meta_response JSON NULL,
  error_message VARCHAR(1000) NULL,
  triggered_by VARCHAR(40) NOT NULL DEFAULT 'manual',
  triggered_by_user_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY ix_sync_audience (audience_id, started_at_utc),
  CONSTRAINT fk_sync_audience FOREIGN KEY (audience_id) REFERENCES crm_remarketing_audiences(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

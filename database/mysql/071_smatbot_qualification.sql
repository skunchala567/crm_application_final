SET NAMES utf8mb4;

-- =====================================================================
-- AI voice lead qualification write-back (SmatBot).
--
-- Two tables:
--   crm_partner_api_keys   how a partner authenticates. SmatBot is a server
--                          calling us unattended, so it cannot hold a user
--                          JWT: those expire, belong to a person, and carry
--                          that person's branch scope. A key is issued per
--                          partner per business unit and can be revoked on
--                          its own without touching anyone's login.
--   crm_lead_qualifications one row per lead per phase, holding what the AI
--                          call concluded.
--
-- On the fitment columns: the specification is written for real estate --
-- budget, size, "2BHK or 3BHK" configuration and location -- which means
-- nothing for school admissions. Rather than create four columns that will
-- be renamed, the four dimensions live in fitment_json and only the parts
-- that are stable across any wording get real columns. Renaming a dimension
-- then costs a label change, not a migration.
--
-- lead_quality is denormalised onto crm_leads as well, because the whole
-- point is sorting the list by which leads to call first, and that has to be
-- filterable without a join.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

CREATE TABLE IF NOT EXISTS crm_partner_api_keys (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_unit_id  BIGINT UNSIGNED NOT NULL,
  partner_key       VARCHAR(60)  NOT NULL COMMENT 'Machine name, e.g. smatbot',
  label             VARCHAR(120) NOT NULL,
  -- Only the hash is kept. A leaked backup must not yield a working key, and
  -- the plaintext is shown once at issue and never again.
  key_hash          CHAR(64)     NOT NULL COMMENT 'SHA-256 of the issued key',
  key_prefix        VARCHAR(12)  NOT NULL COMMENT 'First characters, so a key can be identified without revealing it',
  scopes            VARCHAR(255) NOT NULL DEFAULT 'lead.qualification.write',
  is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
  last_used_at_utc  DATETIME(6)  NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at_utc    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  revoked_at_utc    DATETIME(6)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_partner_key_hash (key_hash),
  KEY ix_partner_key_lookup (is_active, partner_key),
  CONSTRAINT fk_partner_key_unit FOREIGN KEY (business_unit_id)
    REFERENCES crm_business_units (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_lead_qualifications (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_unit_id  BIGINT UNSIGNED NOT NULL,
  lead_id           BIGINT UNSIGNED NOT NULL,
  partner_key       VARCHAR(60)  NOT NULL DEFAULT 'smatbot',
  -- 1 = AI pre-qualification, 2 = representative call.
  phase             TINYINT UNSIGNED NOT NULL,
  call_status       VARCHAR(40)  NULL,
  lead_quality      VARCHAR(20)  NULL COMMENT 'hot | warm | cold | lost',
  -- Section 7 of the specification: keeps "we judged this lead lost" apart
  -- from "the call was too short to judge".
  call_assessment   VARCHAR(40)  NULL COMMENT 'qualified | short_call | insufficient_info',
  purchase_urgency  VARCHAR(120) NULL,
  budget_footprint  VARCHAR(255) NULL,
  fitment_json      JSON         NULL COMMENT 'The per-dimension fitment answers, named by the partner',
  call_at_utc       DATETIME(6)  NULL,
  call_duration_seconds INT UNSIGNED NULL,
  recording_url     VARCHAR(1000) NULL,
  summary           TEXT         NULL,
  sales_rep_id      VARCHAR(60)  NULL,
  -- Supplied by the partner so a retried delivery updates rather than
  -- duplicates. Falls back to the phase when the partner sends none.
  external_call_id  VARCHAR(120) NULL,
  raw_payload       JSON         NULL,
  created_at_utc    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_lead_qualification_delivery (lead_id, partner_key, phase, external_call_id),
  KEY ix_lead_qualification_lead (lead_id, phase),
  KEY ix_lead_qualification_unit (business_unit_id, lead_quality),
  CONSTRAINT fk_lead_qualification_lead FOREIGN KEY (lead_id)
    REFERENCES crm_leads (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A call logged by a partner has no CallerDesk account behind it, but
-- crm_call_activities.config_id was NOT NULL -- baking in the assumption that
-- every call comes from CallerDesk. Relaxed so an AI call can join the same
-- activity feed, where the CRM already plays call recordings. The foreign key
-- is unaffected: NULL satisfies it.
SET @is_nullable = (SELECT is_nullable FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_call_activities' AND column_name = 'config_id');
SET @ddl = IF(@is_nullable = 'NO',
  'ALTER TABLE crm_call_activities MODIFY COLUMN config_id BIGINT UNSIGNED NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

-- The rating the list sorts and filters on.
SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_leads' AND column_name = 'lead_quality');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE crm_leads
     ADD COLUMN lead_quality VARCHAR(20) NULL DEFAULT NULL AFTER lead_score,
     ADD COLUMN lead_quality_at_utc DATETIME(6) NULL DEFAULT NULL AFTER lead_quality,
     ADD INDEX ix_lead_quality (business_unit_id, lead_quality)',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

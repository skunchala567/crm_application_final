-- =====================================================================
-- CallerDesk telephony, call outcomes and opt-in dialling queues.
--
-- Idempotent: the migration runner replays every file on every run, so each
-- column is added only when it is absent. This file used to be a bare
-- ALTER TABLE, which failed with "Duplicate column name" on the second run
-- and stopped the runner before every later migration -- which is how the
-- database drifted behind the migrations that follow it.
-- =====================================================================

-- Credentials and account configuration live in crm_integrations.config.

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'branches' AND column_name = 'callerdesk_did_id');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE branches ADD COLUMN callerdesk_did_id VARCHAR(100) NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'branches' AND column_name = 'callerdesk_did_number');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE branches ADD COLUMN callerdesk_did_number VARCHAR(30) NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'branches' AND column_name = 'callerdesk_call_group');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE branches ADD COLUMN callerdesk_call_group VARCHAR(120) NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'branches' AND column_name = 'callerdesk_inbound_enabled');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE branches ADD COLUMN callerdesk_inbound_enabled TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'branches' AND column_name = 'callerdesk_outbound_enabled');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE branches ADD COLUMN callerdesk_outbound_enabled TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'app_users' AND column_name = 'callerdesk_member_id');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE app_users ADD COLUMN callerdesk_member_id VARCHAR(100) NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'app_users' AND column_name = 'callerdesk_member_name');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE app_users ADD COLUMN callerdesk_member_name VARCHAR(150) NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'app_users' AND column_name = 'callerdesk_member_number');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE app_users ADD COLUMN callerdesk_member_number VARCHAR(30) NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'app_users' AND column_name = 'callerdesk_call_group');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE app_users ADD COLUMN callerdesk_call_group VARCHAR(120) NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'app_users' AND column_name = 'callerdesk_enabled');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE app_users ADD COLUMN callerdesk_enabled TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

CREATE TABLE IF NOT EXISTS crm_call_activities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  integration_id INT NOT NULL,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  lead_id BIGINT UNSIGNED NULL,
  agent_user_id BIGINT UNSIGNED NULL,
  callerdesk_sid VARCHAR(120) NULL,
  campaign_reference VARCHAR(120) NULL,
  direction VARCHAR(20) NULL,
  source_number VARCHAR(30) NULL,
  destination_number VARCHAR(30) NULL,
  agent_number VARCHAR(30) NULL,
  status VARCHAR(80) NOT NULL DEFAULT 'initiated',
  call_result VARCHAR(100) NULL,
  started_at_utc DATETIME(6) NULL,
  ended_at_utc DATETIME(6) NULL,
  duration_seconds INT UNSIGNED NOT NULL DEFAULT 0,
  talk_seconds INT UNSIGNED NOT NULL DEFAULT 0,
  recording_url VARCHAR(1000) NULL,
  coins DECIMAL(12,4) NULL,
  call_group VARCHAR(120) NULL,
  disposition VARCHAR(80) NULL,
  notes TEXT NULL,
  followup_at_utc DATETIME(6) NULL,
  raw_payload JSON NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id), UNIQUE KEY uq_callerdesk_sid (integration_id,callerdesk_sid),
  KEY ix_calls_lead_time (lead_id,created_at_utc), KEY ix_calls_bu_time (business_unit_id,created_at_utc),
  CONSTRAINT fk_call_integration FOREIGN KEY (integration_id) REFERENCES crm_integrations(id) ON DELETE CASCADE,
  CONSTRAINT fk_call_bu FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE,
  CONSTRAINT fk_call_lead FOREIGN KEY (lead_id) REFERENCES crm_leads(id) ON DELETE SET NULL,
  CONSTRAINT fk_call_user FOREIGN KEY (agent_user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_dialer_campaigns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  integration_id INT NOT NULL, business_unit_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(160) NOT NULL, mode ENUM('manual','preview','progressive') NOT NULL DEFAULT 'preview',
  status ENUM('draft','running','paused','completed','cancelled') NOT NULL DEFAULT 'draft',
  agent_user_id BIGINT UNSIGNED NULL, deskphone VARCHAR(30) NULL, call_group VARCHAR(120) NULL,
  max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 2, retry_delay_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  created_by_user_id BIGINT UNSIGNED NOT NULL, created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY(id), KEY ix_dialer_campaign_bu (business_unit_id,status),
  CONSTRAINT fk_dialer_campaign_integration FOREIGN KEY(integration_id) REFERENCES crm_integrations(id) ON DELETE CASCADE,
  CONSTRAINT fk_dialer_campaign_bu FOREIGN KEY(business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE,
  CONSTRAINT fk_dialer_campaign_agent_user FOREIGN KEY(agent_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_dialer_campaign_user FOREIGN KEY(created_by_user_id) REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_dialer_queue (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, campaign_id BIGINT UNSIGNED NOT NULL, lead_id BIGINT UNSIGNED NOT NULL,
  status ENUM('queued','dialling','connected','completed','retry','skipped','failed') NOT NULL DEFAULT 'queued',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0, next_attempt_at_utc DATETIME(6) NULL, last_call_activity_id BIGINT UNSIGNED NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY(id), UNIQUE KEY uq_dialer_campaign_lead(campaign_id,lead_id), KEY ix_dialer_next(campaign_id,status,next_attempt_at_utc),
  CONSTRAINT fk_dialer_queue_campaign FOREIGN KEY(campaign_id) REFERENCES crm_dialer_campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_dialer_queue_lead FOREIGN KEY(lead_id) REFERENCES crm_leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_dialer_queue_call FOREIGN KEY(last_call_activity_id) REFERENCES crm_call_activities(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

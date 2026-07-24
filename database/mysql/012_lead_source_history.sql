USE attendance_biometric;
SET NAMES utf8mb4;

SET @has_normalized_phone=(SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='crm_leads' AND column_name='normalized_phone');
SET @ddl=IF(@has_normalized_phone=0,'ALTER TABLE crm_leads ADD COLUMN normalized_phone VARCHAR(30) NULL AFTER phone, ADD KEY idx_crm_leads_branch_phone (branch_id,normalized_phone)','SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

UPDATE crm_leads SET normalized_phone=REGEXP_REPLACE(phone,'[^0-9]','') WHERE normalized_phone IS NULL OR normalized_phone='';

CREATE TABLE IF NOT EXISTS crm_lead_source_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id BIGINT UNSIGNED NOT NULL,
  academic_year VARCHAR(20) NOT NULL,
  source_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  medium_id BIGINT UNSIGNED NOT NULL,
  campaign_id BIGINT UNSIGNED NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  intake_method VARCHAR(30) NOT NULL DEFAULT 'manual',
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY(id),
  KEY idx_crm_source_history_lead (lead_id,created_at_utc),
  CONSTRAINT fk_crm_source_history_lead FOREIGN KEY(lead_id) REFERENCES crm_leads(id),
  CONSTRAINT fk_crm_source_history_source FOREIGN KEY(source_id) REFERENCES crm_lead_sources(id),
  CONSTRAINT fk_crm_source_history_channel FOREIGN KEY(channel_id) REFERENCES crm_lead_channels(id),
  CONSTRAINT fk_crm_source_history_medium FOREIGN KEY(medium_id) REFERENCES crm_lead_media(id),
  CONSTRAINT fk_crm_source_history_campaign FOREIGN KEY(campaign_id) REFERENCES crm_campaigns(id),
  CONSTRAINT fk_crm_source_history_user FOREIGN KEY(created_by_user_id) REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS crm_lead_channels (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, channel_code VARCHAR(50) NOT NULL, display_name VARCHAR(100) NOT NULL,
 category ENUM('Primary','Secondary') NOT NULL DEFAULT 'Primary', is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
 PRIMARY KEY(id), UNIQUE KEY uq_crm_channel_code(channel_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS crm_lead_media (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, medium_code VARCHAR(50) NOT NULL, display_name VARCHAR(100) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE,
 PRIMARY KEY(id), UNIQUE KEY uq_crm_medium_code(medium_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS crm_campaigns (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, campaign_code VARCHAR(80) NOT NULL, display_name VARCHAR(150) NOT NULL,
 category VARCHAR(80) NOT NULL DEFAULT 'General', is_active BOOLEAN NOT NULL DEFAULT TRUE,
 PRIMARY KEY(id), UNIQUE KEY uq_crm_campaign_code(campaign_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS crm_admission_types (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, type_code VARCHAR(50) NOT NULL, display_name VARCHAR(100) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE,
 PRIMARY KEY(id), UNIQUE KEY uq_crm_admission_type_code(type_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS crm_lead_substages (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, stage_id BIGINT UNSIGNED NOT NULL, substage_code VARCHAR(60) NOT NULL, display_name VARCHAR(100) NOT NULL,
 position SMALLINT UNSIGNED NOT NULL DEFAULT 1, is_active BOOLEAN NOT NULL DEFAULT TRUE,
 PRIMARY KEY(id), UNIQUE KEY uq_crm_substage_code(substage_code), KEY ix_crm_substage_stage(stage_id),
 CONSTRAINT fk_crm_substage_stage FOREIGN KEY(stage_id) REFERENCES crm_lead_stages(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO crm_lead_channels(channel_code,display_name,category) VALUES
('website','Website','Primary'),('walk_in','Walk-in','Primary'),('phone','Phone enquiry','Primary'),
('whatsapp','WhatsApp','Secondary'),('email','Email','Secondary'),('social','Social media','Secondary')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),category=VALUES(category),is_active=TRUE;
INSERT INTO crm_lead_media(medium_code,display_name) VALUES ('organic','Organic'),('paid','Paid'),('offline','Offline'),('referral','Referral')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),is_active=TRUE;
INSERT INTO crm_campaigns(campaign_code,display_name,category) VALUES ('general_enquiry','General enquiry','General'),('admissions_2026','Admissions 2026-27','Admissions')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),category=VALUES(category),is_active=TRUE;
INSERT INTO crm_admission_types(type_code,display_name) VALUES ('new','New admission'),('transfer','Transfer'),('sibling','Sibling admission'),('re_admission','Re-admission')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),is_active=TRUE;
INSERT INTO crm_lead_substages(stage_id,substage_code,display_name,position)
SELECT id,CONCAT(name,'_pending'),CONCAT(display_name,' - Pending'),1 FROM crm_lead_stages
-- A replay may refresh the label, but must never undo an administrator's
-- decision to deactivate/delete this seeded sub-stage.
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),stage_id=VALUES(stage_id);

SET @extended_columns_exist=(SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='crm_leads' AND column_name='channel_id');
SET @sql=IF(@extended_columns_exist=0,'ALTER TABLE crm_leads
 ADD COLUMN channel_id BIGINT UNSIGNED NULL AFTER source_id,
 ADD COLUMN medium_id BIGINT UNSIGNED NULL AFTER channel_id,
 ADD COLUMN campaign_id BIGINT UNSIGNED NULL AFTER medium_id,
 ADD COLUMN admission_type_id BIGINT UNSIGNED NULL AFTER campaign_id,
 ADD COLUMN substage_id BIGINT UNSIGNED NULL AFTER stage_id,
 ADD COLUMN referred_by_employee_id BIGINT NULL AFTER owner_employee_id,
 ADD COLUMN touched_at_utc DATETIME(6) NULL AFTER next_followup_at_utc,
 ADD COLUMN is_parent BOOLEAN NULL AFTER parent_name,
 ADD COLUMN looking_for_admission BOOLEAN NULL AFTER is_parent,
 ADD COLUMN whatsapp_response ENUM(''Responded'',''Not Responded'',''Opted Out'') NULL AFTER looking_for_admission,
 ADD KEY ix_crm_leads_channel(channel_id), ADD KEY ix_crm_leads_medium(medium_id), ADD KEY ix_crm_leads_campaign(campaign_id),
 ADD KEY ix_crm_leads_admission_type(admission_type_id), ADD KEY ix_crm_leads_substage(substage_id), ADD KEY ix_crm_leads_referrer(referred_by_employee_id),
 ADD CONSTRAINT fk_crm_leads_channel FOREIGN KEY(channel_id) REFERENCES crm_lead_channels(id),
 ADD CONSTRAINT fk_crm_leads_medium FOREIGN KEY(medium_id) REFERENCES crm_lead_media(id),
 ADD CONSTRAINT fk_crm_leads_campaign FOREIGN KEY(campaign_id) REFERENCES crm_campaigns(id),
 ADD CONSTRAINT fk_crm_leads_admission_type FOREIGN KEY(admission_type_id) REFERENCES crm_admission_types(id),
 ADD CONSTRAINT fk_crm_leads_substage FOREIGN KEY(substage_id) REFERENCES crm_lead_substages(id),
 ADD CONSTRAINT fk_crm_leads_referrer FOREIGN KEY(referred_by_employee_id) REFERENCES employees(id)', 'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

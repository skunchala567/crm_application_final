SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS crm_campaign_categories (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, category_code VARCHAR(80) NOT NULL, display_name VARCHAR(100) NOT NULL,
 is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY(id), UNIQUE KEY uq_crm_campaign_category_code(category_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS crm_channel_categories (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, category_code VARCHAR(80) NOT NULL, display_name VARCHAR(100) NOT NULL,
 is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY(id), UNIQUE KEY uq_crm_channel_category_code(category_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
ALTER TABLE crm_lead_channels MODIFY COLUMN category VARCHAR(100) NOT NULL DEFAULT 'Primary';

INSERT INTO crm_campaign_categories(category_code,display_name)
SELECT DISTINCT LOWER(REPLACE(category,' ','_')),category FROM crm_campaigns
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
INSERT INTO crm_channel_categories(category_code,display_name) VALUES ('primary','Primary'),('secondary','Secondary')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

SET @category_columns_exist=(SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='crm_campaigns' AND column_name='category_id');
SET @sql=IF(@category_columns_exist=0,'ALTER TABLE crm_campaigns ADD COLUMN category_id BIGINT UNSIGNED NULL AFTER category, ADD KEY ix_crm_campaign_category(category_id), ADD CONSTRAINT fk_crm_campaign_category FOREIGN KEY(category_id) REFERENCES crm_campaign_categories(id)', 'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
SET @channel_category_column_exists=(SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='crm_lead_channels' AND column_name='category_id');
SET @sql=IF(@channel_category_column_exists=0,'ALTER TABLE crm_lead_channels ADD COLUMN category_id BIGINT UNSIGNED NULL AFTER category, ADD KEY ix_crm_channel_category(category_id), ADD CONSTRAINT fk_crm_channel_category FOREIGN KEY(category_id) REFERENCES crm_channel_categories(id)', 'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

UPDATE crm_campaigns c JOIN crm_campaign_categories cc ON cc.display_name=c.category SET c.category_id=cc.id WHERE c.category_id IS NULL;
UPDATE crm_lead_channels c JOIN crm_channel_categories cc ON cc.display_name=c.category SET c.category_id=cc.id WHERE c.category_id IS NULL;

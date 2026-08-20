-- Isolated source and campaign master data for metadata-driven Business Units.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS crm_business_channel_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  category_key VARCHAR(80) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_crm_business_channel_category (business_unit_id,category_key),
  CONSTRAINT fk_crm_business_channel_category_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_business_channels (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  channel_key VARCHAR(80) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_crm_business_channel (business_unit_id,channel_key),
  KEY ix_crm_business_channel_category (category_id),
  CONSTRAINT fk_crm_business_channel_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_business_channel_category FOREIGN KEY (category_id) REFERENCES crm_business_channel_categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_business_sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  source_key VARCHAR(80) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_crm_business_source (business_unit_id,source_key),
  KEY ix_crm_business_source_channel (channel_id),
  CONSTRAINT fk_crm_business_source_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_business_source_channel FOREIGN KEY (channel_id) REFERENCES crm_business_channels(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_business_campaign_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  category_key VARCHAR(80) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_crm_business_campaign_category (business_unit_id,category_key),
  CONSTRAINT fk_crm_business_campaign_category_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_business_campaigns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  campaign_key VARCHAR(80) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_crm_business_campaign (business_unit_id,campaign_key),
  KEY ix_crm_business_campaign_category (category_id),
  CONSTRAINT fk_crm_business_campaign_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_business_campaign_category FOREIGN KEY (category_id) REFERENCES crm_business_campaign_categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Starter values keep existing metadata Business Units immediately usable.
INSERT INTO crm_business_channel_categories (business_unit_id,category_key,display_name)
SELECT id,'primary','Primary' FROM crm_business_units WHERE compatibility_mode='metadata'
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO crm_business_channels (business_unit_id,category_id,channel_key,display_name)
SELECT bu.id,cc.id,'direct','Direct'
FROM crm_business_units bu JOIN crm_business_channel_categories cc ON cc.business_unit_id=bu.id AND cc.category_key='primary'
WHERE bu.compatibility_mode='metadata'
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),category_id=VALUES(category_id);

INSERT INTO crm_business_sources (business_unit_id,channel_id,source_key,display_name)
SELECT bu.id,ch.id,'direct','Direct'
FROM crm_business_units bu JOIN crm_business_channels ch ON ch.business_unit_id=bu.id AND ch.channel_key='direct'
WHERE bu.compatibility_mode='metadata'
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),channel_id=VALUES(channel_id);

INSERT INTO crm_business_campaign_categories (business_unit_id,category_key,display_name)
SELECT id,'general','General' FROM crm_business_units WHERE compatibility_mode='metadata'
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO crm_business_campaigns (business_unit_id,category_id,campaign_key,display_name)
SELECT bu.id,cc.id,'general','General enquiry'
FROM crm_business_units bu JOIN crm_business_campaign_categories cc ON cc.business_unit_id=bu.id AND cc.category_key='general'
WHERE bu.compatibility_mode='metadata'
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),category_id=VALUES(category_id);

SET NAMES utf8mb4;

-- =====================================================================
-- Meta Lead Ads: Instagram.
--
-- Instagram lead ads travel through the exact same Page -> form -> webhook
-- pipeline crm_meta_pages/crm_meta_forms/crm_meta_lead_imports already
-- handle -- Meta just tells us, if asked, which Instagram account a Page
-- has linked and which surface (fb/ig) produced a given lead. Neither was
-- being requested from Graph before this.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

SET @has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_meta_pages' AND column_name='instagram_account_id');
SET @ddl = IF(@has=0,
  'ALTER TABLE crm_meta_pages ADD COLUMN instagram_account_id VARCHAR(64) NULL AFTER page_name',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_meta_pages' AND column_name='instagram_username');
SET @ddl = IF(@has=0,
  'ALTER TABLE crm_meta_pages ADD COLUMN instagram_username VARCHAR(255) NULL AFTER instagram_account_id',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Which surface (Facebook or Instagram) actually produced the lead. NULL for
-- organic/no-ad leads, where Meta reports no platform at all.
SET @has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_meta_lead_imports' AND column_name='platform');
SET @ddl = IF(@has=0,
  'ALTER TABLE crm_meta_lead_imports ADD COLUMN platform VARCHAR(20) NULL AFTER campaign_meta_id',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Filtered on when building a remarketing audience by platform.
SET @has = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='crm_meta_lead_imports' AND index_name='ix_meta_import_platform');
SET @ddl = IF(@has=0,
  'CREATE INDEX ix_meta_import_platform ON crm_meta_lead_imports (platform)',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

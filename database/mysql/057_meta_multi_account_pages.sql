USE attendance_biometric;
SET NAMES utf8mb4;

-- =====================================================================
-- Meta Lead Ads: Pages from more than one Facebook account.
--
-- crm_meta_pages already stores a per-Page access token, and every runtime
-- path (webhook fetch, backfill, subscribe) uses that Page token rather than
-- an account-level one. The only single-account limit was DISCOVERY: page
-- listing ran against the one stored systemUserToken.
--
-- These columns record which Facebook account each Page was discovered
-- through, so Pages from several accounts can coexist and be grouped in the
-- UI. Nullable: rows connected before this migration keep working untouched.
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

SET @has_account_id = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_meta_pages' AND column_name='meta_account_id');
SET @ddl = IF(@has_account_id=0,
  'ALTER TABLE crm_meta_pages ADD COLUMN meta_account_id VARCHAR(64) NULL AFTER integration_id',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_account_name = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_meta_pages' AND column_name='meta_account_name');
SET @ddl = IF(@has_account_name=0,
  'ALTER TABLE crm_meta_pages ADD COLUMN meta_account_name VARCHAR(255) NULL AFTER meta_account_id',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

-- Grouping Pages by account is the main read pattern for the settings screen.
SET @has_account_index = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='crm_meta_pages' AND index_name='ix_crm_meta_pages_account');
SET @ddl = IF(@has_account_index=0,
  'CREATE INDEX ix_crm_meta_pages_account ON crm_meta_pages (meta_account_id)',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

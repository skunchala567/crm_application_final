SET NAMES utf8mb4;

-- =====================================================================
-- Per-business-unit support link for the sidebar's help card.
--
-- The "Need a hand? / Visit the help centre" card in the left panel was
-- fixed text that did nothing when clicked. Each business unit supports its
-- users differently -- one may want a WhatsApp chat, another a Zoom room or
-- an internal help desk -- so the destination belongs to the unit rather
-- than to the code.
--
-- All three columns are nullable: a unit that sets nothing keeps the current
-- wording, and the card stays unclickable rather than leading nowhere.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

SET @has_help_url = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_business_units' AND column_name='help_url');
SET @ddl = IF(@has_help_url=0,
  'ALTER TABLE crm_business_units ADD COLUMN help_url VARCHAR(1000) NULL AFTER brand_logo',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_help_title = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_business_units' AND column_name='help_title');
SET @ddl = IF(@has_help_title=0,
  'ALTER TABLE crm_business_units ADD COLUMN help_title VARCHAR(80) NULL AFTER help_url',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_help_subtitle = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_business_units' AND column_name='help_subtitle');
SET @ddl = IF(@has_help_subtitle=0,
  'ALTER TABLE crm_business_units ADD COLUMN help_subtitle VARCHAR(160) NULL AFTER help_title',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

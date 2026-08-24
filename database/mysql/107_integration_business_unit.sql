SET NAMES utf8mb4;

-- =====================================================================
-- An integration account belongs to a business unit.
--
-- crm_integrations was keyed by organization alone, so every account
-- configured anywhere -- Tata Smartflo, CallerDesk, WhatsApp, Meta, SMTP,
-- Google Sheets -- was reachable from every business unit. One unit's
-- telephony account answered another unit's calls, and a new unit inherited
-- credentials nobody had given it.
--
-- business_unit_id names the unit whose screens may use the account.
--
-- NULL keeps the old meaning: shared with every unit. Nothing in the product
-- creates a NULL row any more -- an account is stamped with the unit it was
-- added from -- but the value stays legal so an account can deliberately be
-- made available everywhere, and so a row this migration cannot place is
-- left working rather than orphaned.
--
-- Existing rows are stamped with the default business unit, because that is
-- the unit they were configured from: they predate any other unit having an
-- Integrations screen of its own. A deployment that genuinely shared one
-- account between units can set that row back to NULL.
--
-- No foreign key: crm_integrations is a legacy table that has never had one
-- (organization_id has no constraint either), and rows here are referenced
-- with ON DELETE RESTRICT by marketing campaigns -- so a cascade from a
-- business unit could only ever fail halfway through deleting a unit.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

SET @had_unit_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_integrations' AND column_name='business_unit_id');
SET @ddl = IF(@had_unit_column=0,
  'ALTER TABLE crm_integrations ADD COLUMN business_unit_id BIGINT UNSIGNED NULL AFTER organization_id',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

-- Every lookup asks "this unit's account for this provider".
SET @has_index = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='crm_integrations' AND index_name='ix_integration_unit_provider');
SET @ddl = IF(@has_index=0,
  'ALTER TABLE crm_integrations ADD INDEX ix_integration_unit_provider (business_unit_id, provider)',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

-- The accounts that existed before this column did belong to the default unit:
-- it is the unit they were configured from. Guarded on the column having just
-- been added, so a replay never re-stamps a row somebody has since shared by
-- setting it back to NULL.
SET @default_unit = (SELECT id FROM crm_business_units
  WHERE is_active=TRUE ORDER BY is_default DESC, id LIMIT 1);
UPDATE crm_integrations
   SET business_unit_id = @default_unit
 WHERE @had_unit_column = 0
   AND @default_unit IS NOT NULL
   AND business_unit_id IS NULL;

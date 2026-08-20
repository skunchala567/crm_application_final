SET NAMES utf8mb4;

-- =====================================================================
-- Per-business-unit branding for the sidebar lockup.
--
-- The left panel showed a hard-coded "Orbit / Admissions CRM" lockup.
-- These columns let each business unit supply its own title, subtitle and
-- logo, so switching unit re-brands the workspace.
--
-- brand_logo is MEDIUMTEXT because it holds either an https URL or an
-- inline data: URI for an uploaded image; TEXT (64KB) is too small for the
-- latter. Nullable throughout, so existing units keep the built-in default.
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

SET @has_brand_title = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_business_units' AND column_name='brand_title');
SET @ddl = IF(@has_brand_title=0,
  'ALTER TABLE crm_business_units ADD COLUMN brand_title VARCHAR(80) NULL AFTER display_name',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_brand_subtitle = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_business_units' AND column_name='brand_subtitle');
SET @ddl = IF(@has_brand_subtitle=0,
  'ALTER TABLE crm_business_units ADD COLUMN brand_subtitle VARCHAR(120) NULL AFTER brand_title',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_brand_logo = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_business_units' AND column_name='brand_logo');
SET @ddl = IF(@has_brand_logo=0,
  'ALTER TABLE crm_business_units ADD COLUMN brand_logo MEDIUMTEXT NULL AFTER brand_subtitle',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

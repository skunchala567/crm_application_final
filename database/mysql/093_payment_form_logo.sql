SET NAMES utf8mb4;

-- =====================================================================
-- An optional logo for a payment form.
--
-- A payment form is often the only page a payer ever sees of the school:
-- they arrive from a link, hand over money, and leave. A mark beside the
-- title is what tells them they are on the right page and not a copy of
-- it, so this is presentation that does real work.
--
-- MEDIUMTEXT because it holds either an https URL or an inline data URI,
-- the same choice crm_business_units.brand_logo made in 058: no upload
-- endpoint and no static file serving are involved, so the image travels
-- with the row and survives a restore of it.
--
-- NULL means no logo, which is what every existing form gets and what a
-- form that never sets one keeps. Public enquiry forms deliberately do not
-- have this -- they already carry their business unit's branding.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_payment_forms'
    AND column_name = 'logo_url');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE crm_payment_forms
     ADD COLUMN logo_url MEDIUMTEXT NULL DEFAULT NULL
     AFTER description',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

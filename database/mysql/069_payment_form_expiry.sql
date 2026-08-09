USE attendance_biometric;
SET NAMES utf8mb4;

-- =====================================================================
-- An optional expiry date for a payment form.
--
-- A form is a public URL that anyone holding it can pay through, so the
-- useful question is not only "is this switched on" but "should this still
-- be accepting money in March". is_active answers the first; this answers
-- the second without somebody having to remember to switch it off.
--
-- NULL means no expiry, which is what every existing form gets -- the column
-- must not silently retire forms that are collecting today.
--
-- Stored as the last moment of the chosen day, so a form set to expire on
-- the 20th still works all through the 20th. Times here follow the rest of
-- the schema: the pool pins every connection to '+05:30', so this is IST
-- wall-clock despite the _utc suffix the other columns carry.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_payment_forms'
    AND column_name = 'expires_at_utc');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE crm_payment_forms
     ADD COLUMN expires_at_utc DATETIME NULL DEFAULT NULL
     AFTER is_active',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

-- Looked up on every public form load, alongside is_active.
SET @has_index = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'crm_payment_forms'
    AND index_name = 'ix_payment_form_expiry');
SET @ddl = IF(@has_index = 0,
  'ALTER TABLE crm_payment_forms ADD INDEX ix_payment_form_expiry (is_active, expires_at_utc)',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

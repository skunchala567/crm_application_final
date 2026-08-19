-- =====================================================================
-- The Smartflo IVR a branch answers on.
--
-- Idempotent: the migration runner replays every file on every run, so each
-- column is added only when it is absent. This file used to be a bare
-- ALTER TABLE, which failed with "Duplicate column name" on the second run
-- and stopped the runner before every later migration -- which is how the
-- database drifted behind the migrations that follow it.
-- =====================================================================

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'branches' AND column_name = 'smartflo_ivr_id');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE branches ADD COLUMN smartflo_ivr_id VARCHAR(100) NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'branches' AND column_name = 'smartflo_ivr_name');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE branches ADD COLUMN smartflo_ivr_name VARCHAR(150) NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;


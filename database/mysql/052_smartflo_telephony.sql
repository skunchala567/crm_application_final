-- =====================================================================
-- Smartflo telephony: branch DIDs and per-user agent identities.
--
-- Idempotent: the migration runner replays every file on every run, so each
-- column is added only when it is absent. This file used to be a bare
-- ALTER TABLE, which failed with "Duplicate column name" on the second run
-- and stopped the runner before every later migration -- which is how the
-- database drifted behind the migrations that follow it.
-- =====================================================================

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'branches' AND column_name = 'smartflo_did_id');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE branches ADD COLUMN smartflo_did_id VARCHAR(100) NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'branches' AND column_name = 'smartflo_did_number');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE branches ADD COLUMN smartflo_did_number VARCHAR(30) NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'branches' AND column_name = 'smartflo_department_id');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE branches ADD COLUMN smartflo_department_id VARCHAR(100) NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'branches' AND column_name = 'smartflo_inbound_enabled');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE branches ADD COLUMN smartflo_inbound_enabled TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'branches' AND column_name = 'smartflo_outbound_enabled');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE branches ADD COLUMN smartflo_outbound_enabled TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'app_users' AND column_name = 'smartflo_user_id');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE app_users ADD COLUMN smartflo_user_id VARCHAR(100) NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'app_users' AND column_name = 'smartflo_agent_id');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE app_users ADD COLUMN smartflo_agent_id VARCHAR(100) NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'app_users' AND column_name = 'smartflo_agent_name');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE app_users ADD COLUMN smartflo_agent_name VARCHAR(150) NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'app_users' AND column_name = 'smartflo_agent_number');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE app_users ADD COLUMN smartflo_agent_number VARCHAR(30) NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'app_users' AND column_name = 'smartflo_department_id');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE app_users ADD COLUMN smartflo_department_id VARCHAR(100) NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'app_users' AND column_name = 'smartflo_enabled');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE app_users ADD COLUMN smartflo_enabled TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;


USE attendance_biometric;
SET NAMES utf8mb4;

-- =====================================================================
-- Leads set aside to come back to.
--
-- A counsellor working a long list needs somewhere to put the ones worth
-- another call without changing what they are: a stage change says
-- something about the admission, and a follow-up date commits to a day.
-- Parking says only "not now, but don't lose it".
--
-- A timestamp rather than a boolean. NULL means not parked, which is every
-- lead today, and a parked one carries when it was set aside -- so a lead
-- parked in March is distinguishable from one parked this morning without
-- a second column to hold the date.
--
-- parked_by_user_id records who set it aside. The Leads list is already
-- scoped to what each user may see, so in practice a counsellor's parked
-- set is their own; this is what lets an administrator looking across a
-- branch tell whose it is.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_leads' AND column_name = 'parked_at_utc');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE crm_leads ADD COLUMN parked_at_utc DATETIME(6) NULL DEFAULT NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_leads' AND column_name = 'parked_by_user_id');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE crm_leads ADD COLUMN parked_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

-- Counted for the toolbar badge on every Leads load, and filtered on when
-- the parked view is switched on.
SET @has_index = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'crm_leads' AND index_name = 'ix_lead_parked');
SET @ddl = IF(@has_index = 0,
  'ALTER TABLE crm_leads ADD INDEX ix_lead_parked (business_unit_id, parked_at_utc)',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

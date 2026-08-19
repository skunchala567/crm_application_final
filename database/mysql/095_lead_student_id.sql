USE attendance_biometric;
SET NAMES utf8mb4;

-- =====================================================================
-- The student ID issued once a lead becomes a student.
--
-- The CRM had nowhere to record it. A lead could be admitted, be given an
-- ID by the school, and the CRM would still show nothing to distinguish it
-- from a lead that never got that far -- so "has this one been enrolled
-- yet" could not be filtered, listed or exported.
--
-- The ID itself is stored rather than a yes/no flag: the Leads screen
-- derives "generated" from whether this holds a value, and holding the
-- actual ID means it can also be read, searched and exported, which a flag
-- could never do.
--
-- 60 characters: long enough for any admission or enrolment number a school
-- issues, short enough to index in full.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_leads'
    AND column_name = 'student_id');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE crm_leads
     ADD COLUMN student_id VARCHAR(60) NULL DEFAULT NULL
     AFTER student_name',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

-- Looked up when somebody searches the Leads screen by ID, and scanned for
-- IS NOT NULL by the "student ID generated" filter.
SET @has_index = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'crm_leads'
    AND index_name = 'ix_lead_student_id');
SET @ddl = IF(@has_index = 0,
  'ALTER TABLE crm_leads ADD INDEX ix_lead_student_id (student_id)',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

USE attendance_biometric;
SET NAMES utf8mb4;

-- =====================================================================
-- Mark which stage means "admitted", so the dashboard can count admissions.
--
-- The dashboard counted admissions with `WHERE crm_lead_stages.name =
-- 'admitted'`. No stage has ever been called that: this database calls it
-- 'admission_done' in the School Admissions unit and 'bu31__won' in Pallavi
-- Franchise. So the Admissions KPI, and both of its month-over-month
-- comparisons, could only ever return 0 -- not because there were no
-- admissions, but because the literal matched nothing.
--
-- A hardcoded name cannot work here anyway: stage names are per business
-- unit and administrators rename them. A flag on the stage makes "which
-- stage means admitted" a configuration answer, the same way the attribution
-- platforms and permission registry work.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

SET @has_flag = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_lead_stages' AND column_name='is_admission_stage');
SET @ddl = IF(@has_flag=0,
  'ALTER TABLE crm_lead_stages ADD COLUMN is_admission_stage BOOLEAN NOT NULL DEFAULT FALSE AFTER requires_followup',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

-- Backfill from the names actually in use. Only ever sets the flag on, so a
-- replay cannot clear a choice an administrator has since made.
UPDATE crm_lead_stages
   SET is_admission_stage = TRUE
 WHERE is_admission_stage = FALSE
   AND (
     LOWER(name) IN ('admitted','admission_done','enrolled','won','bu31__won')
     OR LOWER(display_name) IN ('admitted','admission done','enrolled','enrolment confirmed','won')
   );

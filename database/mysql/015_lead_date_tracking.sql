-- Lead Date Tracking Enhancement
-- Adds comprehensive date tracking for lead lifecycle events
USE attendance_biometric;
SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Add re_enquired_at_utc column if it doesn't exist
SET @has_re_enquired=(SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='crm_leads' AND column_name='re_enquired_at_utc');
SET @ddl=IF(@has_re_enquired=0,'ALTER TABLE crm_leads ADD COLUMN re_enquired_at_utc DATETIME(6) NULL COMMENT "Timestamp of re-enquiry" AFTER referred_at_utc','SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

-- Add index on re_enquired_at_utc if it doesn't exist
SET @has_re_enquired_idx=(SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='crm_leads' AND column_name='re_enquired_at_utc');
SET @ddl=IF(@has_re_enquired_idx=0,'ALTER TABLE crm_leads ADD KEY ix_crm_leads_re_enquired (re_enquired_at_utc)','SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

USE attendance_biometric;
SET NAMES utf8mb4;

SET @has_referral_branch_id = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='crm_leads' AND column_name='referred_to_branch_id');
SET @ddl = IF(@has_referral_branch_id=0,'ALTER TABLE crm_leads ADD COLUMN referred_to_branch_id BIGINT UNSIGNED NULL AFTER owner_employee_id','SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_referral_branch_name = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='crm_leads' AND column_name='referred_to_branch_name');
SET @ddl = IF(@has_referral_branch_name=0,'ALTER TABLE crm_leads ADD COLUMN referred_to_branch_name VARCHAR(200) NULL AFTER referred_to_branch_id','SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_referred_at = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='crm_leads' AND column_name='referred_at_utc');
SET @ddl = IF(@has_referred_at=0,'ALTER TABLE crm_leads ADD COLUMN referred_at_utc DATETIME(6) NULL AFTER referred_to_branch_name','SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

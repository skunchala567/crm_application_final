USE attendance_biometric;
SET NAMES utf8mb4;

SET @has_medium=(SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='crm_lead_source_history' AND column_name='medium_id');
SET @has_fk=(SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='crm_lead_source_history' AND constraint_name='fk_crm_source_history_medium');
SET @ddl=IF(@has_fk=1,'ALTER TABLE crm_lead_source_history DROP FOREIGN KEY fk_crm_source_history_medium','SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;
SET @ddl=IF(@has_medium=1,'ALTER TABLE crm_lead_source_history DROP COLUMN medium_id','SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_lead_medium=(SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='crm_leads' AND column_name='medium_id');
SET @has_lead_fk=(SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='crm_leads' AND constraint_name='fk_crm_leads_medium');
SET @ddl=IF(@has_lead_fk=1,'ALTER TABLE crm_leads DROP FOREIGN KEY fk_crm_leads_medium','SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;
SET @ddl=IF(@has_lead_medium=1,'ALTER TABLE crm_leads DROP COLUMN medium_id','SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;
DROP TABLE IF EXISTS crm_lead_media;

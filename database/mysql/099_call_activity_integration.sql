-- Consolidated telephony integrations use crm_integrations. Older databases
-- created crm_call_activities with only config_id -> crm_callerdesk_configs;
-- CREATE TABLE IF NOT EXISTS in migration 051 cannot repair that shape.

SET @has_integration_id = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_call_activities' AND column_name = 'integration_id');
SET @ddl = IF(@has_integration_id = 0,
  'ALTER TABLE crm_call_activities ADD COLUMN integration_id INT NULL AFTER config_id',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

-- Historical CallerDesk and partner rows retain config_id. The legacy business
-- unit table has no organization key, so guessing a consolidated integration
-- could attach calls to the wrong account. New provider calls populate
-- integration_id; either reference may be NULL for partner-originated calls.

SET @has_integration_sid_key = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'crm_call_activities' AND index_name = 'uq_call_integration_sid');
SET @ddl = IF(@has_integration_sid_key = 0,
  'ALTER TABLE crm_call_activities ADD UNIQUE KEY uq_call_integration_sid (integration_id, callerdesk_sid)',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_integration_fk = (SELECT COUNT(*) FROM information_schema.key_column_usage
  WHERE table_schema = DATABASE() AND table_name = 'crm_call_activities'
    AND column_name = 'integration_id' AND referenced_table_name = 'crm_integrations');
SET @ddl = IF(@has_integration_fk = 0,
  'ALTER TABLE crm_call_activities ADD CONSTRAINT fk_call_integration_v2 FOREIGN KEY (integration_id) REFERENCES crm_integrations(id) ON DELETE CASCADE',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

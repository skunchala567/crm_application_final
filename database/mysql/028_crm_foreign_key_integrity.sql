-- Enforce parent/child integrity for CRM features added after the core schema.
-- All type changes preserve existing values and align child columns with their
-- referenced parent primary keys.

ALTER TABLE crm_integration_skipped_leads
  MODIFY integration_id INT NOT NULL;

ALTER TABLE crm_whatsapp_conversations
  MODIFY organization_id INT NOT NULL,
  MODIFY lead_id BIGINT UNSIGNED NULL;

ALTER TABLE crm_whatsapp_messages
  MODIFY lead_id BIGINT UNSIGNED NULL;

-- Add a foreign key only when the child column does not already have one.
SET @has_fk = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_leads'
    AND COLUMN_NAME = 'referred_to_branch_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
);
SET @ddl = IF(
  @has_fk = 0,
  'ALTER TABLE crm_leads ADD CONSTRAINT fk_crm_leads_referred_branch FOREIGN KEY (referred_to_branch_id) REFERENCES branches(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_integration_skipped_leads'
    AND COLUMN_NAME = 'integration_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
);
SET @ddl = IF(
  @has_fk = 0,
  'ALTER TABLE crm_integration_skipped_leads ADD CONSTRAINT fk_skipped_leads_integration FOREIGN KEY (integration_id) REFERENCES crm_integrations(id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_integration_skipped_leads'
    AND COLUMN_NAME = 'branch_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
);
SET @ddl = IF(
  @has_fk = 0,
  'ALTER TABLE crm_integration_skipped_leads ADD CONSTRAINT fk_skipped_leads_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_integration_skipped_leads'
    AND COLUMN_NAME = 'existing_lead_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
);
SET @ddl = IF(
  @has_fk = 0,
  'ALTER TABLE crm_integration_skipped_leads ADD CONSTRAINT fk_skipped_leads_existing_lead FOREIGN KEY (existing_lead_id) REFERENCES crm_leads(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_whatsapp_conversations'
    AND COLUMN_NAME = 'organization_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
);
SET @ddl = IF(
  @has_fk = 0,
  'ALTER TABLE crm_whatsapp_conversations ADD CONSTRAINT fk_whatsapp_conversation_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_whatsapp_conversations'
    AND COLUMN_NAME = 'lead_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
);
SET @ddl = IF(
  @has_fk = 0,
  'ALTER TABLE crm_whatsapp_conversations ADD CONSTRAINT fk_whatsapp_conversation_lead FOREIGN KEY (lead_id) REFERENCES crm_leads(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_whatsapp_messages'
    AND COLUMN_NAME = 'lead_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
);
SET @ddl = IF(
  @has_fk = 0,
  'ALTER TABLE crm_whatsapp_messages ADD CONSTRAINT fk_whatsapp_message_lead FOREIGN KEY (lead_id) REFERENCES crm_leads(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_whatsapp_templates'
    AND COLUMN_NAME = 'organization_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
);
SET @ddl = IF(
  @has_fk = 0,
  'ALTER TABLE crm_whatsapp_templates ADD CONSTRAINT fk_whatsapp_template_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_smartping_conversations'
    AND COLUMN_NAME = 'integration_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
);
SET @ddl = IF(
  @has_fk = 0,
  'ALTER TABLE crm_smartping_conversations ADD CONSTRAINT fk_smartping_conversation_integration FOREIGN KEY (integration_id) REFERENCES crm_integrations(id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_smartping_messages'
    AND COLUMN_NAME = 'integration_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
);
SET @ddl = IF(
  @has_fk = 0,
  'ALTER TABLE crm_smartping_messages ADD CONSTRAINT fk_smartping_message_integration FOREIGN KEY (integration_id) REFERENCES crm_integrations(id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_oauth_state_tokens'
    AND COLUMN_NAME = 'integration_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
);
SET @ddl = IF(
  @has_fk = 0,
  'ALTER TABLE crm_oauth_state_tokens ADD CONSTRAINT fk_oauth_state_integration FOREIGN KEY (integration_id) REFERENCES crm_integrations(id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_oauth_state_tokens'
    AND COLUMN_NAME = 'organization_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
);
SET @ddl = IF(
  @has_fk = 0,
  'ALTER TABLE crm_oauth_state_tokens ADD CONSTRAINT fk_oauth_state_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- These columns retain their legacy names for application compatibility, but
-- their values are integration IDs. Repoint their foreign keys from deprecated
-- configuration tables to crm_integrations(id).
SET @old_fk = (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_integration_oauth_tokens'
    AND COLUMN_NAME = 'integration_config_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
  LIMIT 1
);
SET @ddl = IF(
  @old_fk IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE crm_integration_oauth_tokens DROP FOREIGN KEY `', REPLACE(@old_fk, '`', '``'), '`')
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
ALTER TABLE crm_integration_oauth_tokens
  ADD CONSTRAINT fk_oauth_token_integration
  FOREIGN KEY (integration_config_id) REFERENCES crm_integrations(id) ON DELETE CASCADE;

SET @old_fk = (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_integration_sync_jobs'
    AND COLUMN_NAME = 'integration_config_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
  LIMIT 1
);
SET @ddl = IF(
  @old_fk IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE crm_integration_sync_jobs DROP FOREIGN KEY `', REPLACE(@old_fk, '`', '``'), '`')
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
ALTER TABLE crm_integration_sync_jobs
  ADD CONSTRAINT fk_sync_job_integration
  FOREIGN KEY (integration_config_id) REFERENCES crm_integrations(id) ON DELETE CASCADE;

SET @old_fk = (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_integration_sync_logs'
    AND COLUMN_NAME = 'integration_config_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
  LIMIT 1
);
SET @ddl = IF(
  @old_fk IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE crm_integration_sync_logs DROP FOREIGN KEY `', REPLACE(@old_fk, '`', '``'), '`')
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
ALTER TABLE crm_integration_sync_logs
  ADD CONSTRAINT fk_sync_log_integration
  FOREIGN KEY (integration_config_id) REFERENCES crm_integrations(id) ON DELETE CASCADE;

SET @old_fk = (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_integration_field_mappings'
    AND COLUMN_NAME = 'integration_config_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
  LIMIT 1
);
SET @ddl = IF(
  @old_fk IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE crm_integration_field_mappings DROP FOREIGN KEY `', REPLACE(@old_fk, '`', '``'), '`')
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
ALTER TABLE crm_integration_field_mappings
  ADD CONSTRAINT fk_field_mapping_integration
  FOREIGN KEY (integration_config_id) REFERENCES crm_integrations(id) ON DELETE CASCADE;

SET @old_fk = (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_integration_webhooks'
    AND COLUMN_NAME = 'integration_config_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
  LIMIT 1
);
SET @ddl = IF(
  @old_fk IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE crm_integration_webhooks DROP FOREIGN KEY `', REPLACE(@old_fk, '`', '``'), '`')
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
ALTER TABLE crm_integration_webhooks
  ADD CONSTRAINT fk_webhook_integration
  FOREIGN KEY (integration_config_id) REFERENCES crm_integrations(id) ON DELETE CASCADE;

SET @old_fk = (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_integration_error_logs'
    AND COLUMN_NAME = 'integration_config_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
  LIMIT 1
);
SET @ddl = IF(
  @old_fk IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE crm_integration_error_logs DROP FOREIGN KEY `', REPLACE(@old_fk, '`', '``'), '`')
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
ALTER TABLE crm_integration_error_logs
  ADD CONSTRAINT fk_error_log_integration
  FOREIGN KEY (integration_config_id) REFERENCES crm_integrations(id) ON DELETE CASCADE;

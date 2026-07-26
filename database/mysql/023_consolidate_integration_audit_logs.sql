-- Point integration audit records at the consolidated crm_integrations table.
SET @has_audit_integration_id = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_integration_audit_logs'
    AND COLUMN_NAME = 'integration_id'
);
SET @add_audit_integration_id_sql = IF(
  @has_audit_integration_id > 0,
  'SELECT 1',
  'ALTER TABLE crm_integration_audit_logs ADD COLUMN integration_id INT NULL AFTER id'
);
PREPARE add_audit_integration_id_statement FROM @add_audit_integration_id_sql;
EXECUTE add_audit_integration_id_statement;
DEALLOCATE PREPARE add_audit_integration_id_statement;

-- Preserve audit associations where the legacy ID also exists in crm_integrations.
UPDATE crm_integration_audit_logs audit_log
JOIN crm_integrations integration_record
  ON integration_record.id = audit_log.integration_config_id
SET audit_log.integration_id = integration_record.id
WHERE audit_log.integration_id IS NULL;

SET @legacy_audit_fk = (
  SELECT CONSTRAINT_NAME
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_integration_audit_logs'
    AND COLUMN_NAME = 'integration_config_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
  LIMIT 1
);
SET @drop_audit_fk_sql = IF(
  @legacy_audit_fk IS NULL,
  'SELECT 1',
  CONCAT(
    'ALTER TABLE crm_integration_audit_logs DROP FOREIGN KEY `',
    REPLACE(@legacy_audit_fk, '`', '``'),
    '`'
  )
);
PREPARE drop_audit_fk_statement FROM @drop_audit_fk_sql;
EXECUTE drop_audit_fk_statement;
DEALLOCATE PREPARE drop_audit_fk_statement;

ALTER TABLE crm_integration_audit_logs
  MODIFY integration_config_id INT NULL;

SET @current_audit_fk = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_integration_audit_logs'
    AND COLUMN_NAME = 'integration_id'
    AND REFERENCED_TABLE_NAME = 'crm_integrations'
);
SET @add_audit_fk_sql = IF(
  @current_audit_fk > 0,
  'SELECT 1',
  'ALTER TABLE crm_integration_audit_logs ADD CONSTRAINT fk_integration_audit_integration FOREIGN KEY (integration_id) REFERENCES crm_integrations(id) ON DELETE CASCADE'
);
PREPARE add_audit_fk_statement FROM @add_audit_fk_sql;
EXECUTE add_audit_fk_statement;
DEALLOCATE PREPARE add_audit_fk_statement;

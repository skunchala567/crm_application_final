-- Namespace every CRM-owned table in the shared attendance_biometric database.
-- This migration intentionally runs before all other CRM migrations:
--   * Existing installations rename their current physical tables first.
--   * Clean installations skip the rename and create crm_* tables directly.
-- RENAME TABLE preserves table data, indexes, and foreign-key relationships.

SET @previous_group_concat_max_len = @@SESSION.group_concat_max_len;
SET SESSION group_concat_max_len = 100000;

SET @crm_table_namespace_json = JSON_ARRAY(
  JSON_OBJECT('old_name', 'organizations', 'new_name', 'crm_organizations'),
  JSON_OBJECT('old_name', 'integrations', 'new_name', 'crm_integrations'),
  JSON_OBJECT('old_name', 'integration_configs', 'new_name', 'crm_integration_configs'),
  JSON_OBJECT('old_name', 'integration_hub_configs', 'new_name', 'crm_integration_hub_configs'),
  JSON_OBJECT('old_name', 'integration_oauth_tokens', 'new_name', 'crm_integration_oauth_tokens'),
  JSON_OBJECT('old_name', 'integration_sync_jobs', 'new_name', 'crm_integration_sync_jobs'),
  JSON_OBJECT('old_name', 'integration_sync_logs', 'new_name', 'crm_integration_sync_logs'),
  JSON_OBJECT('old_name', 'integration_field_mappings', 'new_name', 'crm_integration_field_mappings'),
  JSON_OBJECT('old_name', 'integration_webhooks', 'new_name', 'crm_integration_webhooks'),
  JSON_OBJECT('old_name', 'integration_webhook_logs', 'new_name', 'crm_integration_webhook_logs'),
  JSON_OBJECT('old_name', 'integration_error_logs', 'new_name', 'crm_integration_error_logs'),
  JSON_OBJECT('old_name', 'integration_errors', 'new_name', 'crm_integration_errors'),
  JSON_OBJECT('old_name', 'integration_audit_logs', 'new_name', 'crm_integration_audit_logs'),
  JSON_OBJECT('old_name', 'integration_skipped_leads', 'new_name', 'crm_integration_skipped_leads'),
  JSON_OBJECT('old_name', 'oauth_state_tokens', 'new_name', 'crm_oauth_state_tokens'),
  JSON_OBJECT('old_name', 'oauth_tokens', 'new_name', 'crm_oauth_tokens'),
  JSON_OBJECT('old_name', 'smartping_conversations', 'new_name', 'crm_smartping_conversations'),
  JSON_OBJECT('old_name', 'smartping_messages', 'new_name', 'crm_smartping_messages'),
  JSON_OBJECT('old_name', 'smartping_attachments', 'new_name', 'crm_smartping_attachments'),
  JSON_OBJECT('old_name', 'whatsapp_templates', 'new_name', 'crm_whatsapp_templates'),
  JSON_OBJECT('old_name', 'whatsapp_template_buttons', 'new_name', 'crm_whatsapp_template_buttons'),
  JSON_OBJECT('old_name', 'whatsapp_template_logs', 'new_name', 'crm_whatsapp_template_logs'),
  JSON_OBJECT('old_name', 'whatsapp_template_media', 'new_name', 'crm_whatsapp_template_media'),
  JSON_OBJECT('old_name', 'whatsapp_template_sync_logs', 'new_name', 'crm_whatsapp_template_sync_logs'),
  JSON_OBJECT('old_name', 'whatsapp_conversations', 'new_name', 'crm_whatsapp_conversations'),
  JSON_OBJECT('old_name', 'whatsapp_messages', 'new_name', 'crm_whatsapp_messages'),
  JSON_OBJECT('old_name', 'whatsapp_attachments', 'new_name', 'crm_whatsapp_attachments'),
  JSON_OBJECT('old_name', 'whatsapp_api_logs', 'new_name', 'crm_whatsapp_api_logs'),
  JSON_OBJECT('old_name', 'mse_admission_class_configuration', 'new_name', 'crm_admission_class_configurations'),
  JSON_OBJECT('old_name', 'mse_admission_class_configuration_details', 'new_name', 'crm_admission_class_configuration_details')
);

SELECT GROUP_CONCAT(
  CONCAT('`', REPLACE(namespace_map.old_name, '`', '``'), '` TO `',
    REPLACE(namespace_map.new_name, '`', '``'), '`')
  ORDER BY namespace_map.old_name
  SEPARATOR ', '
)
INTO @rename_pairs
FROM JSON_TABLE(
  @crm_table_namespace_json,
  '$[*]' COLUMNS (
    old_name VARCHAR(128) PATH '$.old_name',
    new_name VARCHAR(128) PATH '$.new_name'
  )
) namespace_map
JOIN information_schema.TABLES old_table
  ON old_table.TABLE_SCHEMA = DATABASE()
 AND old_table.TABLE_NAME = namespace_map.old_name
LEFT JOIN information_schema.TABLES new_table
  ON new_table.TABLE_SCHEMA = DATABASE()
 AND new_table.TABLE_NAME = namespace_map.new_name
WHERE new_table.TABLE_NAME IS NULL;

SET @rename_ddl = IF(
  @rename_pairs IS NULL,
  'SELECT 1',
  CONCAT('RENAME TABLE ', @rename_pairs)
);
PREPARE crm_namespace_statement FROM @rename_ddl;
EXECUTE crm_namespace_statement;
DEALLOCATE PREPARE crm_namespace_statement;

SET SESSION group_concat_max_len = @previous_group_concat_max_len;

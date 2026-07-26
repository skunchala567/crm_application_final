import mysql from 'mysql2/promise';

const database = process.env.MYSQL_DATABASE;
const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database
});

const renamedTables = [
  ['organizations', 'crm_organizations'],
  ['integrations', 'crm_integrations'],
  ['integration_configs', 'crm_integration_configs'],
  ['integration_hub_configs', 'crm_integration_hub_configs'],
  ['integration_oauth_tokens', 'crm_integration_oauth_tokens'],
  ['integration_sync_jobs', 'crm_integration_sync_jobs'],
  ['integration_sync_logs', 'crm_integration_sync_logs'],
  ['integration_field_mappings', 'crm_integration_field_mappings'],
  ['integration_webhooks', 'crm_integration_webhooks'],
  ['integration_webhook_logs', 'crm_integration_webhook_logs'],
  ['integration_error_logs', 'crm_integration_error_logs'],
  ['integration_errors', 'crm_integration_errors'],
  ['integration_audit_logs', 'crm_integration_audit_logs'],
  ['integration_skipped_leads', 'crm_integration_skipped_leads'],
  ['oauth_state_tokens', 'crm_oauth_state_tokens'],
  ['oauth_tokens', 'crm_oauth_tokens'],
  ['smartping_conversations', 'crm_smartping_conversations'],
  ['smartping_messages', 'crm_smartping_messages'],
  ['smartping_attachments', 'crm_smartping_attachments'],
  ['whatsapp_templates', 'crm_whatsapp_templates'],
  ['whatsapp_template_buttons', 'crm_whatsapp_template_buttons'],
  ['whatsapp_template_logs', 'crm_whatsapp_template_logs'],
  ['whatsapp_template_media', 'crm_whatsapp_template_media'],
  ['whatsapp_template_sync_logs', 'crm_whatsapp_template_sync_logs'],
  ['whatsapp_conversations', 'crm_whatsapp_conversations'],
  ['whatsapp_messages', 'crm_whatsapp_messages'],
  ['whatsapp_attachments', 'crm_whatsapp_attachments'],
  ['whatsapp_api_logs', 'crm_whatsapp_api_logs'],
  ['mse_admission_class_configuration', 'crm_admission_class_configurations'],
  ['mse_admission_class_configuration_details', 'crm_admission_class_configuration_details']
];

let failures = 0;

try {
  for (const [legacyName, crmName] of renamedTables) {
    const [[result]] = await connection.query(
      `SELECT
         SUM(TABLE_NAME = ?) AS legacy_count,
         SUM(TABLE_NAME = ?) AS crm_count
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME IN (?, ?)`,
      [legacyName, crmName, database, legacyName, crmName]
    );

    const legacyCount = Number(result.legacy_count || 0);
    const crmCount = Number(result.crm_count || 0);
    const passed = legacyCount === 0 && crmCount === 1;
    if (!passed) failures += 1;
    console.log(
      `${passed ? 'PASS' : 'FAIL'} ${legacyName} -> ${crmName}; `
      + `legacy=${legacyCount}; crm=${crmCount}`
    );
  }
} finally {
  await connection.end();
}

if (failures) {
  console.error(`CRM table namespace audit failed for ${failures} table(s).`);
  process.exitCode = 1;
} else {
  console.log(`CRM table namespace audit passed for ${renamedTables.length} tables.`);
}

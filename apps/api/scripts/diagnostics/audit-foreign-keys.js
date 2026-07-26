import mysql from 'mysql2/promise';

const database = process.env.MYSQL_DATABASE;
const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database
});

const expectedRelationships = [
  ['crm_leads', 'referred_to_branch_id', 'branches', 'id'],
  ['crm_integration_skipped_leads', 'integration_id', 'crm_integrations', 'id'],
  ['crm_integration_skipped_leads', 'branch_id', 'branches', 'id'],
  ['crm_integration_skipped_leads', 'existing_lead_id', 'crm_leads', 'id'],
  ['crm_whatsapp_conversations', 'organization_id', 'crm_organizations', 'id'],
  ['crm_whatsapp_conversations', 'integration_id', 'crm_integrations', 'id'],
  ['crm_whatsapp_conversations', 'lead_id', 'crm_leads', 'id'],
  ['crm_whatsapp_messages', 'conversation_id', 'crm_whatsapp_conversations', 'id'],
  ['crm_whatsapp_messages', 'integration_id', 'crm_integrations', 'id'],
  ['crm_whatsapp_messages', 'lead_id', 'crm_leads', 'id'],
  ['crm_whatsapp_templates', 'integration_id', 'crm_integrations', 'id'],
  ['crm_whatsapp_templates', 'organization_id', 'crm_organizations', 'id'],
  ['crm_smartping_conversations', 'integration_id', 'crm_integrations', 'id'],
  ['crm_smartping_messages', 'integration_id', 'crm_integrations', 'id'],
  ['crm_oauth_state_tokens', 'integration_id', 'crm_integrations', 'id'],
  ['crm_oauth_state_tokens', 'organization_id', 'crm_organizations', 'id'],
  ['crm_integration_oauth_tokens', 'integration_config_id', 'crm_integrations', 'id'],
  ['crm_integration_sync_jobs', 'integration_config_id', 'crm_integrations', 'id'],
  ['crm_integration_sync_logs', 'integration_config_id', 'crm_integrations', 'id'],
  ['crm_integration_field_mappings', 'integration_config_id', 'crm_integrations', 'id'],
  ['crm_integration_webhooks', 'integration_config_id', 'crm_integrations', 'id'],
  ['crm_integration_error_logs', 'integration_config_id', 'crm_integrations', 'id']
];

let failures = 0;

try {
  for (const [childTable, childColumn, parentTable, parentColumn] of expectedRelationships) {
    const [[foreignKey]] = await connection.query(
      `SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE CONSTRAINT_SCHEMA = ?
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?
         AND REFERENCED_TABLE_NAME IS NOT NULL
       LIMIT 1`,
      [database, childTable, childColumn]
    );

    const [[orphanResult]] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM \`${childTable}\` child_row
       LEFT JOIN \`${parentTable}\` parent_row
         ON parent_row.\`${parentColumn}\` = child_row.\`${childColumn}\`
       WHERE child_row.\`${childColumn}\` IS NOT NULL
         AND parent_row.\`${parentColumn}\` IS NULL`
    );

    const correctTarget = foreignKey
      && foreignKey.REFERENCED_TABLE_NAME === parentTable
      && foreignKey.REFERENCED_COLUMN_NAME === parentColumn;
    const orphanCount = Number(orphanResult.count || 0);
    const passed = correctTarget && orphanCount === 0;
    if (!passed) failures += 1;

    console.log(
      `${passed ? 'PASS' : 'FAIL'} ${childTable}.${childColumn} -> `
      + `${parentTable}.${parentColumn}; constraint=${foreignKey?.CONSTRAINT_NAME || 'missing'}; `
      + `actual=${foreignKey ? `${foreignKey.REFERENCED_TABLE_NAME}.${foreignKey.REFERENCED_COLUMN_NAME}` : 'none'}; `
      + `orphans=${orphanCount}`
    );
  }
} finally {
  await connection.end();
}

if (failures) {
  console.error(`Foreign-key audit failed for ${failures} relationship(s).`);
  process.exitCode = 1;
} else {
  console.log(`Foreign-key audit passed for ${expectedRelationships.length} relationships.`);
}

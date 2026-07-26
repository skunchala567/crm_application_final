import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: '43.205.46.211',
  port: 3306,
  user: 'sta_dc_user',
  password: 'OZQQP@VgZM=+K^5',
  database: 'attendance_biometric'
});

async function auditDatabase() {
  const conn = await pool.getConnection();
  try {
    console.log('\n========================================');
    console.log('DATABASE AUDIT - WhatsApp Integration');
    console.log('========================================\n');

    // 1. Check tables
    console.log('=== STEP 1: TABLE INVENTORY ===\n');
    const [tables] = await conn.query(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('crm_integrations', 'crm_whatsapp_templates', 'crm_whatsapp_template_logs', 'crm_organizations', 'settings', 'projects')"
    );

    tables.forEach(t => console.log(`✅ ${t.TABLE_NAME}`));
    console.log(`\nTotal relevant tables: ${tables.length}\n`);

    // 2. Check integrations table structure
    console.log('=== STEP 2: INTEGRATIONS TABLE SCHEMA ===\n');
    const [integrationsColumns] = await conn.query('DESCRIBE crm_integrations');
    integrationsColumns.forEach(c => {
      console.log(`${c.Field.padEnd(25)} ${c.Type.padEnd(20)} ${c.Null ? 'NULL' : 'NOT NULL'} ${c.Key ? `KEY(${c.Key})` : ''}`);
    });

    // 3. Check crm_whatsapp_templates table structure
    console.log('\n=== STEP 3: WHATSAPP_TEMPLATES TABLE SCHEMA ===\n');
    const [templatesColumns] = await conn.query('DESCRIBE crm_whatsapp_templates');
    templatesColumns.forEach(c => {
      console.log(`${c.Field.padEnd(25)} ${c.Type.padEnd(20)} ${c.Null ? 'NULL' : 'NOT NULL'} ${c.Key ? `KEY(${c.Key})` : ''}`);
    });

    // 4. Check foreign keys
    console.log('\n=== STEP 4: FOREIGN KEY CONSTRAINTS ===\n');
    const [fks] = await conn.query(
      `SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('crm_whatsapp_templates', 'crm_integrations', 'crm_whatsapp_template_logs')
       AND REFERENCED_TABLE_NAME IS NOT NULL`
    );

    if (fks.length === 0) {
      console.log('❌ NO FOREIGN KEYS FOUND');
    } else {
      fks.forEach(fk => {
        console.log(`✅ ${fk.TABLE_NAME}.${fk.COLUMN_NAME} → ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME} (${fk.CONSTRAINT_NAME})`);
      });
    }

    // 5. Check data
    console.log('\n=== STEP 5: DATA INVENTORY ===\n');

    const [[{intCount}]] = await conn.query('SELECT COUNT(*) as intCount FROM crm_integrations');
    console.log(`Integrations: ${intCount}`);

    const [[{tplCount}]] = await conn.query('SELECT COUNT(*) as tplCount FROM crm_whatsapp_templates WHERE deleted_at IS NULL');
    console.log(`WhatsApp Templates (active): ${tplCount}`);

    const [[{logCount}]] = await conn.query('SELECT COUNT(*) as logCount FROM crm_whatsapp_template_logs');
    console.log(`Template Logs: ${logCount}\n`);

    // 6. Check integration data
    if (intCount > 0) {
      console.log('=== STEP 6: INTEGRATION DATA ===\n');
      const [integrations] = await conn.query('SELECT id, name, type, status FROM crm_integrations LIMIT 5');
      integrations.forEach(i => {
        console.log(`ID: ${i.id} | Type: ${i.type} | Name: ${i.name} | Status: ${i.status}`);
      });
    }

  } finally {
    conn.release();
    await pool.end();
  }
}

auditDatabase();

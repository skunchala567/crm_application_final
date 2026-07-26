import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: '43.205.46.211',
  port: 3306,
  user: 'sta_dc_user',
  password: 'OZQQP@VgZM=+K^5',
  database: 'attendance_biometric'
});

(async () => {
  const conn = await pool.getConnection();
  try {
    console.log('\n=== DIRECT DB TEST: Get templates ===\n');

    const [templates] = await conn.query(
      'SELECT * FROM crm_whatsapp_templates WHERE organization_id = 1 AND integration_id = 1 AND deleted_at IS NULL'
    );

    console.log(`Found ${templates.length} templates\n`);

    templates.forEach((t, i) => {
      console.log(`Template ${i + 1}:`);
      console.log(`  ID: ${t.id}`);
      console.log(`  Name: ${t.template_name}`);
      console.log(`  Status: ${t.status}`);
      console.log(`  Body: ${t.body?.substring(0, 50) || 'NULL'}...`);
      console.log(`  buttons_json type: ${typeof t.buttons_json} = ${t.buttons_json}`);
      console.log(`  sample_values_json type: ${typeof t.sample_values_json} = ${t.sample_values_json}`);
      console.log(`  variables_list type: ${typeof t.variables_list} = ${t.variables_list}`);

      try {
        const parsed_buttons = JSON.parse(t.buttons_json || '[]');
        const parsed_sample = JSON.parse(t.sample_values_json || '{}');
        const parsed_vars = JSON.parse(t.variables_list || '[]');
        console.log(`  ✅ All JSON fields parse correctly`);
      } catch (e) {
        console.log(`  ❌ JSON parsing error: ${e.message}`);
      }
      console.log();
    });
  } finally {
    conn.release();
    await pool.end();
  }
})();

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
    console.log('\n=== RAW QUERY: Check what is actually stored ===\n');

    const [rows] = await conn.query(
      'SELECT id, template_name, CAST(buttons_json AS CHAR) as buttons_raw, CAST(sample_values_json AS CHAR) as sample_raw FROM crm_whatsapp_templates WHERE id IN (3, 4)'
    );

    rows.forEach(r => {
      console.log(`\nTemplate ID ${r.id}: ${r.template_name}`);
      console.log(`  buttons_raw (type ${typeof r.buttons_raw}): ${JSON.stringify(r.buttons_raw)}`);
      console.log(`  sample_raw (type ${typeof r.sample_raw}): ${JSON.stringify(r.sample_raw)}`);
    });
  } finally {
    conn.release();
    await pool.end();
  }
})();

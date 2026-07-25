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
    console.log('\n=== TEMPLATE CREATION VERIFICATION ===\n');

    const [templates] = await conn.query(
      'SELECT id, integration_id, template_name, status, created_at FROM whatsapp_templates WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5'
    );

    console.log(`✅ Total templates in database: ${templates.length}`);
    console.log('\nLatest templates:');
    templates.forEach((t, i) => {
      console.log(`\n  ${i + 1}. ${t.template_name}`);
      console.log(`     ID: ${t.id}`);
      console.log(`     Integration ID: ${t.integration_id}`);
      console.log(`     Status: ${t.status}`);
      console.log(`     Created: ${t.created_at}`);
    });

    console.log('\n=== ✅ DATABASE VERIFICATION COMPLETE ===\n');
  } finally {
    conn.release();
    await pool.end();
  }
})();

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
    const [integrations] = await conn.query(
      'SELECT id, name, type, project_id, project_api_password FROM integrations WHERE id = 1'
    );

    if (integrations.length > 0) {
      const int = integrations[0];
      console.log('\n✅ Integration Found:');
      console.log(`   ID: ${int.id}`);
      console.log(`   Name: ${int.name}`);
      console.log(`   Type: ${int.type}`);
      console.log(`   Project ID: ${int.project_id || 'NOT SET'}`);
      console.log(`   API Password: ${int.project_api_password ? '✅ SET' : '❌ NOT SET'}`);

      if (int.project_id === 'demo_project_12345') {
        console.log('\n⚠️  STILL USING TEST CREDENTIALS!');
        console.log('\nTo fix, run:');
        console.log(`   UPDATE integrations SET`);
        console.log(`   project_id = 'YOUR_REAL_AISENSY_PROJECT_ID',`);
        console.log(`   project_api_password = 'YOUR_REAL_AISENSY_API_PASSWORD'`);
        console.log(`   WHERE id = 1;`);
      } else if (int.project_id) {
        console.log('\n✅ Real credentials detected');
        console.log(`   Project ID starts with: ${int.project_id.substring(0, 10)}...`);
      }
    } else {
      console.log('❌ Integration not found');
    }
  } finally {
    conn.release();
    await pool.end();
  }
})();

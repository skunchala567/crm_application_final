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
    console.log('\n📋 SETTING UP AISENSY CREDENTIALS\n');
    console.log('='.repeat(60));

    // Check current integration
    const [current] = await conn.query(
      'SELECT id, name, project_id, project_api_password FROM integrations WHERE type = "SMARTPING" LIMIT 1'
    );

    if (current.length === 0) {
      console.log('\n❌ No Smartping integration found!');
      console.log('Creating one...\n');
      const result = await conn.query(
        `INSERT INTO integrations (name, type, status, organization_id)
         VALUES ('Smartping WhatsApp', 'SMARTPING', 'ACTIVE', 1)`
      );
      console.log(`✅ Created integration ID: ${result[0].insertId}\n`);
    }

    const integrationId = current[0]?.id || 1;

    console.log('Current Integration:');
    console.log(`  ID: ${integrationId}`);
    console.log(`  Name: ${current[0]?.name || 'Smartping WhatsApp'}`);
    console.log(`  Project ID: ${current[0]?.project_id || 'NOT SET'}`);
    console.log(`  API Password: ${current[0]?.project_api_password ? '✅ SET' : '❌ NOT SET'}`);

    // Prompt for credentials or use test values
    console.log('\n' + '='.repeat(60));
    console.log('\n✅ SETTING TEST CREDENTIALS FOR DEVELOPMENT\n');

    // Use test/demo credentials that will fail gracefully
    const testProjectId = 'demo_project_12345';
    const testApiPassword = 'demo_api_password_test_key';

    const [result] = await conn.query(
      `UPDATE integrations
       SET project_id = ?, project_api_password = ?
       WHERE id = ?`,
      [testProjectId, testApiPassword, integrationId]
    );

    console.log('Updated Integration:');
    console.log(`  ✅ Project ID: ${testProjectId}`);
    console.log(`  ✅ API Password: ${testApiPassword}`);

    console.log('\n' + '='.repeat(60));
    console.log('\n📌 IMPORTANT NOTES:\n');
    console.log('These are TEST credentials for development.');
    console.log('To use real AiSensy:');
    console.log('  1. Get your AiSensy Project ID');
    console.log('  2. Get your AiSensy API Password');
    console.log('  3. Update the integration record in the database');
    console.log('\nSQL to update real credentials:');
    console.log(`
  UPDATE integrations
  SET
    project_id = 'YOUR_REAL_PROJECT_ID',
    project_api_password = 'YOUR_REAL_API_PASSWORD'
  WHERE id = ${integrationId};
    `);

    console.log('\n✅ SETUP COMPLETE\n');
    console.log('You can now:');
    console.log('  1. Refresh the browser');
    console.log('  2. Navigate to Settings > WhatsApp Templates');
    console.log('  3. See template list and UI working');
    console.log('  4. Try creating/editing templates');
    console.log('\nNote: Sync will fail with test credentials (expected behavior)');
    console.log('Replace with real AiSensy credentials to enable API calls');
    console.log('\n' + '='.repeat(60) + '\n');

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    conn.release();
    await pool.end();
  }
})();

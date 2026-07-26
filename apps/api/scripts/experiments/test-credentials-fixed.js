import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE
});

(async () => {
  const conn = await pool.getConnection();
  try {
    console.log('\n🔐 Testing Credential Retrieval (FIXED):\n');

    // Simulate what _getIntegration now does
    const [configs] = await conn.query(
      `SELECT id, organization_id, config_json, provider_name
       FROM crm_integration_configs
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [3, 1]  // Using config record 3 which has AiSensy credentials
    );

    if (configs.length === 0) {
      console.log('❌ No config found');
      return;
    }

    const config = configs[0];
    console.log(`✅ Config found: ID ${config.id}, Provider: ${config.provider_name}`);

    let configData = {};
    try {
      configData = typeof config.config_json === 'string'
        ? JSON.parse(config.config_json)
        : config.config_json;
    } catch (e) {
      console.log('❌ Invalid JSON:', e.message);
      return;
    }

    console.log('\n📋 Parsed Config JSON:');
    console.log(`   projectId: ${configData.projectId}`);
    console.log(`   projectApiPassword: ${configData.projectApiPassword?.substring(0, 10)}...`);

    if (!configData.projectId || !configData.projectApiPassword) {
      console.log('\n❌ Missing credentials!');
      return;
    }

    const result = {
      id: config.id,
      project_id: configData.projectId,
      project_api_password: configData.projectApiPassword,
      provider_name: config.provider_name
    };

    console.log('\n✅ Successfully extracted credentials:');
    console.log(JSON.stringify(result, null, 2));

    console.log('\n✅ Ready for AiSensy API calls!');

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    conn.release();
    await pool.end();
  }
})();

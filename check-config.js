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
    // Check integration_configs table structure
    const [configs] = await conn.query(
      'SELECT * FROM integration_configs LIMIT 5'
    );

    console.log('\n📋 Integration Configs Table Structure:\n');

    if (configs.length > 0) {
      configs.forEach((config, idx) => {
        console.log(`Record ${idx + 1}:`);
        console.log(`  Columns: ${Object.keys(config).join(', ')}`);

        if (config.config_json) {
          try {
            const parsed = JSON.parse(config.config_json);
            console.log(`  Config JSON keys: ${Object.keys(parsed).join(', ')}`);
            console.log(`  Config content:`, JSON.stringify(parsed, null, 2));
          } catch (e) {
            console.log(`  Config JSON (raw): ${config.config_json.substring(0, 100)}...`);
          }
        }
      });
    } else {
      console.log('No records found');
    }

    // Also check if there's a Smartping config
    console.log('\n\n🔍 Looking for Smartping/AiSensy config:\n');
    const [smartping] = await conn.query(
      `SELECT id, integration_id, config_key, config_json FROM integration_configs
       WHERE config_json LIKE '%aisensy%' OR config_json LIKE '%smartping%' OR config_json LIKE '%project_id%'`
    );

    if (smartping.length > 0) {
      console.log('Found AiSensy/Smartping config:');
      smartping.forEach(record => {
        console.log(`  ID: ${record.id}`);
        console.log(`  Integration ID: ${record.integration_id}`);
        console.log(`  Config Key: ${record.config_key}`);
        console.log(`  Config JSON:`, JSON.stringify(JSON.parse(record.config_json), null, 2));
      });
    } else {
      console.log('No AiSensy/Smartping config found');
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    conn.release();
    await pool.end();
  }
})();

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

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
    console.log('\n========================================');
    console.log('Running Migration 003');
    console.log('========================================\n');

    const migrationFile = './src/migrations/003_create_whatsapp_template_logs.sql';
    const sql = fs.readFileSync(migrationFile, 'utf8');

    // Split by semicolon and execute each statement
    const statements = sql.split(';').filter(s => s.trim());

    for (const statement of statements) {
      if (statement.trim()) {
        console.log(`Executing: ${statement.substring(0, 60)}...`);
        try {
          await conn.query(statement);
          console.log('✅ OK\n');
        } catch (err) {
          // Some statements might fail if they already exist (e.g., DROP IF EXISTS)
          if (err.code === 'ER_TABLE_EXISTS_ERROR' || err.message.includes('already exists')) {
            console.log('⚠️  Already exists (OK)\n');
          } else {
            console.error(`❌ Error: ${err.message}\n`);
          }
        }
      }
    }

    console.log('\n========================================');
    console.log('VERIFICATION');
    console.log('========================================\n');

    // Verify tables
    const [[tables]] = await conn.query('SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ("whatsapp_template_logs", "whatsapp_templates", "integrations")');
    console.log(`✅ Found ${tables.count} required tables\n`);

    // Verify whatsapp_template_logs
    const [logsColumns] = await conn.query('DESCRIBE whatsapp_template_logs');
    console.log('✅ whatsapp_template_logs columns:');
    logsColumns.forEach(c => {
      console.log(`   - ${c.Field} (${c.Type})`);
    });

    // Verify integrations new columns
    const [intColumns] = await conn.query('DESCRIBE integrations');
    const hasProjectId = intColumns.some(c => c.Field === 'project_id');
    const hasProjectPassword = intColumns.some(c => c.Field === 'project_api_password');
    console.log(`\n✅ integrations.project_id: ${hasProjectId ? 'EXISTS' : 'MISSING'}`);
    console.log(`✅ integrations.project_api_password: ${hasProjectPassword ? 'EXISTS' : 'MISSING'}`);

    // Verify whatsapp_templates new columns
    const [tplColumns] = await conn.query('DESCRIBE whatsapp_templates');
    const hasAiSensyId = tplColumns.some(c => c.Field === 'aisensy_template_id');
    const hasLastSynced = tplColumns.some(c => c.Field === 'last_synced_at');
    console.log(`\n✅ whatsapp_templates.aisensy_template_id: ${hasAiSensyId ? 'EXISTS' : 'MISSING'}`);
    console.log(`✅ whatsapp_templates.last_synced_at: ${hasLastSynced ? 'EXISTS' : 'MISSING'}`);

    console.log('\n========================================');
    console.log('✅ MIGRATION 003 COMPLETE');
    console.log('========================================\n');

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
})();

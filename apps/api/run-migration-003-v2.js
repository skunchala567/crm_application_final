import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: '43.205.46.211',
  port: 3306,
  user: 'sta_dc_user',
  password: 'OZQQP@VgZM=+K^5',
  database: 'attendance_biometric'
});

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(`SHOW COLUMNS FROM ${table} LIKE '${column}'`);
  return rows.length > 0;
}

async function keyExists(conn, table, keyName) {
  const [rows] = await conn.query(
    `SELECT * FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_NAME = '${table}' AND INDEX_NAME = '${keyName}' AND TABLE_SCHEMA = DATABASE()`
  );
  return rows.length > 0;
}

(async () => {
  const conn = await pool.getConnection();
  try {
    console.log('\n========================================');
    console.log('Migration 003: Create WhatsApp Template Logs');
    console.log('========================================\n');

    // 1. Create whatsapp_template_logs table
    console.log('1️⃣  Creating whatsapp_template_logs table...');
    try {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_template_logs (
          id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          template_id INT NOT NULL,
          integration_id INT NOT NULL,
          aisensy_template_id VARCHAR(255) NOT NULL,
          action VARCHAR(50) NOT NULL,
          status VARCHAR(50),
          previous_status VARCHAR(50),
          rejection_reason LONGTEXT,
          rejection_category VARCHAR(100),
          api_request JSON,
          api_response JSON,
          last_synced_at TIMESTAMP NULL,
          webhook_received_at TIMESTAMP NULL,
          created_by INT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

          UNIQUE KEY unique_aisensy_template_id (aisensy_template_id),
          CONSTRAINT fk_template_logs_template
            FOREIGN KEY (template_id)
            REFERENCES whatsapp_templates(id)
            ON DELETE CASCADE,

          CONSTRAINT fk_template_logs_integration
            FOREIGN KEY (integration_id)
            REFERENCES integrations(id)
            ON DELETE CASCADE,

          KEY idx_aisensy_template_id (aisensy_template_id),
          KEY idx_template_id_synced (template_id, last_synced_at),
          KEY idx_action_created (action, created_at),
          KEY idx_status_created (status, created_at),
          KEY idx_integration_synced (integration_id, last_synced_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
      `);
      console.log('✅ Table created\n');
    } catch (err) {
      if (err.code === 'ER_TABLE_EXISTS_ERROR') {
        console.log('⚠️  Table already exists\n');
      } else {
        throw err;
      }
    }

    // 2. Add columns to integrations table
    console.log('2️⃣  Adding columns to integrations table...');

    if (!await columnExists(conn, 'integrations', 'project_id')) {
      await conn.query(`
        ALTER TABLE integrations
        ADD COLUMN project_id VARCHAR(255) COMMENT 'AiSensy Project ID'
      `);
      console.log('✅ Added project_id');
    } else {
      console.log('⚠️  project_id already exists');
    }

    if (!await columnExists(conn, 'integrations', 'project_api_password')) {
      await conn.query(`
        ALTER TABLE integrations
        ADD COLUMN project_api_password VARCHAR(500) COMMENT 'AiSensy API Password'
      `);
      console.log('✅ Added project_api_password');
    } else {
      console.log('⚠️  project_api_password already exists');
    }

    if (!await columnExists(conn, 'integrations', 'last_template_sync_at')) {
      await conn.query(`
        ALTER TABLE integrations
        ADD COLUMN last_template_sync_at TIMESTAMP NULL COMMENT 'Last template sync from AiSensy'
      `);
      console.log('✅ Added last_template_sync_at');
    } else {
      console.log('⚠️  last_template_sync_at already exists');
    }

    if (!await keyExists(conn, 'integrations', 'idx_project_id')) {
      await conn.query('ALTER TABLE integrations ADD KEY idx_project_id (project_id)');
      console.log('✅ Added idx_project_id');
    } else {
      console.log('⚠️  idx_project_id already exists');
    }
    console.log();

    // 3. Add columns to whatsapp_templates table
    console.log('3️⃣  Adding columns to whatsapp_templates table...');

    if (!await columnExists(conn, 'whatsapp_templates', 'aisensy_template_id')) {
      await conn.query(`
        ALTER TABLE whatsapp_templates
        ADD COLUMN aisensy_template_id VARCHAR(255) UNIQUE COMMENT 'AiSensy Template ID'
      `);
      console.log('✅ Added aisensy_template_id');
    } else {
      console.log('⚠️  aisensy_template_id already exists');
    }

    if (!await columnExists(conn, 'whatsapp_templates', 'message_action_type')) {
      await conn.query(`
        ALTER TABLE whatsapp_templates
        ADD COLUMN message_action_type VARCHAR(50) COMMENT 'QuickReplies or CTA'
      `);
      console.log('✅ Added message_action_type');
    } else {
      console.log('⚠️  message_action_type already exists');
    }

    if (!await columnExists(conn, 'whatsapp_templates', 'total_parameters')) {
      await conn.query(`
        ALTER TABLE whatsapp_templates
        ADD COLUMN total_parameters INT DEFAULT 0 COMMENT 'Count of {{n}} parameters'
      `);
      console.log('✅ Added total_parameters');
    } else {
      console.log('⚠️  total_parameters already exists');
    }

    if (!await columnExists(conn, 'whatsapp_templates', 'last_synced_at')) {
      await conn.query(`
        ALTER TABLE whatsapp_templates
        ADD COLUMN last_synced_at TIMESTAMP NULL COMMENT 'Last sync with AiSensy'
      `);
      console.log('✅ Added last_synced_at');
    } else {
      console.log('⚠️  last_synced_at already exists');
    }

    if (!await columnExists(conn, 'whatsapp_templates', 'call_to_action')) {
      await conn.query(`
        ALTER TABLE whatsapp_templates
        ADD COLUMN call_to_action JSON COMMENT 'CTA buttons from AiSensy'
      `);
      console.log('✅ Added call_to_action');
    } else {
      console.log('⚠️  call_to_action already exists');
    }

    if (!await columnExists(conn, 'whatsapp_templates', 'quick_replies')) {
      await conn.query(`
        ALTER TABLE whatsapp_templates
        ADD COLUMN quick_replies JSON COMMENT 'Quick reply options'
      `);
      console.log('✅ Added quick_replies');
    } else {
      console.log('⚠️  quick_replies already exists');
    }

    if (!await keyExists(conn, 'whatsapp_templates', 'idx_aisensy_template_id')) {
      await conn.query('ALTER TABLE whatsapp_templates ADD KEY idx_aisensy_template_id (aisensy_template_id)');
      console.log('✅ Added idx_aisensy_template_id');
    } else {
      console.log('⚠️  idx_aisensy_template_id already exists');
    }

    if (!await keyExists(conn, 'whatsapp_templates', 'idx_last_synced')) {
      await conn.query('ALTER TABLE whatsapp_templates ADD KEY idx_last_synced (integration_id, last_synced_at)');
      console.log('✅ Added idx_last_synced');
    } else {
      console.log('⚠️  idx_last_synced already exists');
    }
    console.log();

    // Verification
    console.log('========================================');
    console.log('VERIFICATION');
    console.log('========================================\n');

    const [[logsExists]] = await conn.query(`
      SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'whatsapp_template_logs'
    `);

    if (logsExists.count === 1) {
      console.log('✅ whatsapp_template_logs table exists');

      const [logsColumns] = await conn.query('SHOW COLUMNS FROM whatsapp_template_logs');
      console.log(`   Columns: ${logsColumns.length}\n`);
    } else {
      console.log('❌ whatsapp_template_logs table NOT found\n');
    }

    // Verify integrations columns
    console.log('✅ integrations table enhancements:');
    console.log(`   - project_id: ${await columnExists(conn, 'integrations', 'project_id') ? 'EXISTS' : 'MISSING'}`);
    console.log(`   - project_api_password: ${await columnExists(conn, 'integrations', 'project_api_password') ? 'EXISTS' : 'MISSING'}`);
    console.log(`   - last_template_sync_at: ${await columnExists(conn, 'integrations', 'last_template_sync_at') ? 'EXISTS' : 'MISSING'}\n`);

    // Verify whatsapp_templates columns
    console.log('✅ whatsapp_templates table enhancements:');
    console.log(`   - aisensy_template_id: ${await columnExists(conn, 'whatsapp_templates', 'aisensy_template_id') ? 'EXISTS' : 'MISSING'}`);
    console.log(`   - message_action_type: ${await columnExists(conn, 'whatsapp_templates', 'message_action_type') ? 'EXISTS' : 'MISSING'}`);
    console.log(`   - total_parameters: ${await columnExists(conn, 'whatsapp_templates', 'total_parameters') ? 'EXISTS' : 'MISSING'}`);
    console.log(`   - last_synced_at: ${await columnExists(conn, 'whatsapp_templates', 'last_synced_at') ? 'EXISTS' : 'MISSING'}`);
    console.log(`   - call_to_action: ${await columnExists(conn, 'whatsapp_templates', 'call_to_action') ? 'EXISTS' : 'MISSING'}`);
    console.log(`   - quick_replies: ${await columnExists(conn, 'whatsapp_templates', 'quick_replies') ? 'EXISTS' : 'MISSING'}\n`);

    console.log('========================================');
    console.log('✅ MIGRATION 003 COMPLETE');
    console.log('========================================\n');

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    console.error(err.sql);
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
})();

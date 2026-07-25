import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: '43.205.46.211',
  port: 3306,
  user: 'sta_dc_user',
  password: 'OZQQP@VgZM=+K^5',
  database: 'attendance_biometric',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function audit() {
  const conn = await pool.getConnection();

  try {
    console.log('\n=== 1. ORGANIZATIONS TABLE ===');
    const [orgs] = await conn.query('SELECT id, name, status FROM organizations WHERE id = 1');
    console.log('Org exists:', orgs.length > 0 ? '✅ YES' : '❌ NO');
    if (orgs.length > 0) console.log(orgs[0]);

    console.log('\n=== 2. INTEGRATIONS TABLE ===');
    const [integ] = await conn.query('SELECT id, organization_id, name, type, status FROM integrations WHERE id = 1');
    console.log('Integration exists:', integ.length > 0 ? '✅ YES' : '❌ NO');
    if (integ.length > 0) {
      console.log(integ[0]);
      console.log('Is SMARTPING:', integ[0].type === 'SMARTPING' ? '✅ YES' : '❌ NO');
    }

    console.log('\n=== 3. WHATSAPP_TEMPLATES TABLE ===');
    const [templates] = await conn.query('SELECT COUNT(*) as count FROM whatsapp_templates WHERE deleted_at IS NULL');
    console.log('Templates in DB:', templates[0].count);

    console.log('\n=== 4. FOREIGN KEY CONSTRAINTS ===');
    const [fks] = await conn.query(
      `SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'whatsapp_templates' AND REFERENCED_TABLE_NAME IS NOT NULL`
    );
    console.log('FK Constraints:', fks.length > 0 ? '✅ Found' : '❌ Missing');
    if (fks.length > 0) console.log(fks);

    console.log('\n=== SUMMARY ===');
    const [check] = await conn.query(`
      SELECT
        (SELECT COUNT(*) FROM organizations WHERE id = 1) as org_count,
        (SELECT COUNT(*) FROM integrations WHERE id = 1) as integ_count,
        (SELECT COUNT(*) FROM integrations WHERE id = 1 AND type = 'SMARTPING') as smartping_count
    `);
    const [c] = check;
    console.log(`✅ Organization exists: ${c.org_count > 0 ? 'YES' : 'NO'}`);
    console.log(`✅ Integration ID=1 exists: ${c.integ_count > 0 ? 'YES' : 'NO'}`);
    console.log(`✅ Integration is SMARTPING: ${c.smartping_count > 0 ? 'YES' : 'NO'}`);

    console.log('\n✅ DATABASE AUDIT COMPLETE\n');
  } catch (err) {
    console.error('\n❌ ERROR:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

audit();

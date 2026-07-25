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
    console.log('\nWhatsApp Templates Table Structure:\n');
    const [columns] = await conn.query('SHOW COLUMNS FROM whatsapp_templates');
    columns.forEach(c => {
      console.log(`  ${c.Field.padEnd(25)} ${c.Type.padEnd(20)} ${c.Null === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });
    console.log('\n');
  } finally {
    conn.release();
    await pool.end();
  }
})();

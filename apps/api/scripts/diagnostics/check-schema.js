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
    console.log('\nWhatsApp Templates Table Structure:\n');
    const [columns] = await conn.query('SHOW COLUMNS FROM crm_whatsapp_templates');
    columns.forEach(c => {
      console.log(`  ${c.Field.padEnd(25)} ${c.Type.padEnd(20)} ${c.Null === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });
    console.log('\n');
  } finally {
    conn.release();
    await pool.end();
  }
})();

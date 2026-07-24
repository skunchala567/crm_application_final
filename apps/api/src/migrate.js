import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

if (process.env.DEMO_MODE !== 'false') {
  throw new Error('Set DEMO_MODE=false before running the CRM database migration.');
}

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(here, '../../../database/mysql');
const migrationFiles = (await fs.readdir(migrationDirectory)).filter((file) => /^\d+.*\.sql$/i.test(file)).sort();
const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'attendance_app',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'attendance_biometric',
  multipleStatements: true,
});

try {
  for (const file of migrationFiles) {
    const sql = await fs.readFile(path.join(migrationDirectory, file), 'utf8');
    await connection.query(sql);
    console.log(`Applied ${file}`);
  }
  console.log('CRM migrations completed successfully. Existing attendance master data was preserved.');
} finally {
  await connection.end();
}

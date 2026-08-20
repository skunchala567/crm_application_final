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
/*
 * The database comes from the environment and nowhere else.
 *
 * Every migration used to open with `USE attendance_biometric`, which
 * outranked whatever this connection selected. On a deployment whose schema
 * carries another name that either stopped the run at the first file or --
 * the worse outcome, because it looks like success -- built the CRM tables
 * in a different database while the application went on reading an empty
 * one. Missing columns then surface much later as `Unknown column` from a
 * screen nobody associates with migrations.
 *
 * Refusing to guess a default is the point: a typo in MYSQL_DATABASE should
 * stop here, not create a shadow schema.
 */
const targetDatabase = process.env.MYSQL_DATABASE;
if (!targetDatabase) {
  throw new Error('Set MYSQL_DATABASE to the schema these migrations should be applied to.');
}

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'attendance_app',
  password: process.env.MYSQL_PASSWORD || '',
  database: targetDatabase,
  multipleStatements: true,
});

// Named on screen before anything is written, so a run against the wrong
// host or schema is visible while it can still be stopped.
const [[live]] = await connection.query('SELECT DATABASE() AS db, @@hostname AS host');
console.log(`Migrating ${live.db} on ${live.host} (${migrationFiles.length} files)`);
if (live.db !== targetDatabase) {
  throw new Error(`Connected to ${live.db} but MYSQL_DATABASE is ${targetDatabase}`);
}

try {
  for (const file of migrationFiles) {
    const sql = await fs.readFile(path.join(migrationDirectory, file), 'utf8');
    try {
      await connection.query(sql);
    } catch (error) {
      throw new Error(`${file} failed: ${error.message}`, { cause: error });
    }
    console.log(`Applied ${file}`);
  }
  console.log(`CRM migrations completed successfully on ${live.db}. Existing attendance master data was preserved.`);
} finally {
  await connection.end();
}

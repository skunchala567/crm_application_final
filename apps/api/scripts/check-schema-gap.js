import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

/*
 * Which tables and columns the migrations define, and which of them the
 * connected database is actually missing.
 *
 * Read-only. It exists because a schema that is behind does not announce
 * itself -- it works for weeks and then fails as `Unknown column` from one
 * screen, which reads as a bug in that screen rather than a database that was
 * never migrated. Run this against a deployment to see the gap up front.
 *
 * The expectation is parsed from the migration files rather than kept in a
 * list here, so it cannot drift from what the migrations actually create.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(here, '../../../database/mysql');

const files = (await fs.readdir(migrationDirectory))
  .filter((file) => /^\d+.*\.sql$/i.test(file)).sort();

/* Tables and columns named by CREATE TABLE / ADD COLUMN, with the migration
   that introduces each, so a gap points at the file that closes it.

   Files are walked in order and a later DROP removes what an earlier file
   added: several things here are deliberately created and then retired --
   crm_lead_media in 005 is gone by 013 -- and reporting those as missing
   would train everyone to ignore the output. */
const expectedTables = new Map();
const expectedColumns = new Map();

/* Comments are stripped first. These migrations discuss their own DDL in
   prose, and `CREATE TABLE IF NOT EXISTS` inside a comment otherwise parses
   as a table named IF. */
const stripComments = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*--.*$/gm, ' ');

for (const file of files) {
  const sql = stripComments(await fs.readFile(path.join(migrationDirectory, file), 'utf8'));

  for (const m of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`?(\w+)`?\s*\(/gi)) {
    if (!expectedTables.has(m[1])) expectedTables.set(m[1], file);
  }
  for (const m of sql.matchAll(/DROP TABLE\s+(?:IF EXISTS\s+)?`?(\w+)`?/gi)) {
    expectedTables.delete(m[1]);
    for (const key of [...expectedColumns.keys()]) {
      if (key.startsWith(`${m[1]}.`)) expectedColumns.delete(key);
    }
  }

  /* ALTER TABLE x ... ADD COLUMN y, including the quoted form these
     migrations build for PREPARE. One ALTER may add several columns. */
  for (const m of sql.matchAll(/ALTER TABLE\s+`?(\w+)`?([\s\S]*?)(?=ALTER TABLE|CREATE TABLE|DROP TABLE|\n\s*SET @|\n\s*PREPARE|$)/gi)) {
    const table = m[1];
    for (const c of m[2].matchAll(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?`?(\w+)`?/gi)) {
      const key = `${table}.${c[1]}`;
      if (!expectedColumns.has(key)) expectedColumns.set(key, file);
    }
    for (const c of m[2].matchAll(/DROP COLUMN\s+(?:IF EXISTS\s+)?`?(\w+)`?/gi)) {
      expectedColumns.delete(`${table}.${c[1]}`);
    }
  }
}

const database = process.env.MYSQL_DATABASE;
if (!database) throw new Error('Set MYSQL_DATABASE to the schema you want to check.');

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database,
});

const [[live]] = await connection.query('SELECT DATABASE() AS db, @@hostname AS host');
console.log(`Checking ${live.db} on ${live.host}\n`);

const [tableRows] = await connection.query(
  'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()');
const [columnRows] = await connection.query(
  'SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE()');
await connection.end();

const haveTables = new Set(tableRows.map((r) => r.t));
const haveColumns = new Set(columnRows.map((r) => `${r.t}.${r.c}`));

const missingTables = [...expectedTables].filter(([t]) => !haveTables.has(t));
// A column in a table that does not exist is already covered by that table.
const missingColumns = [...expectedColumns]
  .filter(([key]) => !haveColumns.has(key) && haveTables.has(key.split('.')[0]));

for (const [label, rows] of [['table', missingTables], ['column', missingColumns]]) {
  if (!rows.length) { console.log(`No missing ${label}s.`); continue; }
  console.log(`Missing ${rows.length} ${label}${rows.length === 1 ? '' : 's'}:`);
  for (const [name, file] of rows) console.log(`  ${name.padEnd(52)} ${file}`);
  console.log();
}

if (missingTables.length || missingColumns.length) {
  const behind = [...new Set([...missingTables, ...missingColumns].map(([, f]) => f))].sort();
  console.log(`Run: npm run migrate   (${behind.length} migration${behind.length === 1 ? '' : 's'} not applied, from ${behind[0]})`);
  process.exitCode = 1;
} else {
  console.log('Schema is up to date with the migrations.');
}

#!/usr/bin/env node
/**
 * Verifies a generated MariaDB export against the live source database.
 *
 *   node apps/api/scripts/export/verify-mariadb-export.js
 *   node apps/api/scripts/export/verify-mariadb-export.js --file path/to/export.sql
 *
 * Three checks:
 *   1. Coverage  - every managed table has a DROP and a CREATE.
 *   2. Row count - tuples in the file match COUNT(*) on the source.
 *   3. Content   - the SERVER evaluates the exported value literals and the
 *                  resulting content hash is compared against the same hash
 *                  computed over the live table. This is what proves the
 *                  escaping of text, JSON, binary and datetime values.
 *
 * Read-only. Issues no DDL and writes nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const FILE = path.resolve(REPO_ROOT, opt('file', 'database/exports/MARIADB_1011_FULL_EXPORT.sql'));

/** Rows per literal-evaluation query. Keeps statements well under any packet limit. */
const CHUNK = 200;

const SHARED_TABLES = [
  'branches', 'employees', 'app_users', 'roles',
  'role_permissions', 'role_screen_access', 'user_branches', 'user_roles',
];

const BINARY_TYPES = new Set([
  'binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob',
]);

function loadEnv() {
  const env = {};
  const text = fs.readFileSync(path.join(REPO_ROOT, 'apps/api/.env'), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

/** Pull every INSERT apart into per-row arrays of raw value literals. */
function parseInserts(text) {
  const byTable = new Map();
  const head = /INSERT INTO `([^`]+)` \(([^)]*)\) VALUES\n/g;
  let m;

  while ((m = head.exec(text)) !== null) {
    const table = m[1];
    const columns = m[2].split(',').map((c) => c.trim().replace(/`/g, ''));
    const rows = [];

    let i = head.lastIndex;
    let depth = 0;
    let inString = false;
    let quote = '';
    let current = null;
    let field = '';

    for (; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        field += ch;
        if (ch === '\\') { field += text[i + 1]; i++; continue; }
        if (ch === quote) inString = false;
        continue;
      }
      if (ch === "'" || ch === '"') { inString = true; quote = ch; field += ch; continue; }
      if (ch === '(') {
        depth++;
        if (depth === 1) { current = []; field = ''; continue; }
        field += ch; continue;
      }
      if (ch === ')') {
        depth--;
        if (depth === 0) { current.push(field.trim()); rows.push(current); current = null; field = ''; continue; }
        field += ch; continue;
      }
      if (ch === ',' && depth === 1) { current.push(field.trim()); field = ''; continue; }
      if (ch === ';' && depth === 0) break;
      if (depth >= 1) field += ch;
    }
    head.lastIndex = i;

    if (!byTable.has(table)) byTable.set(table, { columns, rows: [] });
    byTable.get(table).rows.push(...rows);
  }
  return byTable;
}

async function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`No export at ${FILE}. Run export-mariadb.js first.`);
    process.exit(1);
  }
  const sql = fs.readFileSync(FILE, 'utf8');
  const parsed = parseInserts(sql);

  const env = loadEnv();
  const conn = await mysql.createConnection({
    host: env.MYSQL_HOST,
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    connectTimeout: 30000,
    charset: 'utf8mb4',
    // 64-bit hashes must not round-trip through a JS double.
    supportBigNumbers: true,
    bigNumberStrings: true,
  });

  const [columnRows] = await conn.query(
    `SELECT TABLE_NAME tableName, COLUMN_NAME name, DATA_TYPE dataType
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, ORDINAL_POSITION`
  );
  const typeOf = new Map(columnRows.map((c) => [`${c.tableName}.${c.name}`, c.dataType]));

  const [tableRows] = await conn.query(
    `SELECT TABLE_NAME name FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
  );
  const managed = tableRows
    .map((t) => t.name)
    .filter((n) => n.startsWith('crm_') || SHARED_TABLES.includes(n));

  // --- 1. coverage ---------------------------------------------------------
  const dropped = new Set([...sql.matchAll(/^DROP TABLE IF EXISTS `([^`]+)`/gm)].map((m) => m[1]));
  const created = new Set([...sql.matchAll(/^CREATE TABLE `([^`]+)`/gm)].map((m) => m[1]));
  const missingDrop = managed.filter((t) => !dropped.has(t));
  const missingCreate = managed.filter((t) => !created.has(t));

  // --- 2 & 3. row counts and content --------------------------------------
  // BIT_XOR is order independent, so row order never matters. The CAST to
  // UNSIGNED is required: MySQL 8 applies BIT_XOR to a CONV() string as a
  // byte-string XOR, which is sensitive to the column's declared width.
  const asText = (expr, dataType) =>
    `IFNULL(${BINARY_TYPES.has(dataType) ? `HEX(${expr})` : `CAST(${expr} AS CHAR)`}, '<<NULL>>')`;
  const rowHash = (parts) =>
    `CAST(CONV(SUBSTRING(MD5(CONCAT_WS('\\x1f', ${parts.join(', ')})), 1, 16), 16, 10) AS UNSIGNED)`;

  const failures = [];
  let rowsCompared = 0;

  for (const [table, { columns, rows }] of parsed) {
    const types = columns.map((c) => typeOf.get(`${table}.${c}`));

    const [[live]] = await conn.query(
      `SELECT COUNT(*) n, BIT_XOR(${rowHash(columns.map((c, i) => asText(`\`${c}\``, types[i])))}) h
         FROM \`${table}\``
    );

    let exportHash = 0n;
    for (let start = 0; start < rows.length; start += CHUNK) {
      const selects = rows.slice(start, start + CHUNK).map(
        (r) => `SELECT ${rowHash(r.map((lit, i) => asText(lit, types[i])))} h`
      );
      const [[chunk]] = await conn.query(
        `SELECT BIT_XOR(h) x FROM (${selects.join(' UNION ALL ')}) t`
      );
      exportHash ^= BigInt(String(chunk.x ?? 0));
    }

    const liveCount = Number(String(live.n));
    const liveHash = BigInt(String(live.h ?? 0));
    if (liveCount !== rows.length) {
      failures.push(`${table}: ${liveCount} rows live, ${rows.length} in export`);
    } else if (liveHash !== exportHash) {
      failures.push(`${table}: content hash ${liveHash} live, ${exportHash} in export`);
    }
    rowsCompared += rows.length;
  }

  // Tables that hold rows but produced no INSERT at all.
  for (const table of managed) {
    if (parsed.has(table)) continue;
    const [[c]] = await conn.query(`SELECT COUNT(*) n FROM \`${table}\``);
    if (Number(String(c.n)) > 0) failures.push(`${table}: ${c.n} rows live, absent from export`);
  }

  await conn.end();

  console.log(`export : ${FILE}`);
  console.log(`managed tables      : ${managed.length}`);
  console.log(`DROP / CREATE       : ${dropped.size} / ${created.size}`);
  console.log(`missing DROP        : ${missingDrop.join(', ') || 'none'}`);
  console.log(`missing CREATE      : ${missingCreate.join(', ') || 'none'}`);
  console.log(`tables with data    : ${parsed.size}`);
  console.log(`rows compared       : ${rowsCompared}`);
  console.log(`content mismatches  : ${failures.length}`);
  failures.forEach((f) => console.log(`  ${f}`));

  const ok = !failures.length && !missingDrop.length && !missingCreate.length;
  console.log(ok ? '\nOK - export matches the source database.' : '\nFAILED');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('Verification failed:', err.message);
  process.exit(1);
});

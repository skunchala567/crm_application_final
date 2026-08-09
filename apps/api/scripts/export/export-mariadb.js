#!/usr/bin/env node
/**
 * MariaDB 10.11 export generator.
 *
 * Reads the live MySQL 8 schema + data and writes a single self-contained .sql
 * file that provisions the same database on MariaDB 10.11.
 *
 *   node apps/api/scripts/export/export-mariadb.js
 *   node apps/api/scripts/export/export-mariadb.js --schema-only
 *   node apps/api/scripts/export/export-mariadb.js --include-attendance
 *   node apps/api/scripts/export/export-mariadb.js --out path/to/file.sql
 *
 * Behaviour
 *   - DROP TABLE IF EXISTS + CREATE for the CRM-owned tables and the shared
 *     identity/master tables the CRM has foreign keys into.
 *   - CREATE TABLE IF NOT EXISTS (never dropped, no data) for attendance-only
 *     tables, unless --include-attendance is passed.
 *   - AUTO_INCREMENT=<n> is stripped from every CREATE TABLE, so a table that
 *     receives no rows starts its sequence at 1. Populated tables get an
 *     explicit ALTER TABLE ... AUTO_INCREMENT = MAX(id)+1 after their data.
 *   - Row IDs are written explicitly and are NOT renumbered, so every foreign
 *     key, JSON payload reference and audit-log target id stays valid.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { escape as escapeValue } from 'mysql2';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TARGET_COLLATION = 'utf8mb4_unicode_ci';
const SOURCE_COLLATION = /utf8mb4_0900_ai_ci/g; // MySQL-8-only, absent in MariaDB

/** Shared identity/master tables the CRM has foreign keys into or seeds. */
const SHARED_TABLES = [
  'branches',
  'employees',
  'app_users',
  'roles',
  'role_permissions',
  'role_screen_access',
  'user_branches',
  'user_roles',
];

/** Rows-per-INSERT and bytes-per-INSERT ceilings. */
const ROWS_PER_INSERT = 200;
const BYTES_PER_INSERT = 512 * 1024;
const SELECT_PAGE_SIZE = 5000;

const NUMERIC_TYPES = new Set([
  'tinyint', 'smallint', 'mediumint', 'int', 'bigint',
  'decimal', 'float', 'double', 'year',
]);
const BINARY_TYPES = new Set([
  'binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob',
]);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const SCHEMA_ONLY = flag('schema-only');
const INCLUDE_ATTENDANCE = flag('include-attendance');
const OUT_FILE = path.resolve(
  REPO_ROOT,
  opt('out', 'database/exports/MARIADB_1011_FULL_EXPORT.sql')
);

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

function loadEnv() {
  const envPath = path.join(REPO_ROOT, 'apps/api/.env');
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

// ---------------------------------------------------------------------------
// DDL translation: MySQL 8 -> MariaDB 10.11
// ---------------------------------------------------------------------------

function translateTableDdl(ddl, { ifNotExists }) {
  let out = ddl;

  // MySQL 8 default collation does not exist in MariaDB.
  out = out.replace(SOURCE_COLLATION, TARGET_COLLATION);

  // Drop the baked-in sequence position so empty tables begin at 1.
  out = out.replace(/\s+AUTO_INCREMENT=\d+/g, '');

  // Version-gated optimiser hints MariaDB would parse as literal SQL.
  out = out.replace(/\/\*!80\d{3} ([^*]*)\*\//g, '$1');

  if (ifNotExists) {
    out = out.replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS ');
  }
  return out;
}

function translateViewDdl(ddl) {
  let out = ddl.replace(SOURCE_COLLATION, TARGET_COLLATION);

  // The source DEFINER account will not exist on the target server.
  out = out.replace(/DEFINER=`[^`]*`@`[^`]*`\s*/g, '');
  out = out.replace(/SQL SECURITY DEFINER/g, 'SQL SECURITY INVOKER');
  out = out.replace(/^CREATE /, 'CREATE OR REPLACE ');
  return out;
}

// ---------------------------------------------------------------------------
// Value formatting
// ---------------------------------------------------------------------------

function formatValue(buf, column) {
  if (buf === null || buf === undefined) return 'NULL';

  if (BINARY_TYPES.has(column.dataType)) {
    return buf.length === 0 ? "''" : `0x${buf.toString('hex')}`;
  }

  const text = buf.toString('utf8');

  if (column.dataType === 'bit') {
    let bits = '';
    for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
    return `b'${bits.replace(/^0+(?=\d)/, '')}'`;
  }

  // Emit numbers unquoted when the server gave us a well-formed literal.
  if (NUMERIC_TYPES.has(column.dataType) && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(text)) {
    return text;
  }

  return escapeValue(text);
}

// ---------------------------------------------------------------------------
// Schema introspection
// ---------------------------------------------------------------------------

async function readObjects(conn) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME AS name, TABLE_TYPE AS type
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME`
  );
  return rows;
}

async function readColumns(conn) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, DATA_TYPE AS dataType,
            EXTRA AS extra, ORDINAL_POSITION AS position
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, ORDINAL_POSITION`
  );
  const byTable = new Map();
  for (const r of rows) {
    if (!byTable.has(r.tableName)) byTable.set(r.tableName, []);
    byTable.get(r.tableName).push(r);
  }
  return byTable;
}

async function readPrimaryKeys(conn) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'PRIMARY'
      ORDER BY TABLE_NAME, ORDINAL_POSITION`
  );
  const byTable = new Map();
  for (const r of rows) {
    if (!byTable.has(r.tableName)) byTable.set(r.tableName, []);
    byTable.get(r.tableName).push(r.name);
  }
  return byTable;
}

async function readForeignKeys(conn) {
  const [rows] = await conn.query(
    `SELECT DISTINCT TABLE_NAME AS child, REFERENCED_TABLE_NAME AS parent
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IS NOT NULL`
  );
  return rows;
}

/**
 * Parents before children.
 *
 * The schema contains a genuine cycle (branches.application_stage_id points at
 * crm_lead_stages, while the crm_* tables point back at branches), so a perfect
 * order does not exist and FOREIGN_KEY_CHECKS=0 is required either way. When no
 * table is ready we break the smallest edge we can -- the table with the fewest
 * unsatisfied parents -- rather than abandoning the ordering wholesale.
 */
function topoSort(tables, edges) {
  const present = new Set(tables);
  const parents = new Map(tables.map((t) => [t, new Set()]));
  for (const { child, parent } of edges) {
    if (child === parent) continue;
    if (present.has(child) && present.has(parent)) parents.get(child).add(parent);
  }

  const ordered = [];
  const emitted = new Set();
  const brokenEdges = [];
  let remaining = [...tables].sort();

  const unresolved = (t) => [...parents.get(t)].filter((p) => !emitted.has(p));

  while (remaining.length) {
    const ready = remaining.filter((t) => unresolved(t).length === 0);

    if (ready.length) {
      ready.forEach((t) => { ordered.push(t); emitted.add(t); });
    } else {
      // Cycle: force out the least-blocked table and record what we broke.
      let best = remaining[0];
      for (const t of remaining) {
        if (unresolved(t).length < unresolved(best).length) best = t;
      }
      unresolved(best).forEach((p) => brokenEdges.push({ child: best, parent: p }));
      ordered.push(best);
      emitted.add(best);
    }
    remaining = remaining.filter((t) => !emitted.has(t));
  }
  return { ordered, brokenEdges };
}

// ---------------------------------------------------------------------------
// Data export
// ---------------------------------------------------------------------------

async function* readRows(conn, table, columns, primaryKey) {
  const columnList = columns.map((c) => `\`${c.name}\``).join(', ');
  // Paging without a deterministic order can duplicate or skip rows.
  const orderBy = primaryKey.length
    ? ` ORDER BY ${primaryKey.map((c) => `\`${c}\``).join(', ')}`
    : '';
  let offset = 0;

  for (;;) {
    const [rows] = await conn.query({
      sql: `SELECT ${columnList} FROM \`${table}\`${orderBy} LIMIT ${SELECT_PAGE_SIZE} OFFSET ${offset}`,
      rowsAsArray: true,
      typeCast: (field, next) => {
        const buf = field.buffer();
        return buf === null ? null : Buffer.from(buf);
      },
    });
    if (!rows.length) return;
    yield rows;
    if (rows.length < SELECT_PAGE_SIZE) return;
    offset += SELECT_PAGE_SIZE;
  }
}

async function writeTableData(conn, out, table, columns, primaryKey) {
  const columnList = columns.map((c) => `\`${c.name}\``).join(', ');
  const prefix = `INSERT INTO \`${table}\` (${columnList}) VALUES\n`;

  let batch = [];
  let bytes = 0;
  let total = 0;

  // Respect stream backpressure so a large table does not buffer in memory.
  const flush = async () => {
    if (!batch.length) return;
    const ok = out.write(prefix + batch.join(',\n') + ';\n');
    batch = [];
    bytes = 0;
    if (!ok) await new Promise((resolve) => out.once('drain', resolve));
  };

  for await (const page of readRows(conn, table, columns, primaryKey)) {
    for (const row of page) {
      const tuple = `(${row.map((v, i) => formatValue(v, columns[i])).join(',')})`;
      batch.push(tuple);
      bytes += tuple.length;
      total += 1;
      if (batch.length >= ROWS_PER_INSERT || bytes >= BYTES_PER_INSERT) await flush();
    }
  }
  await flush();
  return total;
}

async function autoIncrementReset(conn, table, columns) {
  const auto = columns.find((c) => /auto_increment/i.test(c.extra || ''));
  if (!auto) return null;
  const [[row]] = await conn.query(
    `SELECT COALESCE(MAX(\`${auto.name}\`), 0) + 1 AS next FROM \`${table}\``
  );
  return Number(row.next);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const env = loadEnv();
  const conn = await mysql.createConnection({
    host: env.MYSQL_HOST,
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    connectTimeout: 30000,
    charset: 'utf8mb4',
  });

  const [[info]] = await conn.query('SELECT VERSION() AS version, DATABASE() AS db');
  const objects = await readObjects(conn);
  const columnsByTable = await readColumns(conn);
  const primaryKeysByTable = await readPrimaryKeys(conn);
  const foreignKeys = await readForeignKeys(conn);

  const baseTables = objects.filter((o) => o.type === 'BASE TABLE').map((o) => o.name);
  const views = objects.filter((o) => o.type !== 'BASE TABLE').map((o) => o.name);

  const managed = baseTables.filter((t) => t.startsWith('crm_') || SHARED_TABLES.includes(t));
  const attendance = baseTables.filter((t) => !managed.includes(t));

  const { ordered: managedOrder, brokenEdges } = topoSort(managed, foreignKeys);
  const { ordered: attendanceOrder } = topoSort(attendance, foreignKeys);

  const dataTables = INCLUDE_ATTENDANCE ? [...managedOrder, ...attendanceOrder] : managedOrder;

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const out = fs.createWriteStream(OUT_FILE, { encoding: 'utf8' });
  const write = (s) => out.write(s);

  const rule = '-- ' + '='.repeat(74) + '\n';
  write(rule);
  write('-- ADMISSIONS CRM  |  MariaDB 10.11 EXPORT\n');
  write(rule);
  write('--\n');
  write(`--   Source server   : MySQL ${info.version}\n`);
  write(`--   Source database : ${info.db}\n`);
  write(`--   Target server   : MariaDB 10.11 (utf8mb4 / ${TARGET_COLLATION})\n`);
  write(`--   Managed tables  : ${managedOrder.length} (dropped and recreated, data included)\n`);
  write(`--   Untouched tables: ${attendanceOrder.length} attendance-only (CREATE IF NOT EXISTS`);
  write(INCLUDE_ATTENDANCE ? ', data included)\n' : ', no data)\n');
  write(`--   Views           : ${views.length}\n`);
  write(`--   Mode            : ${SCHEMA_ONLY ? 'SCHEMA ONLY' : 'SCHEMA + DATA'}\n`);
  write('--\n');
  write('-- MariaDB conversions applied to the MySQL 8 DDL:\n');
  write(`--   * utf8mb4_0900_ai_ci  ->  ${TARGET_COLLATION}  (MySQL-8-only collation)\n`);
  write('--   * AUTO_INCREMENT=<n> stripped from CREATE TABLE, so an empty table\n');
  write('--     starts at 1; populated tables get an explicit reset after their data.\n');
  write('--   * View DEFINER removed and SQL SECURITY switched to INVOKER.\n');
  write('--\n');
  write('-- Row IDs are written explicitly and are NOT renumbered, so foreign keys\n');
  write('-- and id references held inside JSON columns stay valid.\n');
  if (brokenEdges.length) {
    write('--\n');
    write('-- Tables are emitted parents-before-children, except for these circular\n');
    write('-- foreign keys, which no ordering can satisfy. FOREIGN_KEY_CHECKS = 0 is\n');
    write('-- what makes the script loadable, and is restored at the end:\n');
    for (const e of brokenEdges) write(`--   ${e.child}  ->  ${e.parent}\n`);
  }
  write(rule);
  write('\n');
  write('-- Target database (uncomment if it does not exist yet):\n');
  write('-- CREATE DATABASE IF NOT EXISTS `attendance_biometric`\n');
  write(`--   DEFAULT CHARACTER SET utf8mb4 COLLATE ${TARGET_COLLATION};\n`);
  write('-- USE `attendance_biometric`;\n');
  write('\n');
  write("SET NAMES utf8mb4;\n");
  write('SET @OLD_SQL_MODE = @@SQL_MODE;\n');
  write("SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';\n");
  write('SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;\n');
  write('SET FOREIGN_KEY_CHECKS = 0;\n');
  write('SET @OLD_UNIQUE_CHECKS = @@UNIQUE_CHECKS;\n');
  write('SET UNIQUE_CHECKS = 0;\n');
  write('SET @OLD_AUTOCOMMIT = @@AUTOCOMMIT;\n');
  write('SET AUTOCOMMIT = 0;\n');
  write('\n\n');

  // --- Section 1: drops -----------------------------------------------------
  write(rule);
  write(`-- SECTION 1 - DROP MANAGED TABLES (${managedOrder.length})\n`);
  write(rule);
  write('-- Children first. Attendance-only tables are deliberately not dropped.\n\n');
  for (const t of [...managedOrder].reverse()) {
    write(`DROP TABLE IF EXISTS \`${t}\`;\n`);
  }
  write('\n\n');

  // --- Section 2: managed table DDL ----------------------------------------
  write(rule);
  write(`-- SECTION 2 - CREATE MANAGED TABLES (${managedOrder.length})\n`);
  write(rule);
  write('-- Emitted parents-before-children.\n\n');
  for (const t of managedOrder) {
    const [[row]] = await conn.query(`SHOW CREATE TABLE \`${t}\``);
    write(`-- ${'-'.repeat(60)}\n-- ${t}\n-- ${'-'.repeat(60)}\n`);
    write(translateTableDdl(row['Create Table'], { ifNotExists: false }) + ';\n\n');
  }
  write('\n');

  // --- Section 3: attendance-only DDL --------------------------------------
  write(rule);
  write(`-- SECTION 3 - ATTENDANCE-ONLY TABLES (${attendanceOrder.length})\n`);
  write(rule);
  write('-- Owned by the Attendance system. Never dropped; created only when the\n');
  write('-- target database does not already have them.\n\n');
  for (const t of attendanceOrder) {
    const [[row]] = await conn.query(`SHOW CREATE TABLE \`${t}\``);
    write(`-- ${'-'.repeat(60)}\n-- ${t}\n-- ${'-'.repeat(60)}\n`);
    write(translateTableDdl(row['Create Table'], { ifNotExists: true }) + ';\n\n');
  }
  write('\n');

  // --- Section 4: data ------------------------------------------------------
  const rowCounts = [];
  if (!SCHEMA_ONLY) {
    write(rule);
    write(`-- SECTION 4 - DATA (${dataTables.length} tables)\n`);
    write(rule);
    write('\n');

    for (const t of dataTables) {
      const columns = columnsByTable.get(t) || [];
      const primaryKey = primaryKeysByTable.get(t) || [];
      process.stderr.write(`  data: ${t} ... `);
      write(`-- ${'-'.repeat(60)}\n-- ${t}\n-- ${'-'.repeat(60)}\n`);
      const n = await writeTableData(conn, out, t, columns, primaryKey);
      const next = await autoIncrementReset(conn, t, columns);
      if (next !== null) write(`ALTER TABLE \`${t}\` AUTO_INCREMENT = ${next};\n`);
      write(n === 0 ? '-- (no rows)\n\n' : '\n');
      rowCounts.push({ table: t, rows: n });
      process.stderr.write(`${n} rows\n`);
    }
    write('\n');
  }

  // --- Section 5: views -----------------------------------------------------
  if (views.length) {
    write(rule);
    write(`-- SECTION 5 - VIEWS (${views.length})\n`);
    write(rule);
    write('\n');
    for (const v of views) {
      const [[row]] = await conn.query(`SHOW CREATE VIEW \`${v}\``);
      write(translateViewDdl(row['Create View']) + ';\n\n');
    }
    write('\n');
  }

  write(rule);
  write('-- RESTORE SESSION STATE\n');
  write(rule);
  write('COMMIT;\n');
  write('SET AUTOCOMMIT = @OLD_AUTOCOMMIT;\n');
  write('SET UNIQUE_CHECKS = @OLD_UNIQUE_CHECKS;\n');
  write('SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;\n');
  write('SET SQL_MODE = @OLD_SQL_MODE;\n');

  await new Promise((resolve) => out.end(resolve));
  await conn.end();

  const totalRows = rowCounts.reduce((a, b) => a + b.rows, 0);
  const sizeMb = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2);
  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`  tables dropped/created : ${managedOrder.length}`);
  console.log(`  tables create-if-absent: ${attendanceOrder.length}`);
  console.log(`  views                  : ${views.length}`);
  console.log(`  rows                   : ${totalRows}`);
  console.log(`  size                   : ${sizeMb} MB`);
}

main().catch((err) => {
  console.error('Export failed:', err.message);
  process.exit(1);
});

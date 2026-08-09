#!/usr/bin/env node
/**
 * Issues an API key for a partner integration.
 *
 *   node --env-file=.env scripts/issue-partner-key.js smatbot "SmatBot AI voice" 1
 *
 * The key is printed once and never stored in readable form -- only its
 * SHA-256 hash goes to the database, so a leaked backup cannot be replayed
 * against the API. If it is lost, revoke and issue another.
 */
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';

const [partnerKey, label, unitArg] = process.argv.slice(2);
if (!partnerKey || !label) {
  console.error('usage: issue-partner-key.js <partner-key> "<label>" [businessUnitId]');
  process.exit(1);
}

const pool = await mysql.createConnection({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  timezone: '+05:30',
});

try {
  let unitId = Number(unitArg);
  if (!Number.isInteger(unitId) || unitId <= 0) {
    const [[unit]] = await pool.query(
      'SELECT id FROM crm_business_units WHERE is_active=TRUE ORDER BY is_default DESC, id LIMIT 1');
    unitId = Number(unit.id);
  }
  const [[unit]] = await pool.execute(
    'SELECT id, display_name AS name FROM crm_business_units WHERE id=?', [unitId]);
  if (!unit) throw new Error(`No business unit with id ${unitId}`);

  // 32 random bytes, prefixed so a key found in a log is identifiable.
  const secret = `${partnerKey}_${crypto.randomBytes(32).toString('base64url')}`;
  const hash = crypto.createHash('sha256').update(secret).digest('hex');

  await pool.execute(
    `INSERT INTO crm_partner_api_keys
       (business_unit_id, partner_key, label, key_hash, key_prefix, scopes)
     VALUES (?,?,?,?,?, 'lead.qualification.write')`,
    [unitId, partnerKey.slice(0, 60), label.slice(0, 120), hash, secret.slice(0, 12)],
  );

  console.log('\nAPI key issued. Copy it now -- it cannot be shown again.\n');
  console.log(`  partner        ${partnerKey}`);
  console.log(`  business unit  ${unit.name} (${unit.id})`);
  console.log(`  scopes         lead.qualification.write`);
  console.log(`\n  X-API-Key: ${secret}\n`);
} finally {
  await pool.end();
}

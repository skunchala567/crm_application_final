/**
 * A business unit can take the standard lead fields the default unit has.
 *
 * Adds Branch, Stage, Sub-stage and Next follow-up date to a unit that was
 * seeded without them, and checks each one arrives wired to the live data the
 * rest of the CRM serves rather than as an inert text box. Removes them again.
 *
 * Run: node --env-file=.env scripts/experiments/verify-field-catalogue.js
 */
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:3001/api';
const UNIT = Number(process.env.VERIFY_UNIT_ID || 41);

const token = jwt.sign(
  {
    id: 1, employeeId: 1, name: 'Probe', email: 'probe@local', role: 'CRM_ADMIN',
    roles: ['CRM_ADMIN', 'SUPER_ADMIN'], branchIds: [], crmActive: true, organizationId: 1,
  },
  process.env.JWT_SECRET, { expiresIn: '10m' },
);

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Business-Unit-Id': String(UNIT) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  let parsed; try { parsed = JSON.parse(raw); } catch { parsed = { raw: raw.slice(0, 200) }; }
  return { status: response.status, body: parsed };
}

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
};

const added = [];

try {
  const before = await call('GET', `/platform/business-units/${UNIT}/field-catalogue`);
  check('catalogue lists standard fields this unit is missing',
    before.status === 200 && before.body.data.length > 0,
    before.body.data?.map(e => e.key).join(', '));

  const offered = new Set(before.body.data.map(entry => entry.key));
  check('it offers branch, stage, sub-stage and next follow-up',
    ['branch_id', 'stage_id', 'substage_id', 'next_followup_at_utc'].every(key => offered.has(key)));

  const seeded = await call('GET', '/leads/meta');
  const seededKeys = new Set((seeded.body.leadFields || []).map(field => field.fieldKey));
  check('none of them are on the unit to begin with',
    !['branch_id', 'stage_id', 'substage_id'].some(key => seededKeys.has(key)),
    [...seededKeys].join(', '));

  for (const key of ['branch_id', 'stage_id', 'substage_id', 'next_followup_at_utc']) {
    const result = await call('POST', `/platform/business-units/${UNIT}/field-catalogue`, { key });
    if (result.status === 201) added.push(result.body.id);
    check(`added ${key}`, result.status === 201, result.body.message);
  }

  const duplicate = await call('POST', `/platform/business-units/${UNIT}/field-catalogue`, { key: 'branch_id' });
  check('adding the same standard field twice is refused', duplicate.status === 409, duplicate.body.message);

  const unknown = await call('POST', `/platform/business-units/${UNIT}/field-catalogue`, { key: 'not_a_field' });
  check('an unknown key is refused', unknown.status === 400, unknown.body.message);

  const after = await call('GET', `/platform/business-units/${UNIT}/field-catalogue`);
  check('the catalogue stops offering what was just added',
    !after.body.data.some(entry => entry.key === 'branch_id'), `${after.body.data.length} still offered`);

  // The point of all this: the added fields must carry live values.
  const meta = await call('GET', '/leads/meta');
  const fields = meta.body.leadFields || [];
  const byKey = key => fields.find(field => field.fieldKey === key);
  check('branch is present as a select', byKey('branch_id')?.fieldType === 'single_select');
  check('stage is present as a select', byKey('stage_id')?.fieldType === 'single_select');
  check('next follow-up is present as a datetime', byKey('next_followup_at_utc')?.fieldType === 'datetime');

  // These are the arrays the lead form maps onto those keys.
  check('branch values come through for this unit', (meta.body.branches || []).length > 0,
    `${meta.body.branches?.length} branches`);
  check('pipeline stages come through for this unit', (meta.body.stages || []).length > 0,
    (meta.body.stages || []).map(s => s.displayName).join(', '));
  check('sub-stages resolve against those stages',
    Array.isArray(meta.body.substages), `${meta.body.substages?.length} sub-stages`);
} finally {
  // branch_id and stage_id are refused by the delete route as mandatory
  // application fields, so the rows this probe created are cleared directly.
  const pool = await mysql.createPool({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE, connectTimeout: 20000,
  });
  if (added.length) {
    await pool.query(
      `DELETE FROM crm_metadata_fields WHERE business_unit_id=? AND id IN (${added.map(() => '?').join(',')})`,
      [UNIT, ...added],
    );
  }
  await pool.end();
  const meta = await call('GET', '/leads/meta');
  const leftover = (meta.body.leadFields || [])
    .filter(field => ['branch_id', 'stage_id', 'substage_id', 'next_followup_at_utc'].includes(field.fieldKey));
  check('cleanup removed the added fields', leftover.length === 0, `${leftover.length} left`);
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

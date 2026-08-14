/**
 * Proves a scoped CRM administrator cannot grant access beyond their own reach.
 *
 * Creates a throwaway CRM_ADMIN confined to one branch and one business unit,
 * then attempts every escalation the User Management surface offers, and
 * deletes the account afterwards. Nothing here is destructive to real users:
 * out-of-scope attempts are expected to be refused, and the only account
 * written is the temporary one.
 *
 * Run: node --env-file=.env scripts/experiments/verify-admin-scope.js
 */
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:3001/api';
const EMAIL = 'zz-scope-probe@local.invalid';

const pool = await mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  connectTimeout: 20000,
});

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
};

let probeId = null;
let outsiderId = null;

try {
  // --- pick a scope: one unit and one branch, plus one of each outside it ---
  const [units] = await pool.query('SELECT id FROM crm_business_units WHERE is_active=1 ORDER BY id');
  const [branches] = await pool.query('SELECT id FROM branches WHERE is_active=1 ORDER BY id LIMIT 10');
  if (units.length < 2 || branches.length < 2) {
    throw new Error('Need at least two active business units and branches to test scoping');
  }
  const inUnit = Number(units[0].id);
  const outUnit = Number(units[units.length - 1].id);
  const inBranch = Number(branches[0].id);
  const outBranch = Number(branches[branches.length - 1].id);

  // --- create the confined administrator ---------------------------------
  await pool.execute('DELETE FROM app_users WHERE normalized_email=?', [EMAIL.toUpperCase()]);
  const [created] = await pool.execute(
    `INSERT INTO app_users (employee_id,email,normalized_email,password_hash,security_stamp,is_active,created_at_utc)
     VALUES (NULL,?,?,?,?,TRUE,CURRENT_TIMESTAMP(6))`,
    [EMAIL, EMAIL.toUpperCase(), 'x', crypto.randomUUID()],
  );
  probeId = created.insertId;
  await pool.execute(
    `INSERT INTO user_roles (user_id,role_id,created_at_utc)
     SELECT ?,id,CURRENT_TIMESTAMP(6) FROM roles WHERE normalized_name='CRM_ADMIN'`,
    [probeId],
  );
  await pool.execute(
    'INSERT INTO crm_user_business_units (user_id,business_unit_id,access_level,is_default) VALUES (?,?,?,1)',
    [probeId, inUnit, 'admin'],
  );
  await pool.execute(
    'INSERT INTO crm_user_branches (user_id,branch_id,created_by_user_id) VALUES (?,?,?)',
    [probeId, inBranch, probeId],
  );

  // --- a colleague the probe has no authority over ------------------------
  const OUTSIDER = 'zz-outsider@local.invalid';
  await pool.execute('DELETE FROM app_users WHERE normalized_email=?', [OUTSIDER.toUpperCase()]);
  const [outsiderRow] = await pool.execute(
    `INSERT INTO app_users (employee_id,email,normalized_email,password_hash,security_stamp,is_active,created_at_utc)
     VALUES (NULL,?,?,?,?,TRUE,CURRENT_TIMESTAMP(6))`,
    [OUTSIDER, OUTSIDER.toUpperCase(), 'x', crypto.randomUUID()],
  );
  outsiderId = outsiderRow.insertId;
  await pool.execute(
    `INSERT INTO user_roles (user_id,role_id,created_at_utc)
     SELECT ?,id,CURRENT_TIMESTAMP(6) FROM roles WHERE normalized_name='COUNSELLOR'`,
    [outsiderId],
  );
  await pool.execute(
    'INSERT INTO crm_user_business_units (user_id,business_unit_id,access_level,is_default) VALUES (?,?,?,1)',
    [outsiderId, outUnit, 'contribute'],
  );
  await pool.execute(
    'INSERT INTO crm_user_branches (user_id,branch_id,created_by_user_id) VALUES (?,?,?)',
    [outsiderId, outBranch, outsiderId],
  );

  const token = jwt.sign(
    {
      id: probeId, employeeId: null, name: 'Scope Probe', email: EMAIL,
      role: 'CRM_ADMIN', roles: ['CRM_ADMIN'], branchIds: [inBranch],
      crmActive: true, organizationId: 1,
    },
    process.env.JWT_SECRET,
    { expiresIn: '10m' },
  );

  const call = async (method, path, body, unit = inUnit) => {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Business-Unit-Id': String(unit),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const raw = await response.text();
    let parsed; try { parsed = JSON.parse(raw); } catch { parsed = { raw: raw.slice(0, 160) }; }
    return { status: response.status, body: parsed };
  };

  // --- 1. the pickers offer only what may be granted ---------------------
  const meta = await call('GET', '/admin/users/meta');
  check('meta offers only the administrator\'s own branch',
    meta.status === 200 && meta.body.branches?.length === 1 && Number(meta.body.branches[0].id) === inBranch,
    `${meta.body.branches?.length} branches`);
  check('meta offers only the administrator\'s own business unit',
    meta.body.businessUnits?.length === 1 && Number(meta.body.businessUnits[0].id) === inUnit,
    `${meta.body.businessUnits?.length} units`);

  // --- 2. granting outside the scope is refused --------------------------
  const grantOutUnit = await call('POST', '/admin/users', {
    userType: 'external', firstName: 'Zz', lastName: 'Probe', email: 'zz-target@local.invalid',
    password: 'probe-password-1', roleName: 'COUNSELLOR',
    branchIds: [inBranch], businessUnitIds: [outUnit],
  });
  check('cannot grant a business unit outside the scope', grantOutUnit.status === 403, grantOutUnit.body.message);

  const grantOutBranch = await call('POST', '/admin/users', {
    userType: 'external', firstName: 'Zz', lastName: 'Probe', email: 'zz-target@local.invalid',
    password: 'probe-password-1', roleName: 'COUNSELLOR',
    branchIds: [outBranch], businessUnitIds: [inUnit],
  });
  check('cannot grant a branch outside the scope', grantOutBranch.status === 403, grantOutBranch.body.message);

  // --- 3. cannot act inside another business unit ------------------------
  // Tested against a route that actually resolves the unit: the /admin/users
  // endpoints sit behind requireUserAdmin, which never sets req.businessUnit.
  const ownUnitOk = await call('GET', '/branches', null, inUnit);
  check('can work inside their own business unit', ownUnitOk.status === 200, `status ${ownUnitOk.status}`);
  const otherUnit = await call('GET', '/branches', null, outUnit);
  check('cannot act inside a business unit they do not belong to', otherUnit.status === 403, otherUnit.body.message);

  // --- 4. the user list is scoped ---------------------------------------
  const list = await call('GET', '/admin/users');
  const ids = (list.body.data || []).map(row => Number(row.id));
  check('user list hides staff outside the scope', !ids.includes(Number(outsiderId)),
    `${ids.length} listed; outsider ${ids.includes(Number(outsiderId)) ? 'VISIBLE' : 'hidden'}`);
  check('user list still shows the administrator themselves', ids.includes(Number(probeId)));

  // --- 5. nor may they be touched ---------------------------------------
  const deactivate = await call('PUT', `/admin/users/${outsiderId}/status`, { isActive: false });
  check('cannot deactivate a user outside the scope', deactivate.status === 403, deactivate.body.message);

  const strip = await call('DELETE', `/admin/users/${outsiderId}/access`);
  check('cannot remove access from a user outside the scope', strip.status === 403, strip.body.message);

  const edit = await call('PUT', `/admin/users/${outsiderId}`, {
    userType: 'external', firstName: 'Zz', lastName: 'Outsider', email: 'zz-outsider@local.invalid',
    roleName: 'COUNSELLOR', branchIds: [inBranch], businessUnitIds: [inUnit],
  });
  check('cannot pull a user outside the scope into their own', edit.status === 403, edit.body.message);

  const [[stillThere]] = await pool.query(
    'SELECT COUNT(*) AS n FROM crm_user_branches WHERE user_id=? AND branch_id=?', [outsiderId, outBranch]);
  check('the outsider\'s access is untouched after those attempts', Number(stillThere.n) === 1);

  // --- 6. in-scope work still succeeds -----------------------------------
  check('reading the user list inside the scope still works', list.status === 200, `status ${list.status}`);
} finally {
  if (probeId) {
    await pool.execute('DELETE FROM crm_user_branches WHERE user_id=?', [probeId]);
    await pool.execute('DELETE FROM crm_user_business_units WHERE user_id=?', [probeId]);
    await pool.execute('DELETE FROM user_roles WHERE user_id=?', [probeId]);
    await pool.execute('DELETE FROM app_users WHERE id=?', [probeId]);
  }
  for (const id of [outsiderId].filter(Boolean)) {
    await pool.execute('DELETE FROM crm_user_branches WHERE user_id=?', [id]);
    await pool.execute('DELETE FROM crm_user_business_units WHERE user_id=?', [id]);
    await pool.execute('DELETE FROM user_roles WHERE user_id=?', [id]);
    await pool.execute('DELETE FROM app_users WHERE id=?', [id]);
  }
  await pool.execute('DELETE FROM app_users WHERE normalized_email=?', ['ZZ-TARGET@LOCAL.INVALID']);
  const [[left]] = await pool.query('SELECT COUNT(*) AS n FROM app_users WHERE normalized_email LIKE ?', ['ZZ-%@LOCAL.INVALID']);
  check('cleanup left no probe accounts', Number(left.n) === 0, `${left.n} left`);
  await pool.end();
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

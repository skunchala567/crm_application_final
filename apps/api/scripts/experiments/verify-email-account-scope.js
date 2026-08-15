/**
 * Email accounts are per branch, and a user only sees their branches'.
 *
 * Seeds two throwaway SMTP accounts mapped to different branches, then checks
 * what each kind of user is offered and that sending from an account outside
 * your branches is refused. Everything it creates is deleted afterwards.
 *
 * Run: node --env-file=.env scripts/experiments/verify-email-account-scope.js
 */
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:3001/api';
const tokenFor = (branchIds) => jwt.sign(
  { id: 1, employeeId: 1, name: 'Probe', email: 'probe@local', role: 'CRM_ADMIN',
    roles: ['CRM_ADMIN', 'SUPER_ADMIN'], branchIds, crmActive: true, organizationId: 1 },
  process.env.JWT_SECRET, { expiresIn: '10m' });

const call = async (branchIds, method, path, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(branchIds)}`, 'X-Business-Unit-Id': '1' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await r.text();
  let parsed; try { parsed = JSON.parse(raw); } catch { parsed = { raw: raw.slice(0, 140) }; }
  return { status: r.status, body: parsed };
};

const pool = await mysql.createPool({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE, connectTimeout: 20000,
});

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
};

const made = [];

try {
  const [branches] = await pool.query('SELECT id, branch_name FROM branches WHERE is_active=1 ORDER BY id LIMIT 2');
  const [first, second] = branches;

  for (const [name, from] of [['ZZ Probe Mail A', 'a@probe.invalid'], ['ZZ Probe Mail B', 'b@probe.invalid']]) {
    const [row] = await pool.execute(
      `INSERT INTO crm_integrations (organization_id, name, type, provider, status, config)
       VALUES (1, ?, 'EMAIL', 'smtp', 'CONNECTED', ?)`,
      [name, JSON.stringify({ enabled: true, smtpHost: 'smtp.probe.invalid', smtpPort: 587, encryption: 'tls', fromName: name, fromEmail: from })]);
    made.push(row.insertId);
  }
  const [accountA, accountB] = made;

  // A serves the first branch, B the second.
  await call([], 'PUT', `/email/accounts/${accountA}/branches`, { branchIds: [first.id] });
  await call([], 'PUT', `/email/accounts/${accountB}/branches`, { branchIds: [second.id] });

  const mapped = await call([], 'GET', `/email/accounts/${accountA}/branches`);
  check('an account lists the branches that use it',
    (mapped.body.data || []).some(b => Number(b.id) === Number(first.id)),
    (mapped.body.data || []).map(b => b.name).join(', '));

  // --- who sees what -----------------------------------------------------
  const admin = await call([], 'GET', '/email/accounts');
  const adminIds = (admin.body.data || []).map(a => a.id);
  check('an unrestricted admin sees every account',
    made.every(id => adminIds.includes(id)), `${adminIds.length} accounts`);

  const branchUser = await call([first.id], 'GET', '/email/accounts');
  const branchIds = (branchUser.body.data || []).map(a => a.id);
  check('a branch user sees their own branch account', branchIds.includes(accountA));
  check('and not another branch\'s', !branchIds.includes(accountB),
    `sees ${branchIds.join(', ') || 'none'}`);

  const otherUser = await call([second.id], 'GET', '/email/accounts');
  const otherIds = (otherUser.body.data || []).map(a => a.id);
  check('the reverse holds for the other branch',
    otherIds.includes(accountB) && !otherIds.includes(accountA), `sees ${otherIds.join(', ')}`);

  // --- sending from an account you may not use ---------------------------
  const refused = await call([first.id], 'POST', '/email/send', {
    integrationId: accountB, to: 'someone@probe.invalid', subject: 'probe', bodyHtml: '<p>probe</p>',
  });
  check('sending from another branch\'s account is refused', refused.status === 403, refused.body.message);

  // --- unmapping removes the offer ---------------------------------------
  await call([], 'PUT', `/email/accounts/${accountA}/branches`, { branchIds: [] });
  const afterUnmap = await call([first.id], 'GET', '/email/accounts');
  check('unmapping an account withdraws it from that branch',
    !(afterUnmap.body.data || []).map(a => a.id).includes(accountA),
    `${(afterUnmap.body.data || []).length} left`);
} finally {
  for (const id of made) {
    await pool.execute('DELETE FROM crm_branch_email_accounts WHERE integration_id=?', [id]);
    await pool.execute('DELETE FROM crm_integrations WHERE id=?', [id]);
  }
  const [[left]] = await pool.query("SELECT COUNT(*) n FROM crm_integrations WHERE name LIKE 'ZZ Probe Mail%'");
  check('cleanup removed the probe accounts', Number(left.n) === 0, `${left.n} left`);
  await pool.end();
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

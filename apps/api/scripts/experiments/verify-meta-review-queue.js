/**
 * Meta leads wait for review before becoming CRM leads.
 *
 * Stages two synthetic leads through the real endpoints: one approved, one
 * discarded. Checks that a waiting lead creates no crm_leads row, that its
 * answers are readable before the decision, and that approving creates the
 * lead while discarding does not. Everything it writes is removed afterwards.
 *
 * Run: node --env-file=.env scripts/experiments/verify-meta-review-queue.js
 */
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:3001/api';
const token = jwt.sign(
  { id: 1, employeeId: 1, name: 'Probe', email: 'probe@local', role: 'CRM_ADMIN',
    roles: ['CRM_ADMIN', 'SUPER_ADMIN'], branchIds: [], crmActive: true, organizationId: 1 },
  process.env.JWT_SECRET, { expiresIn: '10m' },
);
const call = async (method, path, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Business-Unit-Id': '1' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 200) }; }
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

const APPROVE = 'zz-review-approve';
const DISCARD = 'zz-review-discard';
const PHONE = '9100000123';

try {
  const [[form]] = await pool.query('SELECT form_id, page_id FROM crm_meta_forms LIMIT 1');
  if (!form) throw new Error('No Meta form configured to test against');

  const payload = (name, phone) => JSON.stringify({
    id: 'x', created_time: new Date().toISOString(), form_id: form.form_id,
    field_data: [
      { name: 'full_name', values: [name] },
      { name: 'phone_number', values: [`+91${phone}`] },
      { name: 'email', values: ['zz-probe@local.invalid'] },
    ],
  });

  // Stage both directly, the way a held poll pass leaves them.
  for (const [id, name] of [[APPROVE, 'ZZ Review Approve'], [DISCARD, 'ZZ Review Discard']]) {
    await pool.execute(
      `INSERT INTO crm_meta_lead_imports
         (leadgen_id, form_id, page_id, status, intake_source, attempts, meta_created_time, raw_payload)
       VALUES (?,?,?,'pending','poll',1,?,?)`,
      [id, form.form_id, form.page_id, Math.floor(Date.now() / 1000), payload(name, PHONE)],
    );
  }

  const [[before]] = await pool.query(
    'SELECT COUNT(*) n FROM crm_leads WHERE normalized_phone=? AND deleted_at_utc IS NULL', [PHONE]);
  check('a waiting lead has not created a CRM lead', Number(before.n) === 0, `${before.n} leads`);

  // --- the review list ---------------------------------------------------
  const pending = await call('GET', '/meta/imports/pending');
  const mine = (pending.body.data || []).filter(row => [APPROVE, DISCARD].includes(row.leadgenId));
  check('waiting leads are listed', pending.status === 200 && mine.length === 2, `${mine.length} of 2`);

  const sample = mine.find(row => row.leadgenId === APPROVE);
  check('their answers are readable before deciding',
    sample?.answers?.some(a => a.name === 'full_name' && a.value === 'ZZ Review Approve')
    && sample.answers.some(a => a.name === 'phone_number'),
    sample?.answers?.map(a => `${a.name}=${a.value}`).join(', '));
  check('the mapping is shown alongside', Boolean(sample?.mapped), JSON.stringify(sample?.mapped || {}));

  // --- approve -----------------------------------------------------------
  const approved = await call('POST', `/meta/imports/${APPROVE}/approve`, {});
  check('approving reports its outcome', approved.status === 200, JSON.stringify(approved.body.data || {}));
  const [[afterApprove]] = await pool.query(
    'SELECT COUNT(*) n FROM crm_leads WHERE normalized_phone=? AND deleted_at_utc IS NULL', [PHONE]);
  check('approving creates the CRM lead', Number(afterApprove.n) === 1, `${afterApprove.n} leads`);

  const twice = await call('POST', `/meta/imports/${APPROVE}/approve`, {});
  check('a lead cannot be approved twice', twice.status === 409, twice.body.message);

  // --- discard -----------------------------------------------------------
  const discarded = await call('POST', `/meta/imports/${DISCARD}/discard`, { reason: 'probe' });
  check('discarding succeeds', discarded.status === 200);
  const [[row]] = await pool.query('SELECT status, error_message FROM crm_meta_lead_imports WHERE leadgen_id=?', [DISCARD]);
  check('a discarded lead is recorded with its reason',
    row?.status === 'skipped' && row.error_message === 'probe', `${row?.status} / ${row?.error_message}`);

  const gone = await call('GET', '/meta/imports/pending');
  const stillWaiting = (gone.body.data || []).filter(r => [APPROVE, DISCARD].includes(r.leadgenId));
  check('neither still shows as waiting', stillWaiting.length === 0, `${stillWaiting.length} left`);
} finally {
  await pool.query('DELETE FROM crm_meta_lead_imports WHERE leadgen_id IN (?,?)', [APPROVE, DISCARD]);
  // Attribution rows point at the lead, so they go first.
  const [made] = await pool.query('SELECT id FROM crm_leads WHERE normalized_phone=?', [PHONE]);
  for (const lead of made) {
    await pool.query('DELETE FROM crm_lead_source_history WHERE lead_id=?', [lead.id]);
    await pool.query('DELETE FROM crm_leads WHERE id=?', [lead.id]);
  }
  const [[left]] = await pool.query('SELECT COUNT(*) n FROM crm_leads WHERE normalized_phone=?', [PHONE]);
  check('cleanup removed the probe rows', Number(left.n) === 0, `${left.n} left`);
  await pool.end();
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

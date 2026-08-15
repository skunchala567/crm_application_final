/**
 * SMS templates: many per account, each with its own DLT Content ID.
 *
 * Exercises the template CRUD and preview through the running API, and the
 * rendering helpers directly. It deliberately does NOT send: a real send costs
 * money and reaches a real handset, so the send path is covered by asserting
 * the template a send would resolve, not by dispatching one.
 *
 * Run: node --env-file=.env scripts/experiments/verify-sms-templates.js
 */
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';
import { countVariables, renderTemplate } from '../../src/sms-templates.routes.js';

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
  const raw = await r.text();
  let parsed; try { parsed = JSON.parse(raw); } catch { parsed = { raw: raw.slice(0, 160) }; }
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
let integrationId = null;

try {
  // --- the rendering rules, on their own ---------------------------------
  check('variable count ignores repeats',
    countVariables('Hi {{1}}, your {{2}} is due. Thanks {{1}}') === 2, '2 expected');
  check('rendering substitutes in order',
    renderTemplate('Hi {{1}}, due {{2}}', ['Asha', '15 Sep']) === 'Hi Asha, due 15 Sep');
  check('a missing value leaves its placeholder rather than printing undefined',
    renderTemplate('Hi {{1}}, due {{2}}', ['Asha']) === 'Hi Asha, due {{2}}');

  const [[account]] = await pool.query(
    'SELECT id FROM crm_integrations WHERE deleted_at IS NULL ORDER BY id LIMIT 1');
  integrationId = account.id;

  // --- more than one template on one account -----------------------------
  for (const [name, body, dlt] of [
    ['ZZ Probe Reminder', 'Dear {{1}}, your application {{2}} is pending.', '1234567890123'],
    ['ZZ Probe Welcome', 'Welcome {{1}}!', '9876543210987'],
  ]) {
    const created = await call('POST', `/sms/integrations/${integrationId}/sms-templates`,
      { templateName: name, body, dltContentId: dlt, category: 'General' });
    if (created.status === 201) made.push(created.body.data.id);
    check(`created "${name}"`, created.status === 201, created.body.message || '');
  }
  check('an account can hold more than one template', made.length === 2, `${made.length} created`);

  // --- validation ---------------------------------------------------------
  const badDlt = await call('POST', `/sms/integrations/${integrationId}/sms-templates`,
    { templateName: 'ZZ Probe Bad', body: 'x', dltContentId: 'not-a-number' });
  check('a template without a valid DLT Content ID is refused', badDlt.status === 400, badDlt.body.message);

  const dupe = await call('POST', `/sms/integrations/${integrationId}/sms-templates`,
    { templateName: 'ZZ Probe Welcome', body: 'x', dltContentId: '1111111111' });
  check('a duplicate name on the same account is refused', dupe.status === 409, dupe.body.message);

  // --- listing and preview -------------------------------------------------
  const list = await call('GET', `/sms/integrations/${integrationId}/sms-templates`);
  const mine = (list.body.data || []).filter(t => t.templateName.startsWith('ZZ Probe'));
  check('both templates are listed for selection', mine.length === 2, mine.map(t => t.templateName).join(', '));
  const reminder = mine.find(t => t.templateName === 'ZZ Probe Reminder');
  check('the variable count is stored with the template', reminder?.variableCount === 2, `${reminder?.variableCount}`);
  check('each template keeps its own DLT Content ID',
    new Set(mine.map(t => t.dltContentId)).size === 2, mine.map(t => t.dltContentId).join(', '));

  const preview = await call('POST', `/sms/sms-templates/${reminder.id}/preview`, { params: ['Asha', 'ADM-2026-000123'] });
  check('preview renders the chosen values',
    preview.body.data?.text === 'Dear Asha, your application ADM-2026-000123 is pending.', preview.body.data?.text);
  check('preview reports length and segments',
    preview.body.data?.characters > 0 && preview.body.data?.segments >= 1,
    `${preview.body.data?.characters} chars, ${preview.body.data?.segments} segment(s)`);

  // --- a send would use the template's own Content ID ---------------------
  const [[stored]] = await pool.query('SELECT dlt_content_id FROM crm_sms_templates WHERE id=?', [reminder.id]);
  check('a send resolves the template Content ID, not the account default',
    stored.dlt_content_id === '1234567890123', stored.dlt_content_id);

  const wrongAccount = await call('POST', `/sms/integrations/999999/sms-templates/${reminder.id}/send`,
    { phoneNumber: '9100000000' });
  check('a template cannot be sent through another account', wrongAccount.status === 404, wrongAccount.body.message);

  // --- edit and delete ----------------------------------------------------
  const edited = await call('PUT', `/sms/sms-templates/${reminder.id}`,
    { templateName: 'ZZ Probe Reminder', body: 'Dear {{1}}, reminder.', dltContentId: '1234567890123' });
  check('a template can be edited', edited.status === 200);
  const [[after]] = await pool.query('SELECT variable_count FROM crm_sms_templates WHERE id=?', [reminder.id]);
  check('the variable count follows the edited body', Number(after.variable_count) === 1, `${after.variable_count}`);
} finally {
  for (const id of made) await pool.execute('DELETE FROM crm_sms_templates WHERE id=?', [id]);
  await pool.execute("DELETE FROM crm_sms_templates WHERE template_name LIKE 'ZZ Probe%'");
  const [[left]] = await pool.query("SELECT COUNT(*) n FROM crm_sms_templates WHERE template_name LIKE 'ZZ Probe%'");
  check('cleanup removed the probe templates', Number(left.n) === 0, `${left.n} left`);
  await pool.end();
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

/**
 * Action item notifications: who gets messaged, with what.
 *
 * Drives notifyTrackerTask() with a stubbed send so nothing leaves the
 * building, and checks the owner gets the action-item template, each approver
 * gets the approval one, both carry [title, due date], and a provider failure
 * is contained. Settings are restored afterwards.
 *
 * Run: node --env-file=.env scripts/experiments/verify-tracker-notifications.js
 */
import mysql from 'mysql2/promise';
import { notifyTrackerTask } from '../../src/tracker-notifications.js';

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

const UNIT = 1;
let original = null;
const restorePhones = [];

/** Records calls instead of contacting the provider. */
const recorder = () => {
  const calls = [];
  return {
    calls,
    async sendSmartpingMessage(integrationId, org, phone, message, options) {
      calls.push({ integrationId, phone, template: options.templateName, params: options.templateParams, clientRequestId: options.clientRequestId });
      return { success: true };
    },
  };
};

try {
  const [[existing]] = await pool.query('SELECT * FROM crm_tracker_notification_settings WHERE business_unit_id=?', [UNIT]);
  original = existing || null;

  const [[account]] = await pool.query(
    "SELECT id FROM crm_integrations WHERE deleted_at IS NULL AND LOWER(COALESCE(provider,''))='smartping' ORDER BY id LIMIT 1");

  /*
   * No employee currently has a mobile_number and only one account has a
   * profile phone, so the probe supplies its own contacts -- in the CRM's own
   * crm_user_profiles, never in the Attendance-owned employees table -- and
   * puts them back afterwards.
   */
  const [[ownerUser]] = await pool.query(
    'SELECT id AS userId, employee_id AS employeeId FROM app_users WHERE employee_id IS NOT NULL AND is_active=1 ORDER BY id LIMIT 1');
  const [[approverUser]] = await pool.query(
    'SELECT id AS userId FROM app_users WHERE is_active=1 AND id<>? ORDER BY id DESC LIMIT 1', [ownerUser.userId]);
  if (!ownerUser || !approverUser) throw new Error('Need two active accounts to test against');
  const owner = { employeeId: ownerUser.employeeId };
  const approver = { userId: approverUser.userId };

  for (const [userId, phone] of [[ownerUser.userId, '9812345670'], [approverUser.userId, '+91 98123 45671']]) {
    const [[prior]] = await pool.query('SELECT phone FROM crm_user_profiles WHERE user_id=?', [userId]);
    restorePhones.push([userId, prior ? prior.phone : null, Boolean(prior)]);
    await pool.execute(
      `INSERT INTO crm_user_profiles (user_id, first_name, last_name, phone)
       VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE phone=VALUES(phone)`,
      [userId, 'ZZ', 'Probe', phone]);
  }

  const setSettings = (changes) => pool.execute(
    `INSERT INTO crm_tracker_notification_settings
       (business_unit_id,is_enabled,integration_id,action_item_template,approval_template)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE is_enabled=VALUES(is_enabled),integration_id=VALUES(integration_id),
       action_item_template=VALUES(action_item_template),approval_template=VALUES(approval_template)`,
    [UNIT, changes.enabled ?? 1, changes.integrationId ?? account.id,
     'action' in changes ? changes.action : 'zz_action_tpl',
     'approval' in changes ? changes.approval : 'zz_approval_tpl']);

  const task = {
    businessUnitId: UNIT, recordId: 987654, title: 'Prepare the fee structure',
    dueAt: '2026-09-15T10:00:00Z', ownerEmployeeId: owner.employeeId, approverUserIds: [approver.userId],
  };

  // --- 1. off means silent -----------------------------------------------
  await setSettings({ enabled: 0 });
  let stub = recorder();
  let out = await notifyTrackerTask(pool, stub, task, { info() {}, error() {} });
  check('nothing is sent while the feature is off', stub.calls.length === 0 && out.skipped === 'not configured');

  // --- 2. owner and approver each get their own template ------------------
  await setSettings({ enabled: 1 });
  stub = recorder();
  out = await notifyTrackerTask(pool, stub, task, { info() {}, error() {} });
  check('one message per recipient', stub.calls.length === 2, `${stub.calls.length} sent`);
  const ownerCall = stub.calls.find(c => c.template === 'zz_action_tpl');
  const approverCall = stub.calls.find(c => c.template === 'zz_approval_tpl');
  check('the owner gets the action item template', Boolean(ownerCall), ownerCall?.phone);
  check('the approver gets the approval template', Boolean(approverCall), approverCall?.phone);

  // --- 3. the two variables ----------------------------------------------
  check('variable 1 is the action item text', ownerCall?.params?.[0] === 'Prepare the fee structure', ownerCall?.params?.[0]);
  check('variable 2 is the due date, readable',
    /^15 \w{3,4} 2026$/.test(ownerCall?.params?.[1] || ''), ownerCall?.params?.[1]);
  check('both recipients get the same two variables',
    JSON.stringify(ownerCall?.params) === JSON.stringify(approverCall?.params), JSON.stringify(approverCall?.params));
  // One was stored as "+91 98123 45671": both must arrive as bare 10 digits.
  check('numbers are normalised to 10 digits however they were stored',
    stub.calls.every(c => /^\d{10}$/.test(c.phone)), stub.calls.map(c => c.phone).join(', '));
  check('each send is keyed so a retry cannot double-message',
    new Set(stub.calls.map(c => c.clientRequestId)).size === 2,
    stub.calls.map(c => c.clientRequestId).join(' | '));

  // --- 4. one template only ----------------------------------------------
  await setSettings({ enabled: 1, approval: null });
  stub = recorder();
  await notifyTrackerTask(pool, stub, task, { info() {}, error() {} });
  check('leaving a template blank silences that side only',
    stub.calls.length === 1 && stub.calls[0].template === 'zz_action_tpl', `${stub.calls.length} sent`);

  // --- 5. a provider failure must not escape ------------------------------
  await setSettings({ enabled: 1 });
  const exploding = {
    async sendSmartpingMessage() { throw new Error('provider is down'); },
  };
  let threw = false;
  try {
    out = await notifyTrackerTask(pool, exploding, task, { info() {}, error() {} });
  } catch { threw = true; }
  check('a provider failure is contained, not thrown', !threw && out.sent === 0, `sent ${out?.sent}`);
} finally {
  for (const [userId, phone, existed] of restorePhones) {
    if (existed) await pool.execute('UPDATE crm_user_profiles SET phone=? WHERE user_id=?', [phone, userId]);
    else await pool.execute('DELETE FROM crm_user_profiles WHERE user_id=?', [userId]);
  }
  if (original) {
    await pool.execute(
      `REPLACE INTO crm_tracker_notification_settings
         (business_unit_id,is_enabled,integration_id,action_item_template,approval_template)
       VALUES (?,?,?,?,?)`,
      [UNIT, original.is_enabled, original.integration_id, original.action_item_template, original.approval_template]);
  } else {
    await pool.execute('DELETE FROM crm_tracker_notification_settings WHERE business_unit_id=?', [UNIT]);
  }
  const [[left]] = await pool.query('SELECT COUNT(*) n FROM crm_tracker_notification_settings WHERE business_unit_id=?', [UNIT]);
  check('settings restored', original ? Number(left.n) === 1 : Number(left.n) === 0);
  await pool.end();
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

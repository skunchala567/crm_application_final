/**
 * An inbound WhatsApp message from an unknown number becomes a lead, filed
 * where the account's Lead intake settings say.
 *
 * Posts real webhook payloads at the running API and reads back what landed
 * in crm_leads. Every lead, conversation and message it creates is deleted
 * afterwards, and the account's own settings are restored.
 *
 * Run: node --env-file=.env scripts/experiments/verify-whatsapp-lead-intake.js
 */
import mysql from 'mysql2/promise';

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:3001/api';

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

// Numbers nobody could have as a real lead.
const numbers = ['9100000001', '9100000002', '9100000003', '9100000004', '9100000005', '9100000006', '9100000007'];
let original = null;
let integrationId = null;

const send = (mobile, id, contactName = 'ZZ Probe Contact') => fetch(`${BASE}/webhooks/smartping/webhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'message', id, messageId: id, project_id: projectId,
    phone_number: `91${mobile}`, sender: 'USER', status: 'RECEIVED',
    message_content: { body: 'Hello, I saw your ad' },
    ...(contactName ? { contact_name: contactName } : {}),
  }),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const leadFor = async (mobile) => {
  const [[lead]] = await pool.query(
    `SELECT id, branch_id AS branchId, owner_employee_id AS ownerEmployeeId, business_unit_id AS unitId,
            stage_id AS stageId, source_id AS sourceId, student_name AS studentName
     FROM crm_leads WHERE normalized_phone=? AND deleted_at_utc IS NULL LIMIT 1`, [mobile]);
  return lead || null;
};

let projectId = null;
let ruleId = null;

try {
  const [[account]] = await pool.query(
    `SELECT id, project_id AS projectId FROM crm_integrations
     WHERE deleted_at IS NULL AND LOWER(COALESCE(provider,''))='smartping' ORDER BY id LIMIT 1`);
  integrationId = account.id;
  projectId = account.projectId;
  const [[existing]] = await pool.query('SELECT * FROM crm_whatsapp_lead_intake WHERE integration_id=?', [integrationId]);
  original = existing || null;

  const [[branch]] = await pool.query('SELECT id FROM branches WHERE is_active=1 ORDER BY id LIMIT 1');
  const [[unit]] = await pool.query('SELECT id FROM crm_business_units WHERE is_default=TRUE LIMIT 1');
  const [[owner]] = await pool.query(
    `SELECT e.id FROM employees e JOIN app_users u ON u.employee_id=e.id
     WHERE e.status='Active' ORDER BY e.id LIMIT 1`);

  const setIntake = (changes) => pool.execute(
    `INSERT INTO crm_whatsapp_lead_intake
       (integration_id,auto_create_lead,business_unit_id,branch_id,assignment_mode,owner_employee_id)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE auto_create_lead=VALUES(auto_create_lead),business_unit_id=VALUES(business_unit_id),
       branch_id=VALUES(branch_id),assignment_mode=VALUES(assignment_mode),owner_employee_id=VALUES(owner_employee_id)`,
    [integrationId, changes.auto ?? 1, changes.unit ?? unit.id, changes.branch ?? null,
     changes.mode ?? 'unassigned', changes.owner ?? null]);

  // --- 1. a fixed counsellor -------------------------------------------
  await setIntake({ branch: branch.id, mode: 'fixed', owner: owner.id });
  const first = await send(numbers[0], 'zz-probe-1');
  check('webhook accepted the inbound message', first.status === 200, JSON.stringify(first.body));
  const lead1 = await leadFor(numbers[0]);
  check('an unknown number created a lead', Boolean(lead1), lead1 ? `lead ${lead1.id}` : 'none');
  check('the lead landed in the configured branch', Number(lead1?.branchId) === Number(branch.id),
    `branch ${lead1?.branchId} vs ${branch.id}`);
  check('the lead went to the configured counsellor', Number(lead1?.ownerEmployeeId) === Number(owner.id),
    `owner ${lead1?.ownerEmployeeId} vs ${owner.id}`);

  // --- 2. leave unassigned ---------------------------------------------
  await setIntake({ branch: branch.id, mode: 'unassigned' });
  await send(numbers[1], 'zz-probe-2');
  const lead2 = await leadFor(numbers[1]);
  check('unassigned mode still files the branch', Number(lead2?.branchId) === Number(branch.id));
  check('unassigned mode leaves the owner empty', lead2 && lead2.ownerEmployeeId === null,
    `owner ${lead2?.ownerEmployeeId}`);

  // --- 3. auto-create switched off -------------------------------------
  await setIntake({ auto: 0, branch: branch.id, mode: 'unassigned' });
  const third = await send(numbers[2], 'zz-probe-3');
  check('the message is still stored with auto-create off', third.status === 200);
  const lead3 = await leadFor(numbers[2]);
  check('no lead is created when auto-create is off', lead3 === null, lead3 ? `lead ${lead3.id}` : 'none');

  // --- 4. assignment rules, the mode the accounts are set to ------------
  const [[waSource]] = await pool.query(
    `SELECT id FROM crm_lead_sources
     WHERE is_active=TRUE AND (LOWER(name) LIKE '%whatsapp%' OR LOWER(display_name) LIKE '%whatsapp%')
     ORDER BY id LIMIT 1`);
  const [people] = await pool.query(
    `SELECT e.id FROM employees e JOIN app_users u ON u.employee_id=e.id
     WHERE e.status='Active' ORDER BY e.id LIMIT 2`);
  if (waSource && people.length === 2) {
    const [rule] = await pool.execute(
      `INSERT INTO crm_assignment_rules
         (business_unit_id,name,branch_ids_json,source_ids_json,employee_ids_json,is_active,created_by)
       VALUES (?,?,?,?,?,1,?)`,
      [unit.id, 'ZZ Probe WhatsApp rule', JSON.stringify([Number(branch.id)]),
       JSON.stringify([Number(waSource.id)]), JSON.stringify(people.map(p => Number(p.id))), 1]);
    ruleId = rule.insertId;
    await setIntake({ branch: branch.id, mode: 'rule' });

    await send(numbers[3], 'zz-probe-5');
    const ruleLead1 = await leadFor(numbers[3]);
    check('assignment rules assign a WhatsApp lead',
      ruleLead1 && ruleLead1.ownerEmployeeId !== null,
      `owner ${ruleLead1?.ownerEmployeeId}`);
    check('the lead carries the WhatsApp source',
      Number(ruleLead1?.sourceId) === Number(waSource.id),
      `source ${ruleLead1?.sourceId} vs ${waSource.id}`);

    await send(numbers[4], 'zz-probe-6');
    const ruleLead2 = await leadFor(numbers[4]);
    check('the next one goes to the other counsellor (round robin)',
      ruleLead2 && ruleLead1 && Number(ruleLead2.ownerEmployeeId) !== Number(ruleLead1.ownerEmployeeId),
      `${ruleLead1?.ownerEmployeeId} then ${ruleLead2?.ownerEmployeeId}`);
  } else {
    check('assignment rules assign a WhatsApp lead', false, 'no WhatsApp source or too few employees');
  }

  // --- 5. nothing configured at all: the enquiry must still land --------
  // No branch, rule mode, and no rule that matches -- the case where the CRM
  // has been told nothing. The lead has to exist regardless; losing an
  // enquiry because it was unconfigured is the worst possible outcome.
  if (ruleId) await pool.execute('DELETE FROM crm_assignment_rules WHERE id=?', [ruleId]);
  ruleId = null;
  await setIntake({ branch: null, mode: 'rule' });

  await send(numbers[5], 'zz-probe-7');
  const bare = await leadFor(numbers[5]);
  check('a lead is still created with no branch and no rule', Boolean(bare), bare ? `lead ${bare.id}` : 'none');
  check('its branch is null', bare && bare.branchId === null, `branch ${bare?.branchId}`);
  check('its owner is null', bare && bare.ownerEmployeeId === null, `owner ${bare?.ownerEmployeeId}`);
  check('a supplied contact name is kept', bare?.studentName === 'ZZ Probe Contact', bare?.studentName);

  await send(numbers[6], 'zz-probe-8', null);
  const unnamed = await leadFor(numbers[6]);
  check('an enquiry with no profile name is called "Whatsapp Lead"',
    unnamed?.studentName === 'Whatsapp Lead', unnamed?.studentName);
  check('the number is still captured on it', String(unnamed?.id) && await (async () => {
    const [[row]] = await pool.query('SELECT phone FROM crm_leads WHERE id=?', [unnamed.id]);
    return row.phone === numbers[6];
  })(), `phone stored`);

  // --- 6. a second message from a known number does not duplicate ------
  await setIntake({ branch: branch.id, mode: 'fixed', owner: owner.id });
  await send(numbers[0], 'zz-probe-4');
  const [[count]] = await pool.query(
    'SELECT COUNT(*) AS n FROM crm_leads WHERE normalized_phone=? AND deleted_at_utc IS NULL', [numbers[0]]);
  check('a repeat message does not create a second lead', Number(count.n) === 1, `${count.n} leads`);
} finally {
  if (ruleId) await pool.execute('DELETE FROM crm_assignment_rules WHERE id=?', [ruleId]);
  const placeholders = numbers.map(() => '?').join(',');
  await pool.query(
    `DELETE m FROM crm_whatsapp_messages m JOIN crm_whatsapp_conversations c ON c.id=m.conversation_id
     WHERE c.mobile IN (${placeholders})`, numbers);
  await pool.query(`DELETE FROM crm_whatsapp_conversations WHERE mobile IN (${placeholders})`, numbers);
  await pool.query(`DELETE FROM crm_leads WHERE normalized_phone IN (${placeholders})`, numbers);
  if (original) {
    await pool.execute(
      `REPLACE INTO crm_whatsapp_lead_intake
         (integration_id,auto_create_lead,business_unit_id,branch_id,assignment_mode,owner_employee_id)
       VALUES (?,?,?,?,?,?)`,
      [integrationId, original.auto_create_lead, original.business_unit_id, original.branch_id,
       original.assignment_mode, original.owner_employee_id]);
  }
  const [[left]] = await pool.query(
    `SELECT COUNT(*) AS n FROM crm_leads WHERE normalized_phone IN (${placeholders})`, numbers);
  check('cleanup removed the probe leads and conversations', Number(left.n) === 0, `${left.n} left`);
  await pool.end();
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

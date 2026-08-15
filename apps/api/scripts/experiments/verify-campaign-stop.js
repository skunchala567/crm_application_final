/**
 * Stopping a bulk campaign cancels what has not gone out yet.
 *
 * Creates a throwaway campaign with a mix of pending and already-sent
 * deliveries, stops it through the API, and checks the pending ones are
 * cancelled while the sent ones are left alone -- a stop must not rewrite
 * history. Everything it creates is deleted afterwards.
 *
 * Run: node --env-file=.env scripts/experiments/verify-campaign-stop.js
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
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 160) }; }
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

let campaignId = null;

try {
  const [[account]] = await pool.query(
    "SELECT id FROM crm_integrations WHERE deleted_at IS NULL AND LOWER(COALESCE(provider,''))='smartping' ORDER BY id LIMIT 1");

  const [created] = await pool.execute(
    `INSERT INTO crm_marketing_campaigns
       (business_unit_id, organization_id, name, rule_type, communication_count,
        first_communication_at, gap_days, audience_filters_json, integration_id, status, created_by)
     VALUES (1, 1, 'ZZ Probe Stop Campaign', 'days_gap', 3, NOW(), 1, '{}', ?, 'ACTIVE', 1)`,
    [account.id]);
  campaignId = created.insertId;

  // Deliveries hang off a recipient and a touch, so both are needed.
  const [[lead]] = await pool.query(
    'SELECT id FROM crm_leads WHERE deleted_at_utc IS NULL ORDER BY id LIMIT 1');
  const [recipient] = await pool.execute(
    `INSERT INTO crm_marketing_campaign_recipients (campaign_id, lead_id, phone, phone_type, status)
     VALUES (?,?,?,'primary','PENDING')`,
    [campaignId, lead.id, '9100000999']);
  // template_id is a real foreign key, so borrow an existing approved template.
  const [[template]] = await pool.query(
    "SELECT id, template_name FROM crm_whatsapp_templates WHERE status='APPROVED' ORDER BY id LIMIT 1");
  // Deliveries are unique per (recipient, touch), so each one needs its own
  // touch -- which is how a real multi-communication campaign is shaped.
  // Two already gone, three still queued.
  for (const [seq, status] of [[1, 'DELIVERED'], [2, 'SENT'], [3, 'PENDING'], [4, 'PENDING'], [5, 'PENDING']]) {
    const [touch] = await pool.execute(
      `INSERT INTO crm_marketing_campaign_touches
         (campaign_id, sequence_number, template_id, template_name, template_body, scheduled_at)
       VALUES (?,?,?,?,'probe', NOW())`,
      [campaignId, seq, template.id, template.template_name]);
    await pool.execute(
      `INSERT INTO crm_marketing_campaign_deliveries
         (campaign_id, recipient_id, touch_id, sequence_number, scheduled_for, status)
       VALUES (?, ?, ?, ?, NOW(), ?)`,
      [campaignId, recipient.insertId, touch.insertId, seq, status]);
  }

  const before = await call('GET', '/marketing-campaigns');
  const listed = (before.body.data || []).find(c => Number(c.id) === Number(campaignId));
  check('an active campaign is listed', Boolean(listed), listed?.status);
  check('it reports its pending deliveries', Number(listed?.pendingDeliveries) === 3, `${listed?.pendingDeliveries} pending`);

  // --- stop it -----------------------------------------------------------
  const stopped = await call('PUT', `/marketing-campaigns/${campaignId}/status`, { status: 'CANCELLED' });
  check('stopping succeeds', stopped.status === 200, stopped.body.message);

  const [[campaign]] = await pool.query('SELECT status FROM crm_marketing_campaigns WHERE id=?', [campaignId]);
  check('the campaign is marked cancelled', campaign?.status === 'CANCELLED', campaign?.status);

  const [rows] = await pool.query(
    'SELECT status, COUNT(*) n FROM crm_marketing_campaign_deliveries WHERE campaign_id=? GROUP BY status', [campaignId]);
  const byStatus = Object.fromEntries(rows.map(r => [r.status, Number(r.n)]));
  check('every queued message is cancelled', byStatus.CANCELLED === 3, JSON.stringify(byStatus));
  check('messages already sent are left alone',
    byStatus.DELIVERED === 1 && byStatus.SENT === 1, JSON.stringify(byStatus));
  check('nothing is left pending', !byStatus.PENDING, JSON.stringify(byStatus));

  // --- and it cannot be restarted by accident ----------------------------
  const after = await call('GET', '/marketing-campaigns');
  const gone = (after.body.data || []).find(c => Number(c.id) === Number(campaignId));
  check('the list shows it as cancelled', gone?.status === 'CANCELLED', gone?.status);

  const bad = await call('PUT', `/marketing-campaigns/${campaignId}/status`, { status: 'NONSENSE' });
  check('an unknown status is refused', bad.status === 400, bad.body.message);
} finally {
  if (campaignId) {
    await pool.execute('DELETE FROM crm_marketing_campaign_deliveries WHERE campaign_id=?', [campaignId]);
    await pool.execute('DELETE FROM crm_marketing_campaign_recipients WHERE campaign_id=?', [campaignId]);
    await pool.execute('DELETE FROM crm_marketing_campaign_touches WHERE campaign_id=?', [campaignId]);
    await pool.execute('DELETE FROM crm_marketing_campaigns WHERE id=?', [campaignId]);
  }
  const [[left]] = await pool.query("SELECT COUNT(*) n FROM crm_marketing_campaigns WHERE name LIKE 'ZZ Probe%'");
  check('cleanup removed the probe campaign', Number(left.n) === 0, `${left.n} left`);
  await pool.end();
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

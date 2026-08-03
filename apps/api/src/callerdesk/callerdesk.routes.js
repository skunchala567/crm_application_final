import crypto from 'node:crypto';
import { Router } from 'express';
import axios from 'axios';
import { decryptToken, encryptToken, getMasterKey } from '../integration-hub/crypto-utils.js';

const BASE_URL = 'https://app.callerdesk.io/api';
const clean = value => String(value ?? '').trim();
const digits = value => clean(value).replace(/\D/g, '').slice(-10);
const json = value => typeof value === 'string' ? JSON.parse(value || '{}') : (value || {});
const unwrap = value => value?.data ?? value;

async function callerDeskRequest(endpoint, credentials, params = {}, method = 'POST') {
  const payload = { authcode: credentials.authcode, ...params };
  const requestConfig = {
    timeout: 20000,
    ...(credentials.apiSecret ? { auth: { username: credentials.authcode, password: credentials.apiSecret } } : {}),
  };
  try {
    const response = method === 'GET'
      ? await axios.get(`${BASE_URL}/${endpoint}`, { ...requestConfig, params: payload })
      : await axios.post(`${BASE_URL}/${endpoint}`, new URLSearchParams(payload), {
          ...requestConfig, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
    return response.data;
  } catch (error) {
    const detail = error.response?.data?.message || error.response?.data?.error || error.response?.data || error.message;
    throw Object.assign(new Error(typeof detail === 'string' ? detail : JSON.stringify(detail)), { status: 502 });
  }
}

async function loadConfig(pool, organizationId, required = true) {
  const [[row]] = await pool.execute(`SELECT * FROM crm_integrations WHERE organization_id=? AND deleted_at IS NULL
    AND (LOWER(provider)='callerdesk' OR LOWER(type)='callerdesk')
    ORDER BY id DESC LIMIT 1`, [organizationId]);
  if (!row && required) throw Object.assign(new Error('Configure CallerDesk for this business unit first'), { status: 400 });
  if (!row) return null;
  if (required && !['ACTIVE','CONNECTED'].includes(String(row.status).toUpperCase())) throw Object.assign(new Error('CallerDesk integration is inactive'), { status: 400 });
  const stored = json(row.config);
  return { ...row, ...stored,
    authcode: decryptToken(stored.apiKeyEncrypted, getMasterKey()),
    apiSecret: stored.apiSecretEncrypted ? decryptToken(stored.apiSecretEncrypted, getMasterKey()) : '',
    integrationKey: stored.integrationKeyEncrypted ? decryptToken(stored.integrationKeyEncrypted, getMasterKey()) : '' };
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function createCallerDeskRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin) {
  const router = Router();

  router.get('/config', authenticate, requireCrmAccess, asyncRoute(async (req, res) => {
    const config = await loadConfig(pool, Number(req.user.organizationId || 1), false);
    res.json({ data: config ? {
      id: Number(config.id), accountName: config.name, defaultDeskphone: config.defaultDeskphone || '',
      defaultGroupName: config.defaultGroupName || '', recordCalls: config.recordCalls !== false, isActive: ['ACTIVE','CONNECTED'].includes(String(config.status).toUpperCase()), configured: true,
      hasApiSecret: Boolean(config.apiSecret), hasIntegrationKey: Boolean(config.integrationKey),
      webhookPath: `/api/callerdesk/webhook/${config.id}?secret=${config.webhookSecret}`,
    } : { configured: false } });
  }));

  router.put('/config', authenticate, requireCrmAccess, requireUserAdmin, asyncRoute(async (req, res) => {
    const authcode = clean(req.body.authcode || req.body.apiKey);
    const organizationId = Number(req.user.organizationId || 1);
    const existing = await loadConfig(pool, organizationId, false);
    if (!authcode && !existing) return res.status(400).json({ message: 'CallerDesk authcode is required' });
    const stored = { apiKeyEncrypted: authcode ? encryptToken(authcode,getMasterKey()) : existing.apiKeyEncrypted,
      apiSecretEncrypted: clean(req.body.apiSecret) ? encryptToken(clean(req.body.apiSecret),getMasterKey()) : existing?.apiSecretEncrypted || null,
      integrationKeyEncrypted: clean(req.body.integrationKey) ? encryptToken(clean(req.body.integrationKey),getMasterKey()) : existing?.integrationKeyEncrypted || null,
      defaultDeskphone: clean(req.body.defaultDeskphone)||'', defaultGroupName: clean(req.body.defaultGroupName)||'', recordCalls:req.body.recordCalls!==false, defaultBusinessUnitId:req.businessUnit.id,
      webhookSecret: existing?.webhookSecret || crypto.randomBytes(24).toString('hex') };
    if(existing) await pool.execute(`UPDATE crm_integrations SET name=?,config=?,status=?,updated_by=? WHERE id=?`,
      [clean(req.body.accountName)||'CallerDesk',JSON.stringify(stored),req.body.isActive===false?'INACTIVE':'ACTIVE',req.user.id,existing.id]);
    else await pool.execute(`INSERT INTO crm_integrations(organization_id,name,type,provider,config,status,created_by)
      VALUES(?,?,'SMS','callerdesk',?,?,?)`,[organizationId,clean(req.body.accountName)||'CallerDesk',JSON.stringify(stored),req.body.isActive===false?'INACTIVE':'ACTIVE',req.user.id]);
    res.json({ success: true, message: 'CallerDesk configuration saved' });
  }));

  router.post('/test', authenticate, requireCrmAccess, requireUserAdmin, asyncRoute(async (req, res) => {
    const config = await loadConfig(pool, Number(req.user.organizationId || 1));
    const result = await callerDeskRequest('profile_billing_v2', config);
    res.json({ success: true, data: unwrap(result) });
  }));

  const proxies = {
    members: ['getmemberlist_V2', 'POST'], groups: ['getgrouplist_v2', 'POST'], deskphones: ['getdeskphone_v2', 'POST'],
    dashboard: ['dashboard_v2', 'POST'], live: ['live_call_v2', 'GET'], profile: ['profile_billing_v2', 'POST'],
    notifications: ['get_notification_setting_v2', 'POST'], routing: ['getroutingdetail_V2', 'POST'],
  };
  Object.entries(proxies).forEach(([path, [endpoint, method]]) => router.get(`/${path}`, authenticate, requireCrmAccess, asyncRoute(async (req, res) => {
    const config = await loadConfig(pool, Number(req.user.organizationId || 1));
    res.json({ data: unwrap(await callerDeskRequest(endpoint, config, req.query, method)) });
  })));

  router.get('/reports', authenticate, requireCrmAccess, asyncRoute(async (req, res) => {
    const config = await loadConfig(pool, Number(req.user.organizationId || 1));
    res.json({ data: unwrap(await callerDeskRequest('call_list_v2', config, {
      start_date: req.query.from || '', end_date: req.query.to || '', current_page: req.query.page || 1,
      per_page: Math.min(Number(req.query.perPage) || 50, 200), deskphone: req.query.deskphone || '',
      member_num: req.query.memberNumber || '', callresult: req.query.result || '', Flow_type: req.query.direction || '',
    })) });
  }));

  router.get('/agents', authenticate, requireCrmAccess, asyncRoute(async (req, res) => {
    await loadConfig(pool, Number(req.user.organizationId || 1));
    const [rows] = await pool.execute(`SELECT u.id,u.id userId,u.employee_id employeeId,u.callerdesk_member_id memberId,
      COALESCE(u.callerdesk_member_name,e.employee_name,u.email) memberName,u.callerdesk_member_number memberNumber,
      u.callerdesk_call_group callGroup,u.callerdesk_enabled isActive FROM app_users u LEFT JOIN employees e ON e.id=u.employee_id
      WHERE u.callerdesk_enabled=1 ORDER BY memberName`);
    res.json({ data: rows });
  }));

  router.post('/agents', authenticate, requireCrmAccess, requireUserAdmin, asyncRoute(async (req, res) => {
    await loadConfig(pool, Number(req.user.organizationId || 1));
    if (!clean(req.body.memberName) || !digits(req.body.memberNumber)) return res.status(400).json({ message: 'Member name and a valid number are required' });
    const userId=Number(req.body.userId);
    if(!Number.isInteger(userId)||userId<1)return res.status(400).json({message:'Select a CRM user'});
    const [updated]=await pool.execute(`UPDATE app_users SET callerdesk_member_id=?,callerdesk_member_name=?,callerdesk_member_number=?,
      callerdesk_call_group=?,callerdesk_enabled=1 WHERE id=?`,[clean(req.body.memberId)||null,clean(req.body.memberName),digits(req.body.memberNumber),clean(req.body.callGroup)||null,userId]);
    if(!updated.affectedRows)return res.status(404).json({message:'CRM user not found'});
    res.status(201).json({ success: true });
  }));

  router.get('/branch-dids', authenticate, requireCrmAccess, asyncRoute(async (req,res) => {
    await loadConfig(pool,Number(req.user.organizationId || 1));
    const [rows] = await pool.execute(`SELECT b.id branchId,b.branch_name branchName,b.callerdesk_did_id didId,b.callerdesk_did_number didNumber,
      b.callerdesk_call_group callGroup,b.callerdesk_inbound_enabled inboundEnabled,b.callerdesk_outbound_enabled outboundEnabled
      FROM branches b WHERE b.is_active=1 ORDER BY b.branch_name`);
    res.json({data:rows});
  }));

  router.put('/branch-dids/:branchId', authenticate, requireCrmAccess, requireUserAdmin, asyncRoute(async (req,res) => {
    await loadConfig(pool,Number(req.user.organizationId || 1));
    const [[branch]] = await pool.execute('SELECT id FROM branches WHERE id=? AND is_active=1 LIMIT 1',[req.params.branchId]);
    if(!branch)return res.status(404).json({message:'Branch not found in this business unit'});
    const didNumber=clean(req.body.didNumber);
    if(!didNumber)return res.status(400).json({message:'DID number is required'});
    await pool.execute(`UPDATE branches SET callerdesk_did_id=?,callerdesk_did_number=?,callerdesk_call_group=?,callerdesk_inbound_enabled=?,callerdesk_outbound_enabled=? WHERE id=?`,
      [clean(req.body.didId)||null,didNumber,clean(req.body.callGroup)||null,req.body.inboundEnabled===false?0:1,req.body.outboundEnabled===false?0:1,branch.id]);
    res.json({success:true});
  }));

  router.post('/leads/:leadId/contact', authenticate, requireCrmAccess, asyncRoute(async (req, res) => {
    const config = await loadConfig(pool, Number(req.user.organizationId || 1));
    const [[lead]] = await pool.execute('SELECT id,student_name,phone,email,city FROM crm_leads WHERE id=? AND business_unit_id=? AND deleted_at_utc IS NULL', [req.params.leadId, req.businessUnit.id]);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    const result = await callerDeskRequest('savecontact_v2', config, { contact_num: digits(lead.phone), contact_name: lead.student_name, email: lead.email || '', address: lead.city || '' });
    res.json({ success: true, data: unwrap(result) });
  }));

  router.post('/leads/:leadId/call', authenticate, requireCrmAccess, asyncRoute(async (req, res) => {
    const config = await loadConfig(pool, Number(req.user.organizationId || 1));
    const [[lead]] = await pool.execute('SELECT id,student_name,phone,branch_id FROM crm_leads WHERE id=? AND business_unit_id=? AND deleted_at_utc IS NULL', [req.params.leadId, req.businessUnit.id]);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    const agentUserId=Number(req.body.agentUserId||req.user.id);
    const [[agent]] = await pool.execute(`SELECT callerdesk_member_id member_id,callerdesk_member_number member_number,
      callerdesk_call_group call_group FROM app_users WHERE id=? AND callerdesk_enabled=1 LIMIT 1`,[agentUserId]);
    if (!agent) return res.status(400).json({ message: 'Map this CRM user to a CallerDesk member, or select an agent' });
    const mode = clean(req.body.mode) || 'member';
    const [[branchDid]] = await pool.execute('SELECT callerdesk_did_number did_number,callerdesk_call_group call_group FROM branches WHERE id=? AND callerdesk_outbound_enabled=1 LIMIT 1',[lead.branch_id]);
    const deskphone = clean(req.body.deskphone) || branchDid?.did_number || config.defaultDeskphone;
    if (!deskphone && mode !== 'mobile') return res.status(400).json({ message: 'Choose or configure a CallerDesk deskphone' });
    let endpoint = 'click_to_call_v4', method = 'GET', params = { call_from_did: 1, deskphone, member_id: agent.member_id, calling_party_b: digits(lead.phone) };
    if (mode === 'normal') { endpoint = 'click_to_call_v2'; params = { call_from_did: 1, deskphone, calling_party_a: agent.member_number, calling_party_b: digits(lead.phone) }; }
    if (mode === 'group') { endpoint = 'click_to_call_v2'; params = { call_from_did: 1, deskphone, calling_party_a: agent.member_number, calling_party_b: digits(lead.phone), group_name: clean(req.body.groupName) || branchDid?.call_group || agent.call_group || config.defaultGroupName }; }
    if (mode === 'reverse') { endpoint = 'click_to_call_v3'; params = { call_from_did: 1, deskphone, member_id: agent.member_id, calling_party_b: digits(lead.phone), group_name: clean(req.body.groupName) || branchDid?.call_group || agent.call_group || config.defaultGroupName }; }
    if (mode === 'mobile') { endpoint = 'singleleg-clicktocall'; method = 'POST'; params = { agent_number: agent.member_number, customer_number: digits(lead.phone), callerid: deskphone }; }
    if (req.body.callStartTime) params.call_start_time = req.body.callStartTime;
    const result = await callerDeskRequest(endpoint, config, params, method);
    const data = unwrap(result) || {};
    const sid = clean(data.CallSid || data.call_sid || data.sid || data.campid || data.callerid) || null;
    const [insert] = await pool.execute(`INSERT INTO crm_call_activities(integration_id,business_unit_id,lead_id,agent_user_id,callerdesk_sid,campaign_reference,
      direction,source_number,destination_number,agent_number,status,call_group,raw_payload) VALUES(?,?,?,?,?,?,'WEBOBD',?,?,?,'initiated',?,?)`,
      [config.id,req.businessUnit.id,lead.id,agentUserId,sid,clean(data.campid)||null,deskphone,digits(lead.phone),agent.member_number,params.group_name||null,JSON.stringify(result)]);
    await pool.execute(`INSERT INTO crm_lead_activities(lead_id,activity_type,summary,details_json,actor_user_id) VALUES(?,'call_initiated',?,?,?)`,
      [lead.id,`Call initiated to ${lead.student_name}`,JSON.stringify({callActivityId:insert.insertId,mode}),req.user.id]);
    res.status(201).json({ success: true, data: { callActivityId: Number(insert.insertId), provider: result } });
  }));

  router.get('/leads/:leadId/calls', authenticate, requireCrmAccess, asyncRoute(async (req, res) => {
    const [rows] = await pool.execute(`SELECT id,callerdesk_sid callerDeskSid,direction,status,call_result callResult,started_at_utc startedAt,
      duration_seconds durationSeconds,talk_seconds talkSeconds,recording_url recordingUrl,disposition,notes,followup_at_utc followupAt,created_at_utc createdAt
      FROM crm_call_activities WHERE lead_id=? AND business_unit_id=? ORDER BY created_at_utc DESC`, [req.params.leadId,req.businessUnit.id]);
    res.json({ data: rows });
  }));

  router.patch('/calls/:id/disposition', authenticate, requireCrmAccess, asyncRoute(async (req, res) => {
    const disposition = clean(req.body.disposition);
    if (!disposition) return res.status(400).json({ message: 'Choose a disposition' });
    const [result] = await pool.execute(`UPDATE crm_call_activities SET disposition=?,notes=?,followup_at_utc=? WHERE id=? AND business_unit_id=?`,
      [disposition,clean(req.body.notes)||null,req.body.followupAt||null,req.params.id,req.businessUnit.id]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Call not found' });
    res.json({ success: true });
  }));

  router.post('/campaigns', authenticate, requireCrmAccess, asyncRoute(async (req, res) => {
    const config = await loadConfig(pool, Number(req.user.organizationId || 1));
    const leadIds = [...new Set((req.body.leadIds || []).map(Number).filter(Number.isInteger))];
    if (!clean(req.body.name) || !leadIds.length) return res.status(400).json({ message: 'Campaign name and at least one lead are required' });
    const mode = ['manual','preview','progressive'].includes(req.body.mode) ? req.body.mode : 'preview';
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [created] = await connection.execute(`INSERT INTO crm_dialer_campaigns(integration_id,business_unit_id,name,mode,agent_user_id,deskphone,call_group,max_attempts,retry_delay_minutes,created_by_user_id)
        VALUES(?,?,?,?,?,?,?,?,?,?)`, [config.id,req.businessUnit.id,clean(req.body.name),mode,req.body.agentUserId||null,clean(req.body.deskphone)||config.defaultDeskphone,
        clean(req.body.callGroup)||config.defaultGroupName,Math.min(Math.max(Number(req.body.maxAttempts)||2,1),5),Math.max(Number(req.body.retryDelayMinutes)||30,5),req.user.id]);
      for (const leadId of leadIds) await connection.execute(`INSERT IGNORE INTO crm_dialer_queue(campaign_id,lead_id)
        SELECT ?,id FROM crm_leads WHERE id=? AND business_unit_id=? AND deleted_at_utc IS NULL`, [created.insertId,leadId,req.businessUnit.id]);
      await connection.commit(); res.status(201).json({ success:true,data:{id:Number(created.insertId)} });
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }));

  router.get('/campaigns', authenticate, requireCrmAccess, asyncRoute(async (req, res) => {
    const [rows] = await pool.execute(`SELECT c.id,c.name,c.mode,c.status,c.deskphone,c.call_group callGroup,c.max_attempts maxAttempts,
      c.created_at_utc createdAt,COALESCE(e.employee_name,u.email) createdBy,
      COUNT(q.id) total,SUM(q.status IN ('queued','retry')) pending,SUM(q.status='connected') connected,SUM(q.status IN ('completed','failed','skipped')) finished
      FROM crm_dialer_campaigns c LEFT JOIN crm_dialer_queue q ON q.campaign_id=c.id
      LEFT JOIN app_users u ON u.id=c.created_by_user_id LEFT JOIN employees e ON e.id=u.employee_id
      WHERE c.business_unit_id=? GROUP BY c.id,e.employee_name,u.email ORDER BY c.created_at_utc DESC`,[req.businessUnit.id]);
    res.json({data:rows});
  }));

  router.patch('/campaigns/:id/status', authenticate, requireCrmAccess, asyncRoute(async (req,res) => {
    const status = clean(req.body.status);
    if (!['running','paused','cancelled'].includes(status)) return res.status(400).json({message:'Invalid campaign status'});
    await pool.execute('UPDATE crm_dialer_campaigns SET status=? WHERE id=? AND business_unit_id=?',[status,req.params.id,req.businessUnit.id]);
    res.json({success:true});
  }));

  // Progressive mode deliberately advances one lead per explicit request. This prevents accidental bulk calling.
  router.post('/campaigns/:id/dial-next', authenticate, requireCrmAccess, asyncRoute(async (req,res) => {
    const [[campaign]] = await pool.execute(`SELECT * FROM crm_dialer_campaigns WHERE id=? AND business_unit_id=? AND status='running'`,[req.params.id,req.businessUnit.id]);
    if (!campaign) return res.status(400).json({message:'Start the campaign before dialling'});
    const [[item]] = await pool.execute(`SELECT q.id,q.lead_id leadId FROM crm_dialer_queue q WHERE q.campaign_id=? AND q.status IN ('queued','retry')
      AND (q.next_attempt_at_utc IS NULL OR q.next_attempt_at_utc<=CURRENT_TIMESTAMP()) ORDER BY q.id LIMIT 1`,[campaign.id]);
    if (!item) { await pool.execute("UPDATE crm_dialer_campaigns SET status='completed' WHERE id=?",[campaign.id]); return res.json({success:true,complete:true}); }
    req.params.leadId = item.leadId; req.body = {...req.body,agentUserId:campaign.agent_user_id,deskphone:campaign.deskphone,groupName:campaign.call_group,mode:'group'};
    // Queue claiming is atomic; the client then uses the normal lead call endpoint for provider execution.
    await pool.execute("UPDATE crm_dialer_queue SET status='dialling',attempts=attempts+1 WHERE id=? AND status IN ('queued','retry')",[item.id]);
    res.json({success:true,data:{queueItemId:Number(item.id),leadId:Number(item.leadId),callRequest:req.body}});
  }));

  return router;
}

export function createCallerDeskWebhookRoutes(pool) {
  const router = Router();
  router.all('/webhook/:configId', asyncRoute(async (req,res) => {
    const [[integration]] = await pool.execute(`SELECT id,config FROM crm_integrations WHERE id=? AND deleted_at IS NULL AND UPPER(status) IN ('ACTIVE','CONNECTED')`,[req.params.configId]);
    const config = integration ? {...integration,...json(integration.config)} : null;
    if (!config || clean(req.query.secret || req.headers['x-webhook-secret']) !== config.webhookSecret) return res.status(401).json({message:'Invalid webhook secret'});
    const body = {...req.query,...req.body};
    const sid = clean(body.CallSid || body.call_sid || body.Uniqueid || body.campid);
    const inbound = clean(body.Direction).toUpperCase()==='IVR';
    const customer = digits(inbound ? body.SourceNumber : (body.DestinationNumber || body.SourceNumber));
    const destinationDid = clean(body.DestinationNumber);
    const [[didMap]] = destinationDid ? await pool.execute(`SELECT id branch_id FROM branches WHERE callerdesk_did_number=? AND callerdesk_inbound_enabled=1 AND is_active=1 LIMIT 1`,[destinationDid]) : [[]];
    const businessUnitId = Number(config.defaultBusinessUnitId || 1);
    const [[lead]] = customer ? await pool.execute(`SELECT id,business_unit_id FROM crm_leads WHERE ${didMap?.branch_id?'branch_id=? AND ':''}
      (normalized_phone=? OR RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)=?) AND deleted_at_utc IS NULL ORDER BY id DESC LIMIT 1`,
      [...(didMap?.branch_id?[didMap.branch_id]:[]),customer,customer]) : [[]];
    const recordCalls=config.recordCalls!==false;
    const storedBody={...body};
    if(!recordCalls)for(const key of Object.keys(storedBody))if(/record(ing)?(_?url|_?id|identifier)?/i.test(key))delete storedBody[key];
    const recordingUrl=recordCalls?clean(body.CallRecordingUrl||body.call_recording_url||body.recording_url)||null:null;
    if(!recordCalls)body.CallRecordingUrl=null;
    const values = [config.id,Number(lead?.business_unit_id||businessUnitId),lead?.id||null,sid||null,clean(body.campid)||null,clean(body.Direction)||null,
      clean(body.SourceNumber)||null,clean(body.DestinationNumber)||null,clean(body.DialWhomNumber)||null,clean(body.Status)||'completed',clean(body.callresult)||null,
      body.StartTime||null,body.EndTime||null,Number(body.CallDuration)||0,Number(body.TalkDuration)||0,recordingUrl,
      Number.isFinite(Number(body.coins))?Number(body.coins):null,clean(body.call_group)||null,JSON.stringify(storedBody)];
    await pool.execute(`INSERT INTO crm_call_activities(integration_id,business_unit_id,lead_id,callerdesk_sid,campaign_reference,direction,source_number,destination_number,agent_number,status,call_result,
      started_at_utc,ended_at_utc,duration_seconds,talk_seconds,recording_url,coins,call_group,raw_payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE lead_id=COALESCE(VALUES(lead_id),lead_id),status=VALUES(status),call_result=VALUES(call_result),started_at_utc=VALUES(started_at_utc),
      ended_at_utc=VALUES(ended_at_utc),duration_seconds=VALUES(duration_seconds),talk_seconds=VALUES(talk_seconds),recording_url=VALUES(recording_url),coins=VALUES(coins),raw_payload=VALUES(raw_payload)`,values);
    if (lead?.id) await pool.execute(`INSERT INTO crm_lead_activities(lead_id,activity_type,summary,details_json) VALUES(?,'call_completed',?,?)`,
      [lead.id,`Call ${clean(body.Status)||'completed'} · ${Number(body.TalkDuration)||0}s talk time`,JSON.stringify({callerDeskSid:sid,recordingUrl:body.CallRecordingUrl||null})]);
    res.json({success:true});
  }));
  return router;
}

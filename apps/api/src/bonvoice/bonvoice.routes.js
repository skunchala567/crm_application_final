import { Router } from 'express';
import axios from 'axios';
import crypto from 'node:crypto';
import { decryptToken,encryptToken,getMasterKey } from '../integration-hub/crypto-utils.js';
import { requestUnitId,unitScopeFilter,unitPreferenceOrder } from '../integration-scope.js';
import { branchScopeSql,canAccessBranch } from '../rbac/branch-scope.js';

const BASE='https://backend.pbx.bonvoice.com';
const clean=v=>String(v??'').trim(),digits=v=>clean(v).replace(/\D/g,'').slice(-12),json=v=>{try{return typeof v==='string'?JSON.parse(v||'{}'):(v||{});}catch{return {};}};
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const terminal=v=>/completed|hangup|missed|failed|busy|rejected|no.?answer|ended/i.test(clean(v));

async function config(pool,req,required=true){
  const unit=unitScopeFilter(requestUnitId(req));
  const [[row]]=await pool.execute(`SELECT * FROM crm_integrations WHERE organization_id=? AND deleted_at IS NULL AND LOWER(provider)='bonvoice'${unit.sql} ORDER BY ${unitPreferenceOrder(requestUnitId(req))}id DESC LIMIT 1`,[Number(req.user?.organizationId||1),...unit.params]);
  if(!row&&required)throw Object.assign(new Error('Configure BonVoice first'),{status:400});if(!row)return null;
  if(required&&!['ACTIVE','CONNECTED'].includes(clean(row.status).toUpperCase()))throw Object.assign(new Error('BonVoice integration is inactive'),{status:400});
  const c=json(row.config);return {...row,...c,username:c.usernameEncrypted?decryptToken(c.usernameEncrypted,getMasterKey()):'',password:c.passwordEncrypted?decryptToken(c.passwordEncrypted,getMasterKey()):'',token:c.tokenEncrypted?decryptToken(c.tokenEncrypted,getMasterKey()):''};
}
async function auth(c,force=false){
  if(c.token&&!force)return c.token;
  if(!c.username||!c.password)throw Object.assign(new Error('Enter BonVoice username and password'),{status:400});
  const {data}=await axios.post(`${BASE}/usermanagement/external-auth/`,{username:c.username,password:c.password},{timeout:20000});
  const token=clean(data?.data?.token);if(!token)throw Object.assign(new Error(data?.message||'BonVoice authentication failed'),{status:502});return token;
}
async function request(c,method,path,data){
  try{return (await axios({method,url:`${BASE}${path}`,data,timeout:25000,headers:{Accept:'application/json','Content-Type':'application/json',Authorization:`Token ${await auth(c)}`}})).data;}
  catch(error){const detail=error.response?.data?.message||error.response?.data?.responseDescription||error.response?.data||error.message;throw Object.assign(new Error(typeof detail==='string'?detail:JSON.stringify(detail)),{status:502});}
}
const normalizeLog=value=>value?.data?.outbound||value?.data||value||{};

async function mappedDidForBranch(pool,integrationId,branchId){
  if(!branchId)return null;
  const [[did]]=await pool.execute(`SELECT d.id,d.did_number didNumber,d.channel_id channelId
    FROM crm_bonvoice_did_branches m JOIN crm_bonvoice_dids d ON d.id=m.did_id
    WHERE d.integration_id=? AND m.branch_id=? AND d.is_active=1 AND d.outbound_enabled=1
    ORDER BY m.is_primary_outbound DESC,d.id ASC LIMIT 1`,[integrationId,branchId]);
  return did||null;
}

async function resolveInboundRoute(pool,integrationId,businessUnitId,didNumber,customer){
  if(!didNumber)return {branch:null,lead:null,reason:'unresolved'};
  const [mappings]=await pool.execute(`SELECT d.id didId,d.primary_branch_id primaryBranchId,m.branch_id branchId
    FROM crm_bonvoice_dids d JOIN crm_bonvoice_did_branches m ON m.did_id=d.id
    WHERE d.integration_id=? AND d.did_number=? AND d.is_active=1 AND d.inbound_enabled=1
    ORDER BY m.branch_id`,[integrationId,didNumber]);
  if(!mappings.length)return {branch:null,lead:null,reason:'unresolved'};
  const branchIds=mappings.map(item=>Number(item.branchId));
  let lead=null;
  if(customer){
    const marks=branchIds.map(()=>'?').join(',');
    [[lead]]=await pool.execute(`SELECT id,business_unit_id,branch_id FROM crm_leads
      WHERE branch_id IN (${marks}) AND normalized_phone=? AND deleted_at_utc IS NULL
      ${businessUnitId?'AND business_unit_id=?':''} ORDER BY id DESC LIMIT 1`,[...branchIds,customer,...(businessUnitId?[businessUnitId]:[])]);
  }
  if(lead)return {branch:Number(lead.branch_id),lead,reason:'lead_match'};
  if(branchIds.length===1)return {branch:branchIds[0],lead:null,reason:'did_unique'};
  const primary=Number(mappings[0].primaryBranchId)||null;
  if(primary&&branchIds.includes(primary))return {branch:primary,lead:null,reason:'shared_did_primary'};
  return {branch:null,lead:null,reason:'unresolved'};
}

export function createBonvoiceRoutes(pool,authenticate,requireCrmAccess,requireUserAdmin){
  const router=Router();
  const recordingStreamPath=callId=>{const expires=Date.now()+15*60*1000,secret=process.env.JWT_SECRET||'local-development-secret-change-me',signature=crypto.createHmac('sha256',secret).update(`${callId}:${expires}`).digest('hex');return `/api/bonvoice/recordings/${callId}?expires=${expires}&signature=${signature}`;};
  // Audio elements cannot attach the CRM Bearer header. Activity History uses
  // a short-lived HMAC URL instead, while this endpoint keeps the provider's
  // recording URL private and overrides download-only response headers.
  router.get('/recordings/:callId',wrap(async(req,res)=>{
    const callId=Number(req.params.callId),expires=Number(req.query.expires),signature=clean(req.query.signature),secret=process.env.JWT_SECRET||'local-development-secret-change-me';
    if(!Number.isInteger(callId)||!secret||!expires||expires<Date.now())return res.status(401).json({message:'Recording link expired'});
    const expected=crypto.createHmac('sha256',secret).update(`${callId}:${expires}`).digest('hex');
    if(signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return res.status(401).json({message:'Invalid recording link'});
    const [[call]]=await pool.execute(`SELECT ca.recording_url FROM crm_call_activities ca JOIN crm_integrations i ON i.id=ca.integration_id WHERE ca.id=? AND LOWER(i.provider)='bonvoice' LIMIT 1`,[callId]);
    if(!call?.recording_url)return res.status(404).json({message:'Recording not found'});
    let url;try{url=new URL(call.recording_url);}catch{return res.status(404).json({message:'Invalid recording URL'});}if(url.protocol!=='https:')return res.status(403).json({message:'Insecure recording URL refused'});
    const range=clean(req.headers.range),provider=await axios.get(url.toString(),{responseType:'stream',timeout:30000,maxRedirects:3,headers:range?{Range:range}:undefined,validateStatus:status=>status===200||status===206});
    const providerType=clean(provider.headers['content-type']).toLowerCase();
    const contentType=providerType.startsWith('audio/')?provider.headers['content-type']:(url.pathname.toLowerCase().endsWith('.wav')?'audio/wav':'audio/mpeg');
    res.status(provider.status).set({
      'Content-Type':contentType,
      'Content-Disposition':'inline',
      'Cache-Control':'private, max-age=300',
      'Accept-Ranges':provider.headers['accept-ranges']||'bytes',
      ...(provider.headers['content-length']?{'Content-Length':provider.headers['content-length']}:{}) ,
      ...(provider.headers['content-range']?{'Content-Range':provider.headers['content-range']}:{}) ,
    });
    provider.data.on('error',error=>res.destroy(error));provider.data.pipe(res);
  }));
  router.get('/config',authenticate,requireCrmAccess,wrap(async(req,res)=>{const c=await config(pool,req,false),[[mapping]]=await pool.execute("SELECT id FROM mse_hrm_app_users WHERE id=? AND bonvoice_enabled=1 AND NULLIF(bonvoice_agent_number,'') IS NOT NULL",[req.user.id]);res.json({data:c?{configured:true,accountName:c.name,hasPassword:Boolean(c.password),hasToken:Boolean(c.token),defaultDid:c.defaultDid||'',defaultChannelId:c.defaultChannelId||'1',ringStrategy:c.ringStrategy||'ringall',recordCalls:c.recordCalls!==false,isActive:['ACTIVE','CONNECTED'].includes(clean(c.status).toUpperCase()),userAssigned:Boolean(mapping),webhookPath:`/api/bonvoice/webhook/${c.id}?secret=${c.webhookSecret}`}:{configured:false,defaultChannelId:'1',ringStrategy:'ringall',recordCalls:true,userAssigned:false}});}));
  router.put('/config',authenticate,requireCrmAccess,requireUserAdmin,wrap(async(req,res)=>{const old=await config(pool,req,false),username=clean(req.body.username),password=clean(req.body.password),token=clean(req.body.token);if(!old&&!token&&(!username||!password))return res.status(400).json({message:'Enter BonVoice credentials or an API token'});const stored={usernameEncrypted:username?encryptToken(username,getMasterKey()):old?.usernameEncrypted||null,passwordEncrypted:password?encryptToken(password,getMasterKey()):old?.passwordEncrypted||null,tokenEncrypted:token?encryptToken(token.replace(/^Token\s+/i,''),getMasterKey()):old?.tokenEncrypted||null,defaultDid:digits(req.body.defaultDid),defaultChannelId:clean(req.body.defaultChannelId)||'1',ringStrategy:clean(req.body.ringStrategy)||'ringall',recordCalls:req.body.recordCalls!==false,defaultBusinessUnitId:req.businessUnit.id,webhookSecret:old?.webhookSecret||crypto.randomBytes(24).toString('hex')};if(!stored.defaultDid)return res.status(400).json({message:'Default DID is required'});/* Settings -> Integrations owns the on/off switch; a credentials save from
     here leaves the status alone unless the body carries one. */
    const status=typeof req.body.isActive==='boolean'?(req.body.isActive?'ACTIVE':'INACTIVE'):null;
    if(old)await pool.execute('UPDATE crm_integrations SET name=?,config=?,status=COALESCE(?,status),updated_by=? WHERE id=?',[clean(req.body.accountName)||'BonVoice',JSON.stringify(stored),status,req.user.id,old.id]);else await pool.execute(`INSERT INTO crm_integrations(organization_id,business_unit_id,name,type,provider,config,status,created_by) VALUES(?,?,?,'VOICE','bonvoice',?,COALESCE(?,'ACTIVE'),?)`,[Number(req.user.organizationId||1),requestUnitId(req),clean(req.body.accountName)||'BonVoice',JSON.stringify(stored),status,req.user.id]);res.json({success:true,message:'BonVoice configuration saved'});}));
  router.post('/test',authenticate,requireCrmAccess,requireUserAdmin,wrap(async(req,res)=>{const c=await config(pool,req);await request(c,'GET','/external-route-list/');res.json({success:true,message:'BonVoice authentication and route access are working'});}));
  router.get('/routes',authenticate,requireCrmAccess,wrap(async(req,res)=>res.json({data:await request(await config(pool,req),'GET','/external-route-list/')})));
  router.post('/routes/voicebot',authenticate,requireCrmAccess,requireUserAdmin,wrap(async(req,res)=>{const body={scope:'voicebot',did:digits(req.body.did),provider_name:clean(req.body.providerName),template_url:clean(req.body.templateUrl)};if(!body.did||!body.provider_name||!/^wss:\/\//i.test(body.template_url))return res.status(400).json({message:'DID, provider name and a valid wss:// template URL are required'});res.status(201).json({success:true,data:await request(await config(pool,req),'POST','/external-route-create/',body)});}));
  router.get('/dids',authenticate,requireCrmAccess,wrap(async(req,res)=>{
    const c=await config(pool,req),scope=branchScopeSql(req.user,'b.id');
    const [branches]=await pool.execute(`SELECT b.id,b.branch_name name FROM mse_hrm_branches b WHERE b.is_active=1 AND ${scope.sql} ORDER BY b.branch_name`,scope.params);
    const [dids]=await pool.execute(`SELECT id,did_number didNumber,label,channel_id channelId,inbound_enabled inboundEnabled,
      outbound_enabled outboundEnabled,primary_branch_id primaryBranchId,is_active isActive
      FROM crm_bonvoice_dids WHERE integration_id=? ORDER BY label,did_number`,[c.id]);
    const [links]=await pool.execute(`SELECT m.did_id didId,m.branch_id branchId,m.is_primary_outbound isPrimaryOutbound
      FROM crm_bonvoice_did_branches m JOIN crm_bonvoice_dids d ON d.id=m.did_id
      WHERE d.integration_id=?`,[c.id]);
    const allowed=new Set(branches.map(item=>Number(item.id)));
    res.json({data:dids.map(item=>({...item,id:Number(item.id),primaryBranchId:item.primaryBranchId?Number(item.primaryBranchId):null,
      inboundEnabled:Boolean(item.inboundEnabled),outboundEnabled:Boolean(item.outboundEnabled),isActive:Boolean(item.isActive),
      branches:links.filter(link=>Number(link.didId)===Number(item.id)&&allowed.has(Number(link.branchId))).map(link=>({branchId:Number(link.branchId),isPrimaryOutbound:Boolean(link.isPrimaryOutbound)}))})),
      branches:branches.map(item=>({id:Number(item.id),name:item.name}))});
  }));
  const saveDid=async(req,res)=>{
    const c=await config(pool,req),id=Number(req.params.id)||null,didNumber=digits(req.body.didNumber),label=clean(req.body.label),channelId=clean(req.body.channelId)||'1';
    const mappings=Array.isArray(req.body.branches)?req.body.branches:[],branchIds=[...new Set(mappings.map(item=>Number(item.branchId)).filter(Number.isInteger))];
    if(!didNumber)return res.status(400).json({message:'Enter a valid DID number'});
    if(!branchIds.length)return res.status(400).json({message:'Map the DID to at least one branch'});
    if(branchIds.some(branchId=>!canAccessBranch(req.user,branchId)))return res.status(403).json({message:'One or more branches are outside your access'});
    const primaryBranchId=Number(req.body.primaryBranchId)||null;
    if(primaryBranchId&&!branchIds.includes(primaryBranchId))return res.status(400).json({message:'The inbound primary branch must be mapped to this DID'});
    if(branchIds.length>1&&req.body.inboundEnabled!==false&&!primaryBranchId)return res.status(400).json({message:'Choose an inbound primary branch for a shared DID'});
    const connection=await pool.getConnection();
    try{
      await connection.beginTransaction();
      let didId=id;
      if(id){
        const [updated]=await connection.execute(`UPDATE crm_bonvoice_dids SET did_number=?,label=?,channel_id=?,inbound_enabled=?,outbound_enabled=?,primary_branch_id=?,is_active=? WHERE id=? AND integration_id=?`,[didNumber,label||null,channelId,req.body.inboundEnabled===false?0:1,req.body.outboundEnabled===false?0:1,primaryBranchId,req.body.isActive===false?0:1,id,c.id]);
        if(!updated.affectedRows){await connection.rollback();return res.status(404).json({message:'DID not found'});}
        await connection.execute('DELETE FROM crm_bonvoice_did_branches WHERE did_id=?',[id]);
      }else{
        const [created]=await connection.execute(`INSERT INTO crm_bonvoice_dids(integration_id,did_number,label,channel_id,inbound_enabled,outbound_enabled,primary_branch_id,is_active) VALUES(?,?,?,?,?,?,?,?)`,[c.id,didNumber,label||null,channelId,req.body.inboundEnabled===false?0:1,req.body.outboundEnabled===false?0:1,primaryBranchId,req.body.isActive===false?0:1]);didId=Number(created.insertId);
      }
      for(const branchId of branchIds){
        const isPrimary=mappings.some(item=>Number(item.branchId)===branchId&&item.isPrimaryOutbound===true);
        if(isPrimary)await connection.execute(`UPDATE crm_bonvoice_did_branches m JOIN crm_bonvoice_dids d ON d.id=m.did_id SET m.is_primary_outbound=0 WHERE d.integration_id=? AND m.branch_id=?`,[c.id,branchId]);
        await connection.execute('INSERT INTO crm_bonvoice_did_branches(did_id,branch_id,is_primary_outbound) VALUES(?,?,?)',[didId,branchId,isPrimary?1:0]);
      }
      await connection.commit();res.status(id?200:201).json({success:true,data:{id:didId}});
    }catch(error){await connection.rollback();if(error.code==='ER_DUP_ENTRY')return res.status(409).json({message:'This DID already exists in the BonVoice account'});throw error;}finally{connection.release();}
  };
  router.post('/dids',authenticate,requireCrmAccess,requireUserAdmin,wrap(saveDid));
  router.put('/dids/:id',authenticate,requireCrmAccess,requireUserAdmin,wrap(saveDid));
  router.delete('/dids/:id',authenticate,requireCrmAccess,requireUserAdmin,wrap(async(req,res)=>{const c=await config(pool,req),[removed]=await pool.execute('DELETE FROM crm_bonvoice_dids WHERE id=? AND integration_id=?',[req.params.id,c.id]);if(!removed.affectedRows)return res.status(404).json({message:'DID not found'});res.json({success:true});}));
  router.post('/leads/:leadId/call',authenticate,requireCrmAccess,wrap(async(req,res)=>{const c=await config(pool,req),[[lead]]=await pool.execute('SELECT id,phone,branch_id FROM crm_leads WHERE id=? AND business_unit_id=? AND deleted_at_utc IS NULL',[req.params.leadId,req.businessUnit.id]);if(!lead)return res.status(404).json({message:'Lead not found'});const mapped=await mappedDidForBranch(pool,c.id,lead.branch_id),[[user]]=await pool.execute("SELECT bonvoice_agent_number FROM mse_hrm_app_users WHERE id=? AND bonvoice_enabled=1",[req.user.id]);const did=digits(mapped?.didNumber||c.defaultDid),channelId=clean(mapped?.channelId||c.defaultChannelId)||'1',agent=digits(user?.bonvoice_agent_number),customer=digits(lead.phone),eventID=crypto.randomUUID().replace(/-/g,'').slice(0,16);if(!agent)return res.status(400).json({message:'Map your BonVoice agent destination in User Management'});if(!did||customer.length<10)return res.status(400).json({message:'Configure a valid BonVoice DID and lead phone'});const payload={autocallType:'3',destination:agent,ringStrategy:c.ringStrategy||'ringall',legACallerID:did,legAChannelID:channelId,legADialAttempts:'1',legBDestination:customer,legBCallerID:did,legBChannelID:channelId,legBDialAttempts:'1',eventID,callBackParams:{crmLeadId:String(lead.id),crmBusinessUnitId:String(req.businessUnit.id)}};const [created]=await pool.execute(`INSERT INTO crm_call_activities(integration_id,business_unit_id,branch_id,routing_reason,lead_id,agent_user_id,callerdesk_sid,direction,source_number,destination_number,agent_number,status,raw_payload) VALUES(?,?,?,'outbound_branch',?,?,?,'outbound',?,?,?,'requesting',?)`,[c.id,req.businessUnit.id,lead.branch_id,lead.id,req.user.id,eventID,did,customer,agent,JSON.stringify({request:payload})]);try{const provider=await request(c,'POST','/autoDialManagement/autoCallBridging/',payload);if(Number(provider?.responseCode)!==200)throw new Error(provider?.responseDescription||'BonVoice rejected the call');await pool.execute("UPDATE crm_call_activities SET status='initiated',raw_payload=? WHERE id=?",[JSON.stringify({request:payload,response:provider}),created.insertId]);res.status(201).json({success:true,data:{callActivityId:Number(created.insertId),callingModeLabel:'Two-leg IVR bridge',provider}});}catch(error){await pool.execute("UPDATE crm_call_activities SET status='failed',call_result=? WHERE id=?",[clean(error.message).slice(0,100),created.insertId]);throw error;}}));
  router.get('/calls/:id/status',authenticate,requireCrmAccess,wrap(async(req,res)=>{const c=await config(pool,req),[[call]]=await pool.execute('SELECT * FROM crm_call_activities WHERE id=? AND integration_id=? AND business_unit_id=?',[req.params.id,c.id,req.businessUnit.id]);if(!call)return res.status(404).json({message:'Call not found'});const result=await request(c,'GET',`/get-autocall-log/${encodeURIComponent(call.callerdesk_sid)}/`),logs=Array.isArray(result?.data)?result.data:[],log=logs.find(x=>clean(x.eventID)===clean(call.callerdesk_sid))||logs.at(-1);if(log){const ended=log.EndTime||null,recording=c.recordCalls!==false?clean(log.ResourceURL)||null:null;await pool.execute(`UPDATE crm_call_activities SET status=?,call_result=?,started_at_utc=COALESCE(started_at_utc,?),ended_at_utc=COALESCE(?,ended_at_utc),duration_seconds=?,recording_url=COALESCE(?,recording_url),raw_payload=? WHERE id=?`,[clean(log.Status)||'initiated',clean(log.AgentStatus),log.StartTime||null,ended,Number(log.CallDuration)||0,recording,JSON.stringify({...json(call.raw_payload),log}),call.id]);}const [[updated]]=await pool.execute('SELECT * FROM crm_call_activities WHERE id=?',[call.id]),isTerminal=Boolean(updated.ended_at_utc)||terminal(updated.status);res.json({data:{id:Number(updated.id),status:updated.status,isLive:!isTerminal,isTerminal,durationSeconds:Number(updated.duration_seconds)||0,recordingUrl:updated.recording_url?recordingStreamPath(updated.id):null}});}));
  return router;
}

export function createBonvoiceWebhookRoutes(pool){
  const router=Router();
  router.all('/webhook/:integrationId',wrap(async(req,res)=>{
    const [[row]]=await pool.execute("SELECT id,business_unit_id,config FROM crm_integrations WHERE id=? AND LOWER(provider)='bonvoice' AND deleted_at IS NULL",[req.params.integrationId]);
    const c=row?json(row.config):null;
    if(!c||clean(req.query.secret||req.headers['x-webhook-secret'])!==c.webhookSecret)return res.status(401).json({message:'Invalid webhook secret'});
    const body={...req.query,...req.body},params=typeof body.callBackParams==='string'?json(body.callBackParams):body.callBackParams||{};
    const eventID=clean(body.eventID),callID=clean(body.callID),reference=eventID||callID;
    if(!reference)return res.status(400).json({message:'BonVoice eventID or callID is required'});
    const inbound=clean(body.Direction).toLowerCase()==='inbound';
    const customer=digits(inbound?body.SourceNumber:body.DestinationNumber);
    // BonVoice installations have used both DisplayNumber and DestinationNumber
    // for the called DID, so accept the explicit DID variants first.
    const did=digits(body.DID||body.did||body.DisplayNumber||(inbound?body.DestinationNumber:body.SourceNumber));
    let lead=null,branchId=null,routingReason=inbound?'unresolved':'provider_callback';
    if(params.crmLeadId){
      [[lead]]=await pool.execute(`SELECT id,business_unit_id,branch_id FROM crm_leads WHERE id=? AND deleted_at_utc IS NULL ${row.business_unit_id?'AND business_unit_id=?':''}`,[params.crmLeadId,...(row.business_unit_id?[row.business_unit_id]:[])]);
      if(lead){branchId=Number(lead.branch_id)||null;routingReason='callback_lead';}
    }
    if(!lead&&inbound){
      const route=await resolveInboundRoute(pool,row.id,row.business_unit_id,did,customer);
      lead=route.lead;branchId=route.branch;routingReason=route.reason;
    }
    if(!lead&&customer&&branchId){
      [[lead]]=await pool.execute('SELECT id,business_unit_id,branch_id FROM crm_leads WHERE branch_id=? AND normalized_phone=? AND deleted_at_utc IS NULL ORDER BY id DESC LIMIT 1',[branchId,customer]);
    }
    const refs=[eventID,callID].filter(Boolean),placeholders=refs.map(()=>'?').join(',');
    const [[existing]]=await pool.execute(`SELECT id,raw_payload FROM crm_call_activities WHERE integration_id=? AND callerdesk_sid IN (${placeholders}) ORDER BY id LIMIT 1`,[row.id,...refs]);
    const recording=c.recordCalls!==false?clean(body.ResourceURL)||null:null,status=clean(body.Status||body.AgentStatus)||'initiated';
    const ended=(body.EndTime||clean(body.callType)==='2')?(body.EndTime||new Date()):null;
    const raw=JSON.stringify({...json(existing?.raw_payload),webhook:body,inboundRouting:{did,branchId,routingReason}});
    if(existing)await pool.execute(`UPDATE crm_call_activities SET lead_id=COALESCE(lead_id,?),branch_id=COALESCE(branch_id,?),routing_reason=COALESCE(routing_reason,?),status=?,call_result=?,started_at_utc=COALESCE(started_at_utc,?),ended_at_utc=COALESCE(?,ended_at_utc),duration_seconds=COALESCE(NULLIF(?,0),duration_seconds),recording_url=COALESCE(?,recording_url),notes=COALESCE(NULLIF(?,''),notes),raw_payload=? WHERE id=?`,[lead?.id||null,branchId,routingReason,status,clean(body.AgentStatus),body.StartTime||null,ended,Number(body.CallDuration)||0,recording,body.DTMF?`IVR DTMF: ${clean(body.DTMF)}`:'',raw,existing.id]);
    else await pool.execute(`INSERT INTO crm_call_activities(integration_id,business_unit_id,branch_id,routing_reason,lead_id,callerdesk_sid,direction,source_number,destination_number,status,call_result,started_at_utc,ended_at_utc,duration_seconds,recording_url,notes,raw_payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[row.id,Number(lead?.business_unit_id||c.defaultBusinessUnitId||1),branchId,routingReason,lead?.id||null,reference,clean(body.Direction),clean(body.SourceNumber),clean(body.DestinationNumber),status,clean(body.AgentStatus),body.StartTime||null,ended,Number(body.CallDuration)||0,recording,body.DTMF?`IVR DTMF: ${clean(body.DTMF)}`:null,raw]);
    res.json({success:true,routing:{did,branchId,reason:routingReason}});
  }));
  return router;
}

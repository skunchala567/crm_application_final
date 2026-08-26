import { Router } from 'express';
import axios from 'axios';
import crypto from 'node:crypto';
import { decryptToken,encryptToken,getMasterKey } from '../integration-hub/crypto-utils.js';
import { canAccessBranch } from '../rbac/branch-scope.js';
import { requestUnitId, unitScopeFilter, unitPreferenceOrder } from '../integration-scope.js';

const BASE='https://api-smartflo.tatateleservices.com';
const tokens=new Map();
const providerQueues=new Map();
const clean=value=>String(value??'').trim();
const digits=value=>clean(value).replace(/\D/g,'').slice(-15);
const hasNumber=(value,target)=>clean(value).split(',').some(part=>digits(part)===digits(target));
const parse=value=>{try{return typeof value==='string'?JSON.parse(value||'{}'):(value||{});}catch{return {};}};
const list=value=>Array.isArray(value)?value:Array.isArray(value?.results)?value.results:Array.isArray(value?.data)?value.data:[];
// Tata can deliver the same webhook fields at the root or inside a data/event
// envelope (depending on the webhook version configured in Smartflo).
const webhookObjects=body=>{
  const objects=[],visit=value=>{
    if(!value||typeof value!=='object'||Array.isArray(value)||objects.includes(value))return;
    objects.push(value);
    for(const key of ['data','event','payload','call','result'])visit(value[key]);
  };
  visit(body);return objects;
};
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
const CALLING_MODES=new Set(['AGENT_FIRST','CUSTOMER_FIRST']);
const providerErrorMessage=value=>{
  if(typeof value==='string')return value;
  if(Array.isArray(value))return value.map(providerErrorMessage).filter(Boolean).join(' ');
  if(value&&typeof value==='object')return providerErrorMessage(value.message)||Object.entries(value).map(([field,detail])=>`${field.replace(/_/g,' ')}: ${providerErrorMessage(detail)}`).filter(item=>!item.endsWith(': ')).join(' ');
  return clean(value);
};
const Q850={0:['UNSPECIFIED','Unspecified'],1:['UNALLOCATED_NUMBER','Unallocated number'],2:['NO_ROUTE_TRANSIT_NET','No route to transit network'],3:['NO_ROUTE_DESTINATION','No route to destination'],4:['SPECIAL_INFORMATION_TONE','Special information tone'],5:['MISDIALLED_TRUNK_PREFIX','Misdialled trunk prefix'],6:['CHANNEL_UNACCEPTABLE','Channel unacceptable'],7:['CALL_AWARDED_DELIVERED','Call awarded and delivered'],8:['PREEMPTION','Pre-emption'],9:['PREEMPTION_REUSE','Pre-emption; circuit reserved'],13:['CALL_COMPLETED_ELSEWHERE','Call completed elsewhere'],16:['NORMAL_CLEARING','Normal call clearing'],17:['USER_BUSY','User busy'],18:['NO_USER_RESPONSE','No user responding'],19:['NO_ANSWER','No answer from user'],20:['SUBSCRIBER_ABSENT','Subscriber absent'],21:['CALL_REJECTED','Call rejected'],22:['NUMBER_CHANGED','Number changed'],23:['REDIRECTION_TO_NEW_DESTINATION','Redirection to new destination'],25:['EXCHANGE_ROUTING_ERROR','Exchange routing error'],26:['NON_SELECTED_USER_CLEARING','Non-selected user clearing'],27:['DESTINATION_OUT_OF_ORDER','Destination out of order'],28:['INVALID_NUMBER_FORMAT','Invalid number format'],29:['FACILITY_REJECTED','Facility rejected'],30:['RESPONSE_TO_STATUS_ENQUIRY','Response to status enquiry'],31:['NORMAL_UNSPECIFIED','Normal, unspecified'],34:['NORMAL_CIRCUIT_CONGESTION','No circuit/channel available'],38:['NETWORK_OUT_OF_ORDER','Network out of order'],39:['CONNECTION_OUT_OF_SERVICE','Connection out of service'],40:['CONNECTION_OPERATIONAL','Connection operational'],41:['NORMAL_TEMPORARY_FAILURE','Temporary failure'],42:['SWITCH_CONGESTION','Switching equipment congestion'],43:['ACCESS_INFO_DISCARDED','Access information discarded'],44:['REQUESTED_CHAN_UNAVAIL','Requested channel unavailable'],45:['PRE_EMPTED','Pre-empted'],46:['PRECEDENCE_CALL_BLOCKED','Precedence call blocked'],47:['RESOURCE_UNAVAILABLE','Resource unavailable'],49:['QOS_NOT_AVAILABLE','Quality of service unavailable'],50:['FACILITY_NOT_SUBSCRIBED','Facility not subscribed'],52:['OUTGOING_CALL_BARRED','Outgoing calls barred'],53:['OUTGOING_CALLS_BARRED_CUG','Outgoing calls barred within CUG'],54:['INCOMING_CALL_BARRED','Incoming calls barred'],55:['INCOMING_CALLS_BARRED_CUG','Incoming calls barred within CUG'],57:['BEARERCAPABILITY_NOTAUTH','Bearer capability not authorized'],58:['BEARERCAPABILITY_NOTAVAIL','Bearer capability unavailable'],62:['INCONSISTENT_OUTGOING_INFO_ELEMENT','Inconsistent outgoing access information'],63:['SERVICE_UNAVAILABLE','Service unavailable'],65:['BEARERCAPABILITY_NOTIMPL','Bearer capability not implemented'],66:['CHAN_NOT_IMPLEMENTED','Channel type not implemented'],69:['FACILITY_NOT_IMPLEMENTED','Facility not implemented'],70:['RESTRICTED_BEARER_CAPABILITY_AVAILABLE','Restricted bearer capability only'],79:['SERVICE_NOT_IMPLEMENTED','Service not implemented'],81:['INVALID_CALL_REFERENCE','Invalid call reference'],82:['CHANNEL_DOES_NOT_EXIST','Channel does not exist'],83:['SUSPENDED_CALL_EXISTS','Suspended call exists'],84:['CALL_IDENTITY_INUSE','Call identity in use'],85:['NO_CALL_SUSPENDED','No call suspended'],86:['CALL_IDENTITY_CLEARED','Call identity cleared'],87:['USER_NOT_MEMBER_OF_CUG','User not member of CUG'],88:['INCOMPATIBLE_DESTINATION','Incompatible destination'],90:['NON_EXISTENT_CUG','Non-existent CUG'],91:['INVALID_TRANSIT_NETWORK_SELECTION','Invalid transit network selection'],95:['INVALID_MSG_UNSPECIFIED','Invalid message'],96:['MANDATORY_IE_MISSING','Mandatory information missing'],97:['MESSAGE_TYPE_NONEXIST','Message type not implemented'],98:['WRONG_MESSAGE','Message incompatible with call state'],99:['IE_NONEXIST','Information element not implemented'],100:['INVALID_IE_CONTENTS','Invalid information element'],101:['WRONG_CALL_STATE','Wrong call state'],102:['RECOVERY_ON_TIMER_EXPIRE','Recovery on timer expiry'],103:['MANDATORY_IE_LENGTH_ERROR','Mandatory parameter length error'],110:['MESSAGE_WITH_UNRECOGNIZED_PARAMETER','Unrecognized parameter'],111:['PROTOCOL_ERROR','Protocol error'],127:['INTERWORKING','Interworking, unspecified']};

function callSnapshot(row){
  const raw=parse(row.raw_payload),provider=raw.cdr||raw.webhook||raw;
  const code=Number(provider.hangup_cause_code??provider.hangupcause_code??provider.$hangupcause_code??provider.q850_cause_code);
  const mapped=Number.isFinite(code)?Q850[code]:null;
  return {id:Number(row.id),status:clean(row.status),outcome:clean(row.call_result),disposition:clean(row.disposition),durationSeconds:Number(row.duration_seconds)||0,talkSeconds:Number(row.talk_seconds)||0,recordingUrl:row.recording_url||null,reference:row.callerdesk_sid,hangup:{code:Number.isFinite(code)?code:null,key:clean(provider.hangup_cause_key??provider.hangupcause_key??provider.$hangupcause_key)||mapped?.[0]||'',description:clean(provider.hangup_cause_description??provider.hangupcause_desc??provider.$hangupcause_desc??provider.hangup_cause)||mapped?.[1]||''}};
}

function enqueue(configId,task){
  // Smartflo applies a fairly small account-level burst limit. Serialize calls
  // for an integration and leave a short gap so multiple mounted CRM screens
  // cannot exhaust it together.
  const previous=providerQueues.get(configId)||Promise.resolve();
  const current=previous.catch(()=>{}).then(task).finally(()=>wait(350));
  providerQueues.set(configId,current);
  current.finally(()=>{if(providerQueues.get(configId)===current)providerQueues.delete(configId);}).catch(()=>{});
  return current;
}

/*
 * The Smartflo account this business unit works with.
 *
 * Takes the request rather than an organization id: an account belongs to a
 * business unit, so the unit on the request is half the question. A unit with
 * no Smartflo account of its own has none -- it does not inherit the one the
 * unit next door configured -- unless that account was deliberately shared.
 */
async function integration(pool,req,required=true){
  const organizationId=Number(req.user?.organizationId||1),unitId=requestUnitId(req);
  const unit=unitScopeFilter(unitId);
  const [[row]]=await pool.execute(
    `SELECT * FROM crm_integrations WHERE organization_id=? AND deleted_at IS NULL AND LOWER(provider)='smartflo'${unit.sql}
      ORDER BY ${unitPreferenceOrder(unitId)}id DESC LIMIT 1`,
    [organizationId,...unit.params]);
  if(!row&&required)throw Object.assign(new Error('Configure Smartflo in Integrations first'),{status:400});
  if(!row)return null;
  if(required&&!['ACTIVE','CONNECTED'].includes(String(row.status).toUpperCase()))throw Object.assign(new Error('Smartflo integration is inactive'),{status:400});
  const cfg=parse(row.config);return {...row,...cfg,callingMode:CALLING_MODES.has(cfg.callingMode)?cfg.callingMode:'AGENT_FIRST',email:cfg.emailEncrypted?decryptToken(cfg.emailEncrypted,getMasterKey()):'',password:cfg.passwordEncrypted?decryptToken(cfg.passwordEncrypted,getMasterKey()):'',permanentToken:cfg.permanentTokenEncrypted?decryptToken(cfg.permanentTokenEncrypted,getMasterKey()):'',supportApiKey:cfg.supportApiKeyEncrypted?decryptToken(cfg.supportApiKeyEncrypted,getMasterKey()):''};
}
async function token(config,force=false){
  if(config.permanentToken)return config.permanentToken;
  if(!config.email||!config.password)throw Object.assign(new Error('Enter a Smartflo login email and password, or a permanent access token'),{status:400});
  const cached=tokens.get(config.id);if(!force&&cached&&cached.expiresAt>Date.now()+60000)return cached.value;
  const {data}=await axios.post(`${BASE}/v1/auth/login`,{email:config.email,password:config.password},{timeout:20000,headers:{Accept:'application/json'}});
  if(!data?.access_token)throw Object.assign(new Error(data?.message||'Smartflo authentication failed'),{status:502});
  tokens.set(config.id,{value:data.access_token,expiresAt:Date.now()+(Number(data.expires_in)||3600)*1000});return data.access_token;
}
async function authorization(config,force=false){
  // Smartflo's current API-token contract requires the Bearer scheme. Accept a
  // token pasted with or without the scheme so existing configurations keep
  // working and we never send "Bearer Bearer ...".
  const value=clean(await token(config,force)).replace(/^Bearer\s+/i,'');
  return `Bearer ${value}`;
}
async function request(config,method,path,{params,data}={}){
  return enqueue(config.id,async()=>{
    let forceToken=false,error;
    for(let attempt=0;attempt<3;attempt++){
      try{return (await axios({method,url:`${BASE}${path}`,params,data,timeout:25000,headers:{Accept:'application/json','Content-Type':'application/json',Authorization:await authorization(config,forceToken)}})).data;}
      catch(caught){
        error=caught;
        if(caught.response?.status===401&&!config.permanentToken&&!forceToken){tokens.delete(config.id);forceToken=true;continue;}
        if(caught.response?.status!==429||attempt===2)break;
        const retryAfter=Number(caught.response.headers?.['retry-after']);
        await wait(Number.isFinite(retryAfter)?Math.min(Math.max(retryAfter*1000,1000),10000):1000*(attempt+1));
      }
    }
    const detail=error.response?.status===401&&config.permanentToken
      ? 'The configured Smartflo API token has been deleted, blacklisted, expired, or revoked. Replace it with a new API Connect token in Smartflo Settings.'
      : error.response?.data?.message||error.response?.data||error.message;
    const status=error.response?.status===429?429:502;
    throw Object.assign(new Error(providerErrorMessage(detail)||'Smartflo request failed'),{status,providerStatus:error.response?.status,providerMessage:providerErrorMessage(error.response?.data)});
  });
}

async function initiateSmartfloCall(config,{agentNumber,customerNumber,callerId,customIdentifier,callTimeout,customerRingTimeout,onPrepared}){
  const callingMode=CALLING_MODES.has(config.callingMode)?config.callingMode:'AGENT_FIRST';
  const common={async:1,call_timeout:Math.min(Math.max(Number(callTimeout)||Number(config.callTimeout)||300,30),7200),custom_identifier:customIdentifier};
  let endpoint,payload,label;
  if(callingMode==='CUSTOMER_FIRST'){
    if(!config.supportApiKey)throw Object.assign(new Error('Configure the Click-to-Call Support API key for Customer First mode'),{status:400});
    endpoint='/v1/click_to_call_support';label='Customer First – Click to Call Support';
    // The Support API key is itself bound to its allowed DID(s). Supplying the
    // lead's branch DID can conflict with that binding and Tata rejects the
    // request with "Provide a valid caller_id". Let the key select its DID.
    payload={customer_number:customerNumber,api_key:config.supportApiKey,...common,customer_ring_timeout:Math.min(Math.max(Number(customerRingTimeout)||Number(config.customerRingTimeout)||30,10),30)};
  }else{
    if(!agentNumber)throw Object.assign(new Error('Map this CRM user to a Smartflo agent in User Management'),{status:400});
    endpoint='/v1/click_to_call';label='Agent First – Standard Click to Call';
    payload={agent_number:agentNumber,destination_number:customerNumber,...common,...(callerId?{caller_id:digits(callerId)}:{})};
  }
  if(onPrepared)await onPrepared({callingMode,label,endpoint,payload});
  const provider=await request(config,'POST',endpoint,{data:payload});
  if(provider?.success===false)throw Object.assign(new Error(clean(provider.message)||'Smartflo rejected the call request'),{status:502});
  const reference=clean(provider?.ref_id||provider?.data?.ref_id);
  if(!reference)throw Object.assign(new Error('Smartflo accepted the request without returning the required ref_id'),{status:502});
  return {callingMode,label,endpoint,payload,provider,reference};
}

export function createSmartfloRoutes(pool,authenticate,requireCrmAccess,requireUserAdmin){
  const router=Router(),org=req=>Number(req.user.organizationId||1);
  router.get('/config',authenticate,requireCrmAccess,wrap(async(req,res)=>{const item=await integration(pool,req,false);const [[mapping]]=await pool.execute(`SELECT id FROM app_users WHERE id=? AND smartflo_enabled=1 AND NULLIF(smartflo_agent_id,'') IS NOT NULL LIMIT 1`,[req.user.id]);res.json({data:item?{id:Number(item.id),configured:true,accountName:item.name,email:item.email,hasPassword:Boolean(item.password),hasPermanentToken:Boolean(item.permanentToken),callingMode:item.callingMode||'AGENT_FIRST',hasSupportApiKey:Boolean(item.supportApiKey),defaultDid:item.defaultDid||'',defaultDepartmentId:item.defaultDepartmentId||'',callTimeout:Number(item.callTimeout)||300,customerRingTimeout:Number(item.customerRingTimeout)||30,recordCalls:item.recordCalls!==false,webhookPath:`/api/smartflo/webhook/${item.id}?secret=${item.webhookSecret}`,isActive:['ACTIVE','CONNECTED'].includes(String(item.status).toUpperCase()),userAssigned:Boolean(mapping)}:{configured:false,callingMode:'AGENT_FIRST',callTimeout:300,customerRingTimeout:30,recordCalls:true,userAssigned:false}});}));
  router.put('/config',authenticate,requireCrmAccess,requireUserAdmin,wrap(async(req,res)=>{const existing=await integration(pool,req,false),email=clean(req.body.email),password=clean(req.body.password),permanentToken=clean(req.body.permanentToken),supportApiKey=clean(req.body.supportApiKey),callingMode=clean(req.body.callingMode)||'AGENT_FIRST';if(!existing&&!permanentToken&&(!email||!password))return res.status(400).json({message:'Enter a Smartflo login email and password, or a permanent access token'});
    if(!CALLING_MODES.has(callingMode))return res.status(400).json({message:'Select a valid Smartflo calling mode'});
    const hasEffectiveSupportApiKey=Boolean(supportApiKey||(!req.body.clearSupportApiKey&&(existing?.supportApiKey||existing?.supportApiKeyEncrypted)));
    if(callingMode==='CUSTOMER_FIRST'&&!hasEffectiveSupportApiKey)return res.status(400).json({message:'Click-to-Call Support API key is required for Customer First mode'});
    const normalizedPermanentToken=permanentToken.replace(/^Bearer\s+/i,'');
    if(permanentToken&&(/\*/.test(normalizedPermanentToken)||normalizedPermanentToken.split('.').length!==3||normalizedPermanentToken.length<80))return res.status(400).json({message:'The pasted value is not the complete Smartflo API token. The masked value shown in the token table (containing ****) cannot authenticate API calls. Use the copy icon or copy the full token from the generation dialog.'});
    const cfg={emailEncrypted:email?encryptToken(email,getMasterKey()):existing?.emailEncrypted||null,passwordEncrypted:password?encryptToken(password,getMasterKey()):existing?.passwordEncrypted||null,permanentTokenEncrypted:permanentToken?encryptToken(permanentToken,getMasterKey()):req.body.clearPermanentToken?null:existing?.permanentTokenEncrypted||null,supportApiKeyEncrypted:supportApiKey?encryptToken(supportApiKey,getMasterKey()):req.body.clearSupportApiKey?null:existing?.supportApiKeyEncrypted||null,callingMode,defaultDid:clean(req.body.defaultDid),defaultDepartmentId:clean(req.body.defaultDepartmentId),callTimeout:Math.min(Math.max(Number(req.body.callTimeout)||300,30),7200),customerRingTimeout:Math.min(Math.max(Number(req.body.customerRingTimeout)||30,10),30),recordCalls:req.body.recordCalls!==false,defaultBusinessUnitId:req.businessUnit.id,webhookSecret:existing?.webhookSecret||crypto.randomBytes(24).toString('hex')};
    /*
     * Any branch that could place a call for this unit.
     *
     * crm_branch_pipelines records only the branches somebody has *restricted*
     * to certain pipelines; a branch with no rows there is shown in every
     * pipeline, which is what all of them are by default. Inner-joining it
     * therefore matched nothing at all, and saving this config was refused as
     * "no outbound DID configured" however many branches had one.
     */
    const [[configuredDid]]=await pool.execute(`SELECT b.id FROM branches b
       WHERE b.is_active=1 AND b.smartflo_outbound_enabled=1 AND NULLIF(b.smartflo_did_number,'') IS NOT NULL
         AND (NOT EXISTS (SELECT 1 FROM crm_branch_pipelines bp WHERE bp.branch_id=b.id)
              OR EXISTS (SELECT 1 FROM crm_branch_pipelines bp
                           JOIN crm_lead_pipelines p ON p.id=bp.pipeline_id
                          WHERE bp.branch_id=b.id AND p.business_unit_id=?))
       LIMIT 1`,[req.businessUnit.id]);
    if(!cfg.defaultDid&&!configuredDid)return res.status(400).json({message:'Configure a default Smartflo DID or enable an outbound Smartflo DID for at least one branch'});
    let validationWarning='';
    if(permanentToken){
      const validationConfig={...existing,id:existing?.id||`validation:${org(req)}`,permanentToken};
      const probes=[];
      for(const [name,path] of [['Users','/v1/users'],['My Numbers','/v1/my_number'],['Live Calls','/v1/live_calls']]){
        try{
          const value=await request(validationConfig,'GET',path,{params:name==='Users'?{limit:1}:undefined});
          if(value?.success===false)throw Object.assign(new Error(clean(value.message)||`${name} access was rejected`),{providerStatus:400,providerMessage:clean(value.message)});
          probes.push({name,ok:true});
        }catch(error){probes.push({name,ok:false,error});}
      }
      const working=probes.filter(item=>item.ok),failed=probes.filter(item=>!item.ok);
      if(!working.length){
        const providerMessage=failed.map(item=>item.error?.providerMessage||item.error?.message).find(Boolean)||'Token rejected';
        if(/deleted|blacklist|expired|revoked/i.test(providerMessage))return res.status(400).json({message:'Every required Smartflo API rejected this token. Tata reports it as deleted or blacklisted even though the portal row shows otherwise. Copy the complete token value—not the masked table text—or ask Tata to activate the newly generated token for API use.'});
        return res.status(400).json({message:`Every required Smartflo API rejected the token: ${providerMessage}. Check token expiry and ask Tata to confirm API access for this token.`});
      }
      if(failed.length)validationWarning=` Token saved, but Tata denied: ${failed.map(item=>item.name).join(', ')}. Those features will remain unavailable until Tata enables them.`;
    }
    if(existing)await pool.execute('UPDATE crm_integrations SET name=?,config=?,status=?,updated_by=? WHERE id=?',[clean(req.body.accountName)||'Tata Smartflo',JSON.stringify(cfg),req.body.isActive===false?'INACTIVE':'ACTIVE',req.user.id,existing.id]);
    else await pool.execute(`INSERT INTO crm_integrations(organization_id,business_unit_id,name,type,provider,config,status,created_by) VALUES(?,?,?,'SMS','smartflo',?,?,?)`,[org(req),requestUnitId(req),clean(req.body.accountName)||'Tata Smartflo',JSON.stringify(cfg),req.body.isActive===false?'INACTIVE':'ACTIVE',req.user.id]);res.json({success:true,message:`Smartflo configuration saved.${validationWarning}`});}));
  router.post('/test',authenticate,requireCrmAccess,requireUserAdmin,wrap(async(req,res)=>{const cfg=await integration(pool,req);await token(cfg,true);await Promise.all([request(cfg,'GET','/v1/my_number'),request(cfg,'GET','/v1/ivrs'),request(cfg,'GET','/v1/users')]);res.json({success:true,message:'Smartflo connection and required DID, IVR and user permissions are working'});}));
  for(const [name,path] of Object.entries({users:'/v1/users',numbers:'/v1/my_number',departments:'/v1/departments',ivrs:'/v1/ivrs',live:'/v1/live_calls'}))router.get(`/${name}`,authenticate,requireCrmAccess,wrap(async(req,res)=>{res.json({data:await request(await integration(pool,req),'GET',path,{params:req.query})});}));
  router.get('/capabilities',authenticate,requireCrmAccess,requireUserAdmin,wrap(async(req,res)=>{const cfg=await integration(pool,req);const checks=await Promise.all(Object.entries({numbers:'/v1/my_number',ivrs:'/v1/ivrs',departments:'/v1/departments',users:'/v1/users',liveCalls:'/v1/live_calls'}).map(async([name,path])=>{try{await request(cfg,'GET',path);return[name,{available:true}];}catch(error){return[name,{available:false,message:error.message}];}}));res.json({data:Object.fromEntries(checks)});}));
  router.post('/ivrs',authenticate,requireCrmAccess,requireUserAdmin,wrap(async(req,res)=>{const result=await request(await integration(pool,req),'POST','/v1/ivr',{data:req.body});res.status(201).json({success:true,data:result});}));
  router.put('/ivrs/:id',authenticate,requireCrmAccess,requireUserAdmin,wrap(async(req,res)=>{res.json({success:true,data:await request(await integration(pool,req),'PUT',`/v1/ivr/${encodeURIComponent(req.params.id)}`,{data:req.body})});}));
  router.delete('/ivrs/:id',authenticate,requireCrmAccess,requireUserAdmin,wrap(async(req,res)=>{res.json({success:true,data:await request(await integration(pool,req),'DELETE',`/v1/ivr/${encodeURIComponent(req.params.id)}`)});}));
  router.put('/branches/:branchId/route-ivr',authenticate,requireCrmAccess,requireUserAdmin,wrap(async(req,res)=>{if(!canAccessBranch(req.user,req.params.branchId))return res.status(404).json({message:'Branch not found'});const cfg=await integration(pool,req);const [[branch]]=await pool.execute(`SELECT id,branch_name,smartflo_did_id,smartflo_did_number,smartflo_ivr_id,smartflo_ivr_name FROM branches WHERE id=? AND is_active=1 LIMIT 1`,[req.params.branchId]);if(!branch)return res.status(404).json({message:'Branch not found'});if(!branch.smartflo_did_id||!branch.smartflo_ivr_id)return res.status(400).json({message:'Select both a Smartflo DID and IVR for this branch'});
    const result=await request(cfg,'PUT',`/v1/my_number/${encodeURIComponent(branch.smartflo_did_id)}`,{data:{name:branch.branch_name,description:`CRM branch ${branch.branch_name}`,destination:`ivr||${branch.smartflo_ivr_id}`}});res.json({success:true,message:`${branch.smartflo_did_number} is routed to ${branch.smartflo_ivr_name||'the selected IVR'}`,data:result});}));
  router.get('/reports',authenticate,requireCrmAccess,wrap(async(req,res)=>{res.json({data:await request(await integration(pool,req),'GET','/v1/call/records',{params:{from_date:req.query.from,to_date:req.query.to,page:req.query.page||1,limit:Math.min(Number(req.query.limit)||50,200),did_numbers:req.query.did||undefined,agents:req.query.agent||undefined,direction:req.query.direction||undefined}})});}));
  router.post('/leads/:leadId/sync',authenticate,requireCrmAccess,wrap(async(req,res)=>{
    const cfg=await integration(pool,req,false);
    if(!cfg||!['ACTIVE','CONNECTED'].includes(String(cfg.status).toUpperCase()))return res.json({success:true,data:{synced:0}});
    const [[lead]]=await pool.execute('SELECT id,phone,business_unit_id FROM crm_leads WHERE id=? AND business_unit_id=? AND deleted_at_utc IS NULL',[req.params.leadId,req.businessUnit.id]);
    if(!lead)return res.status(404).json({message:'Lead not found'});
    const from=new Date(Date.now()-30*86400000).toISOString().slice(0,19).replace('T',' ');
    // Smartflo's CDR endpoint accepts the destination parameter in some
    // accounts but returns an empty result set for it in others, even though
    // the same completed calls are returned without that parameter. Fetch the
    // bounded CDR page and apply the phone match locally below.
    const response=await request(cfg,'GET','/v1/call/records',{params:{from_date:from,page:1,limit:100}});
    const records=list(response).filter(item=>{
      const customer=digits(item.client_number??item.customer_number??item.destination_number??item.destination);
      return customer&&customer===digits(lead.phone);
    });
    let synced=0;
    for(const item of records){
      const callId=clean(item.ref_id||item.call_id||item.uuid||item.id);if(!callId)continue;
      const started=clean(item.start_stamp)||[clean(item.date),clean(item.time)].filter(Boolean).join(' ')||null;
      const recordingUrl=cfg.recordCalls!==false?clean(item.recording_url)||null:null;
      const [[existingCall]]=await pool.execute('SELECT raw_payload FROM crm_call_activities WHERE integration_id=? AND callerdesk_sid=? LIMIT 1',[cfg.id,callId]);
      const mergedPayload={...parse(existingCall?.raw_payload),cdr:item};
      await pool.execute(`INSERT INTO crm_call_activities(integration_id,business_unit_id,lead_id,callerdesk_sid,direction,source_number,destination_number,agent_number,status,call_result,started_at_utc,ended_at_utc,duration_seconds,talk_seconds,recording_url,raw_payload)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE lead_id=VALUES(lead_id),status=VALUES(status),call_result=VALUES(call_result),started_at_utc=COALESCE(VALUES(started_at_utc),started_at_utc),ended_at_utc=COALESCE(VALUES(ended_at_utc),ended_at_utc),duration_seconds=VALUES(duration_seconds),talk_seconds=VALUES(talk_seconds),recording_url=COALESCE(VALUES(recording_url),recording_url),raw_payload=VALUES(raw_payload)`,
        [cfg.id,lead.business_unit_id,lead.id,callId,clean(item.direction)||'outbound',clean(item.did_number||item.caller_id_num),clean(item.client_number||item.customer_number||item.destination_number),clean(item.agent_number),clean(item.status)||'completed',clean(item.description||item.hangup_cause||item.reason),started,clean(item.end_stamp)||null,Number(item.call_duration)||0,Number(item.answered_seconds)||0,recordingUrl,JSON.stringify(mergedPayload)]);
      synced++;
    }
    res.json({success:true,data:{synced}});
  }));
  router.get('/calls/:callActivityId/status',authenticate,requireCrmAccess,wrap(async(req,res)=>{
    const cfg=await integration(pool,req);
    let [[call]]=await pool.execute('SELECT * FROM crm_call_activities WHERE id=? AND integration_id=? AND business_unit_id=? LIMIT 1',[req.params.callActivityId,cfg.id,req.businessUnit.id]);
    if(!call)return res.status(404).json({message:'Call activity not found'});
    const wasLive=Boolean(parse(call.raw_payload)?.live);
    let cdrFound=false;
    const liveResponse=await request(cfg,'GET','/v1/live_calls',{params:{agent_number:call.agent_number}});
    const live=list(liveResponse).find(item=>hasNumber(item.customer_number,call.destination_number)||hasNumber(item.destination,call.destination_number));
    if(live){
      const state=clean(live.state||live.queue_state||'active');
      await pool.execute('UPDATE crm_call_activities SET status=?,started_at_utc=COALESCE(started_at_utc,?),raw_payload=? WHERE id=?',[state,live.created_at||null,JSON.stringify({...parse(call.raw_payload),live}),call.id]);
    }else if(Date.now()-new Date(call.created_at_utc).getTime()>8000){
      const from=new Date(new Date(call.created_at_utc).getTime()-300000).toISOString().slice(0,19).replace('T',' ');
      const cdrResponse=await request(cfg,'GET','/v1/call/records',{params:{from_date:from,page:1,limit:100}});
      const cdrs=list(cdrResponse),reference=clean(call.callerdesk_sid);
      const cdr=cdrs.find(item=>[item.ref_id,item.call_id,item.uuid,item.id].map(clean).includes(reference))
        ||cdrs.filter(item=>digits(item.client_number??item.customer_number??item.destination_number??item.destination)===digits(call.destination_number)).sort((a,b)=>clean(b.end_stamp).localeCompare(clean(a.end_stamp)))[0];
      if(cdr){
        cdrFound=true;
        const recordingUrl=cfg.recordCalls!==false?clean(cdr.recording_url)||null:null;
        const outcome=clean(cdr.hangup_cause_description||cdr.description||cdr.hangup_cause||cdr.reason).slice(0,100);
        await pool.execute(`UPDATE crm_call_activities SET status=?,call_result=?,started_at_utc=COALESCE(started_at_utc,?),ended_at_utc=?,duration_seconds=?,talk_seconds=?,recording_url=COALESCE(?,recording_url),raw_payload=? WHERE id=?`,[clean(cdr.status)||'completed',outcome,[clean(cdr.date),clean(cdr.time)].filter(Boolean).join(' ')||null,clean(cdr.end_stamp)||null,Number(cdr.call_duration)||0,Number(cdr.answered_seconds)||0,recordingUrl,JSON.stringify({...parse(call.raw_payload),cdr}),call.id]);
      }
    }
    [[call]]=await pool.execute('SELECT * FROM crm_call_activities WHERE id=?',[call.id]);
    let data=callSnapshot(call);
    const ageSeconds=Math.max(0,(Date.now()-new Date(call.created_at_utc).getTime())/1000);
    // A call that was published in Live Calls and then disappears has ended,
    // even when Tata's CDR takes a few seconds to become available. Waiting
    // for the generic startup timeout left the browser timer running after the
    // agent had already disconnected. A returned CDR is historical by
    // definition and is terminal as well.
    let terminal=!live&&(wasLive||cdrFound||['completed','answered','missed','failed','busy','rejected','no answer','not active','ended','hangup'].some(value=>`${data.status} ${data.outcome}`.toLowerCase().includes(value)));
    if(!live&&wasLive&&!cdrFound){
      await pool.execute(`UPDATE crm_call_activities SET status='ended',call_result=COALESCE(NULLIF(call_result,''),'Call ended by agent'),ended_at_utc=COALESCE(ended_at_utc,CURRENT_TIMESTAMP(6)) WHERE id=?`,[call.id]);
      [[call]]=await pool.execute('SELECT * FROM crm_call_activities WHERE id=?',[call.id]);
      data=callSnapshot(call);terminal=true;
    }
    // Tata's documented first leg rings for about 30 seconds. If the request
    // has never appeared in Live Calls and no CDR exists after a short delivery
    // allowance, it is no longer actionable and must not look like a live call.
    if(!live&&!terminal&&ageSeconds>45){
      await pool.execute(`UPDATE crm_call_activities SET status='not active',call_result=COALESCE(NULLIF(call_result,''),'No active call published by Smartflo'),ended_at_utc=COALESCE(ended_at_utc,CURRENT_TIMESTAMP(6)) WHERE id=?`,[call.id]);
      [[call]]=await pool.execute('SELECT * FROM crm_call_activities WHERE id=?',[call.id]);
      data=callSnapshot(call);terminal=true;
    }
    res.json({data:{...data,isLive:Boolean(live),isTerminal:terminal,live:live?{callId:clean(live.call_id),state:clean(live.state),queueState:clean(live.queue_state),callTime:clean(live.call_time),agentName:clean(live.agent_name)}:null}});
  }));
  router.post('/calls/:callActivityId/hangup',authenticate,requireCrmAccess,wrap(async(req,res)=>{
    const cfg=await integration(pool,req);const [[call]]=await pool.execute('SELECT id,callerdesk_sid,agent_number,destination_number,raw_payload FROM crm_call_activities WHERE id=? AND integration_id=? AND business_unit_id=? LIMIT 1',[req.params.callActivityId,cfg.id,req.businessUnit.id]);if(!call)return res.status(404).json({message:'Call activity not found'});
    // Some Smartflo accounts return a click-to-call ref_id which is accepted
    // for correlation but rejected by the Hangup API. Resolve the active
    // conversation and use its call_id, which Tata documents as the direct
    // live-call identifier. Never select an unrelated call for this agent.
    const storedLive=parse(call.raw_payload)?.live;
    let callId=clean(storedLive?.call_id);
    if(!callId){
      const liveResponse=await request(cfg,'GET','/v1/live_calls',{params:{agent_number:call.agent_number}});
      const live=list(liveResponse).find(item=>hasNumber(item.customer_number,call.destination_number)||hasNumber(item.destination,call.destination_number));
      callId=clean(live?.call_id);
      if(live)await pool.execute('UPDATE crm_call_activities SET raw_payload=? WHERE id=?',[JSON.stringify({...parse(call.raw_payload),live}),call.id]);
    }
    // Do not fall back to the initiation ref_id after Tata has already rejected
    // that identifier for this account. Hangup is valid only while Live Calls
    // publishes the conversation and its call_id.
    if(!callId)return res.status(409).json({message:'The call is not active in Smartflo yet, or it has already ended. Wait for Ringing/Answered status and try again.'});
    const provider=await request(cfg,'POST','/v1/call/hangup',{data:{call_id:callId}});
    if(provider?.success===false)return res.status(409).json({message:clean(provider.message)||'Smartflo could not hang up this call'});
    await pool.execute(`UPDATE crm_call_activities SET status='hangup requested' WHERE id=?`,[call.id]);res.json({success:true,data:provider});
  }));
  router.post('/leads/:leadId/call',authenticate,requireCrmAccess,wrap(async(req,res)=>{const cfg=await integration(pool,req);const [[lead]]=await pool.execute('SELECT id,student_name,phone,branch_id FROM crm_leads WHERE id=? AND business_unit_id=? AND deleted_at_utc IS NULL',[req.params.leadId,req.businessUnit.id]);if(!lead)return res.status(404).json({message:'Lead not found'});
    const agentUserId=Number(req.body.agentUserId||req.user.id);const [[agent]]=await pool.execute('SELECT smartflo_agent_id,smartflo_agent_number FROM app_users WHERE id=? AND smartflo_enabled=1',[agentUserId]);if(!agent)return res.status(400).json({message:'Smartflo calling is not assigned to this user in User Management'});
    const [[branch]]=await pool.execute('SELECT smartflo_did_number FROM branches WHERE id=? AND smartflo_outbound_enabled=1',[lead.branch_id]);const callerId=clean(req.body.callerId)||branch?.smartflo_did_number||cfg.defaultDid;if(!callerId)return res.status(400).json({message:'Configure a Smartflo DID for this branch'});
    const agentNumber=agent?clean(agent.smartflo_agent_id)||digits(agent.smartflo_agent_number):'';
    const customerNumber=digits(lead.phone);if(customerNumber.length<10||customerNumber.length>13)return res.status(400).json({message:'Smartflo requires the customer number to contain 10 to 13 digits'});
    if(agentNumber&&digits(agentNumber)===customerNumber)return res.status(400).json({message:'The Smartflo agent and customer numbers cannot be the same'});
    const customIdentifier={crm_lead_id:String(lead.id),crm_call_key:crypto.randomUUID().replace(/-/g,'')};let callActivityId=null,loggedRequest=null;
    try{
      const result=await initiateSmartfloCall(cfg,{agentNumber,customerNumber,callerId,customIdentifier,callTimeout:req.body.callTimeout,customerRingTimeout:req.body.customerRingTimeout,onPrepared:async prepared=>{
        loggedRequest={...prepared.payload,api_key:prepared.payload.api_key?'[REDACTED]':undefined,calling_mode:prepared.callingMode,api_endpoint:prepared.endpoint};
        const [created]=await pool.execute(`INSERT INTO crm_call_activities(integration_id,business_unit_id,lead_id,agent_user_id,callerdesk_sid,direction,source_number,destination_number,agent_number,status,raw_payload) VALUES(?,?,?,?,?,'outbound',?,?,?,'requesting',?)`,[cfg.id,req.businessUnit.id,lead.id,agentUserId,customIdentifier.crm_call_key,callerId,customerNumber,agentNumber||null,JSON.stringify({request:loggedRequest})]);callActivityId=Number(created.insertId);
      }});
      await pool.execute(`UPDATE crm_call_activities SET callerdesk_sid=?,status='initiated',raw_payload=? WHERE id=?`,[result.reference,JSON.stringify({request:loggedRequest,response:result.provider}),callActivityId]);
      res.status(201).json({success:true,data:{callActivityId,callingMode:result.callingMode,callingModeLabel:result.label,apiEndpoint:result.endpoint,provider:result.provider}});
    }catch(error){
      if(callActivityId)await pool.execute(`UPDATE crm_call_activities SET status='failed',call_result=?,raw_payload=? WHERE id=?`,[clean(error.message).slice(0,100),JSON.stringify({request:loggedRequest,error:error.message}),callActivityId]);
      console.error('[smartflo] call initiation failed',{callingMode:cfg.callingMode,leadId:lead.id,providerStatus:error.providerStatus,error:error.message});
      if(error.status===400)return res.status(400).json({message:error.message});
      /*
       * Say what Smartflo said.
       *
       * This used to answer every failure with one sentence about contacting
       * the administrator, while the real reason -- "Deleted or blacklisted
       * token provided", "your account is not active" -- was written to
       * crm_call_activities.call_result and shown to nobody. The person who
       * can fix a revoked token is usually the person being told to give up.
       */
      return res.status(error.status===429?429:502).json({
        message:clean(error.message)||'Unable to initiate the call. Please try again or contact the administrator.',
        providerStatus:error.providerStatus||null,
      });
    }
  }));
  router.post('/test-call',authenticate,requireCrmAccess,requireUserAdmin,wrap(async(req,res)=>{
    const cfg=await integration(pool,req),customerNumber=digits(req.body.customerNumber);if(customerNumber.length<10||customerNumber.length>13)return res.status(400).json({message:'Enter a valid 10 to 13 digit test customer number'});
    if(!cfg.defaultDid)return res.status(400).json({message:'Select a Default DID before placing a test call'});
    const [[agent]]=await pool.execute('SELECT smartflo_agent_id,smartflo_agent_number FROM app_users WHERE id=? AND smartflo_enabled=1',[req.user.id]);if(!agent)return res.status(400).json({message:'Smartflo calling is not assigned to this user in User Management'});const agentNumber=clean(agent.smartflo_agent_id)||digits(agent.smartflo_agent_number);
    const customIdentifier={crm_test_call:'1',crm_call_key:crypto.randomUUID().replace(/-/g,'')};let callActivityId=null,loggedRequest=null;
    try{
      const result=await initiateSmartfloCall(cfg,{agentNumber,customerNumber,callerId:cfg.defaultDid,customIdentifier,onPrepared:async prepared=>{loggedRequest={...prepared.payload,api_key:prepared.payload.api_key?'[REDACTED]':undefined,calling_mode:prepared.callingMode,api_endpoint:prepared.endpoint};const [created]=await pool.execute(`INSERT INTO crm_call_activities(integration_id,business_unit_id,lead_id,agent_user_id,callerdesk_sid,direction,source_number,destination_number,agent_number,status,raw_payload) VALUES(?,?,NULL,?,?, 'outbound',?,?,?,'requesting',?)`,[cfg.id,req.businessUnit.id,req.user.id,customIdentifier.crm_call_key,cfg.defaultDid,customerNumber,agentNumber||null,JSON.stringify({request:loggedRequest,testCall:true})]);callActivityId=Number(created.insertId);}});
      await pool.execute(`UPDATE crm_call_activities SET callerdesk_sid=?,status='initiated',raw_payload=? WHERE id=?`,[result.reference,JSON.stringify({request:loggedRequest,response:result.provider,testCall:true}),callActivityId]);
      res.status(201).json({success:true,message:'Test call initiated',data:{callActivityId,callingMode:result.callingMode,callingModeLabel:result.label,customerNumber,apiEndpoint:result.endpoint,status:'Initiated',providerMessage:clean(result.provider?.message),reference:result.reference}});
    }catch(error){if(callActivityId)await pool.execute(`UPDATE crm_call_activities SET status='failed',call_result=?,raw_payload=? WHERE id=?`,[clean(error.message).slice(0,100),JSON.stringify({request:loggedRequest,error:error.message,testCall:true}),callActivityId]);throw error;}
  }));
  return router;
}

export function createSmartfloWebhookRoutes(pool){const router=Router();router.post('/webhook/:integrationId',wrap(async(req,res)=>{const [[row]]=await pool.execute(`SELECT id,config FROM crm_integrations WHERE id=? AND LOWER(provider)='smartflo' AND deleted_at IS NULL`,[req.params.integrationId]);const cfg=row?parse(row.config):null;if(!cfg||clean(req.query.secret||req.headers['x-webhook-secret'])!==cfg.webhookSecret)return res.status(401).json({message:'Invalid webhook secret'});
  const body=req.body||{},objects=webhookObjects(body),value=(...names)=>{for(const object of objects)for(const name of names){if(object[name]!=null)return object[name];if(object[`$${name}`]!=null)return object[`$${name}`];}return null;},customRaw=value('custom_identifier','customIdentifier'),custom=typeof customRaw==='string'?parse(customRaw):customRaw,customLeadId=custom&&typeof custom==='object'?clean(custom.crm_lead_id):'',identifier=clean(typeof customRaw==='string'&&!customLeadId?customRaw:value('ref_id')),leadMatch=/crm-lead:(\d+)/.exec(identifier),customer=digits(value('customer_no_with_prefix','client_number','customer_number','destination','destination_number','call_to_number','source','caller_id_number'));let lead=null;if(customLeadId)[[lead]]=await pool.execute('SELECT id,business_unit_id FROM crm_leads WHERE id=?',[customLeadId]);if(!lead&&leadMatch)[[lead]]=await pool.execute('SELECT id,business_unit_id FROM crm_leads WHERE id=?',[leadMatch[1]]);if(!lead&&customer)[[lead]]=await pool.execute(`SELECT id,business_unit_id FROM crm_leads WHERE normalized_phone=? AND deleted_at_utc IS NULL ORDER BY id DESC LIMIT 1`,[customer]);
  const references=[value('ref_id'),value('call_id'),value('uuid'),value('id'),custom?.crm_call_key,identifier].map(clean).filter(Boolean),callId=references[0];if(!callId)return res.status(400).json({message:'Smartflo call reference is required'});
  const direction=clean(value('direction'))||'inbound',source=clean(value('source','caller_id_number')),destination=clean(value('destination','destination_number','call_to_number','customer_number','customer_no_with_prefix')),agent=clean(value('agent_number','answered_agent_number','answer_agent_number','agent_id')),status=clean(value('call_status','status','state')||'completed'),result=clean(value('hangup_cause_description','hangupcause_desc','hangup_cause','description','dept_name','ivr_name'));
  const recordCalls=cfg.recordCalls!==false,recordingUrl=recordCalls?clean(value('recording_url','recordingUrl','call_recording_url'))||null:null,storedBody=recordCalls?body:JSON.parse(JSON.stringify(body,(key,item)=>/record(ing)?(_?url|_?id|identifier)?/i.test(key)?undefined:item));
  const placeholders=references.map(()=>'?').join(','),[[existingCall]]=await pool.execute(`SELECT id,lead_id,raw_payload FROM crm_call_activities WHERE integration_id=? AND callerdesk_sid IN (${placeholders}) ORDER BY id LIMIT 1`,[row.id,...references]);const mergedPayload={...parse(existingCall?.raw_payload),webhook:storedBody};
  if(existingCall){
    await pool.execute(`UPDATE crm_call_activities SET lead_id=COALESCE(lead_id,?),direction=?,source_number=COALESCE(NULLIF(?,''),source_number),destination_number=COALESCE(NULLIF(?,''),destination_number),agent_number=COALESCE(NULLIF(?,''),agent_number),status=?,call_result=COALESCE(NULLIF(?,''),call_result),started_at_utc=COALESCE(started_at_utc,?),ended_at_utc=COALESCE(?,ended_at_utc),duration_seconds=GREATEST(duration_seconds,?),talk_seconds=GREATEST(talk_seconds,?),recording_url=COALESCE(?,recording_url),raw_payload=? WHERE id=?`,[lead?.id||null,direction,source,destination,agent,status,result,value('start_stamp','created_at'),value('end_stamp'),Number(value('duration','call_duration'))||0,Number(value('billsec','answered_seconds'))||0,recordingUrl,JSON.stringify(mergedPayload),existingCall.id]);
  }else{
    await pool.execute(`INSERT INTO crm_call_activities(integration_id,business_unit_id,lead_id,callerdesk_sid,direction,source_number,destination_number,agent_number,status,call_result,started_at_utc,ended_at_utc,duration_seconds,talk_seconds,recording_url,raw_payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[row.id,Number(lead?.business_unit_id||cfg.defaultBusinessUnitId||1),lead?.id||null,callId,direction,source,destination,agent,status,result,value('start_stamp','created_at'),value('end_stamp'),Number(value('duration','call_duration'))||0,Number(value('billsec','answered_seconds'))||0,recordingUrl,JSON.stringify(mergedPayload)]);
  }
  res.json({success:true});}));return router;}

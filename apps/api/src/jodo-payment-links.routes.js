import { Router } from 'express';
import axios from 'axios';
import { jodoBaseUrl, jodoHeaders, jodoConfigured } from './jodo-client.js';

const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const endpoint='/api/v1/integrations/pay/payment_links';

function providerError(error){
  const body=error.response?.data;
  const message=body?.message||body?.error?.message||body?.error||error.message||'Jodo request failed';
  const statusCode=error.response?.status;
  const finalMessage=statusCode===401?`Jodo API authentication failed. Check this branch's Jodo base URL, Authorization header, API key and secret in Business Units > Branches & payments: ${typeof message==='string'?message:JSON.stringify(message)}`:typeof message==='string'?message:JSON.stringify(message);
  const status=statusCode===401?502:statusCode>=400&&statusCode<500?statusCode:502;
  return Object.assign(new Error(finalMessage),{status});
}

async function branchConfig(pool,id){
  const [[branch]]=await pool.execute(`SELECT id,branch_name AS name,jodo_payment_enabled AS enabled,jodo_api_key AS apiKey,jodo_secret_key AS secretKey,jodo_collector_code AS collectorCode,jodo_base_url AS baseUrl,jodo_auth_header AS authHeader FROM branches WHERE id=? AND is_active=1 LIMIT 1`,[id]);
  if(!branch)throw Object.assign(new Error('Active branch not found'),{status:404});
  // Capability is now credentials alone: the per-branch enable flag is no
  // longer editable, so requiring it here would strand every branch that
  // happened to have it off.
  // An issued Authorization value is enough on its own; a key and secret
  // remain valid for branches configured before Jodo started issuing one.
  if(!jodoConfigured(branch))throw Object.assign(new Error('Configure this branch\'s Jodo credentials in Business Units > Branches & payments'),{status:400});
  return branch;
}

async function jodo(config,environment,method,path,data){
  try{return (await axios({method,url:`${jodoBaseUrl(config,environment)}${endpoint}${path}`,data,headers:jodoHeaders(config),timeout:20000})).data;}
  catch(error){throw providerError(error);}
}

function remoteData(payload){return payload?.data&&typeof payload.data==='object'?payload.data:payload||{};}
function paymentSummary(data){
  const details=Array.isArray(data.details)?data.details:[];
  return {status:clean(data.status||'unpaid',40).toLowerCase(),transactionId:clean(data.transaction_id,150)||null,paidAt:data.paid_at||null,
    settledAt:details.find(item=>item.settled_at)?.settled_at||null,settlementUtr:clean(details.find(item=>item.settlement_utr)?.settlement_utr,150)||null};
}

export function createJodoPaymentLinkRoutes(pool,authenticate,requireCrmAccess,requireUserAdmin){
  const router=Router();
  router.use(authenticate,requireCrmAccess,requireUserAdmin);

  router.get('/branches',wrap(async(req,res)=>{const [rows]=await pool.execute(`SELECT id,branch_name AS name,jodo_payment_enabled AS enabled,jodo_collector_code AS collectorCode,(jodo_auth_header IS NOT NULL OR (jodo_api_key IS NOT NULL AND jodo_secret_key IS NOT NULL)) AS configured FROM branches WHERE is_active=1 ORDER BY branch_name`);res.json({data:rows.map(row=>({...row,configured:Boolean(row.configured),enabled:Boolean(row.configured)}))});}));

  router.get('/',wrap(async(req,res)=>{const [rows]=await pool.execute(`SELECT p.id,p.order_id AS orderId,p.redirect_url AS redirectUrl,p.environment,p.payer_name AS payerName,p.payer_phone AS payerPhone,p.payer_email AS payerEmail,p.student_name AS studentName,p.identifier,p.amount,p.status,p.transaction_id AS transactionId,p.expires_at_utc AS expiresAt,p.paid_at_utc AS paidAt,p.settlement_utr AS settlementUtr,p.created_at_utc AS createdAt,p.branch_id AS branchId,b.branch_name AS branchName,p.lead_id AS leadId,l.lead_number AS leadNumber FROM crm_jodo_payment_links p JOIN branches b ON b.id=p.branch_id LEFT JOIN crm_leads l ON l.id=p.lead_id WHERE p.business_unit_id=? ORDER BY p.created_at_utc DESC LIMIT 250`,[req.businessUnit.id]);res.json({data:rows});}));

  router.post('/',wrap(async(req,res)=>{
    const branchId=Number(req.body.branchId),config=await branchConfig(pool,branchId),environment=req.body.environment==='uat'?'uat':'production';
    const name=clean(req.body.name,200),phone=clean(req.body.phone,30).replace(/\D/g,''),email=clean(req.body.email,254);
    if(!name||phone.length<10||!/^\S+@\S+\.\S+$/.test(email))return res.status(400).json({message:'Payer name, valid phone and valid email are required'});
    const details=(Array.isArray(req.body.details)?req.body.details:[]).map(item=>({component_type:clean(item.componentType||item.component_type,120),amount:Number(item.amount)})).filter(item=>item.component_type&&item.amount>0);
    if(!details.length)return res.status(400).json({message:'Add at least one payment component with an amount greater than zero'});
    const total=details.reduce((sum,item)=>sum+item.amount,0),leadReference=clean(req.body.leadId,120);let leadId=null;
    if(leadReference){const numericId=Number(leadReference)||0,[[lead]]=await pool.execute('SELECT id FROM crm_leads WHERE (id=? OR lead_number=?) AND business_unit_id=? AND branch_id=? AND deleted_at_utc IS NULL LIMIT 1',[numericId,leadReference,req.businessUnit.id,branchId]);if(!lead)return res.status(400).json({message:'Lead number does not belong to this business unit and branch'});leadId=Number(lead.id);}
    const notes=(Array.isArray(req.body.notes)?req.body.notes:[]).map(item=>({key:clean(item.key,100),value:clean(item.value,500)})).filter(item=>item.key&&item.value);
    if(leadId)notes.push({key:'crm_lead_id',value:String(leadId)});notes.push({key:'crm_business_unit_id',value:String(req.businessUnit.id)},{key:'crm_branch_id',value:String(branchId)});
    const expiry=req.body.expiresAt?new Date(req.body.expiresAt):null;if(expiry&&Number.isNaN(expiry.getTime()))return res.status(400).json({message:'Enter a valid expiry date and time'});
    const payload={name,phone,email,student_name:clean(req.body.studentName,200)||undefined,grade:clean(req.body.grade,120)||undefined,date_of_birth:clean(req.body.dateOfBirth,20)||undefined,identifier:clean(req.body.identifier,120)||undefined,new_admission:req.body.newAdmission!==false,custom_identifier:clean(req.body.customIdentifier,120)||undefined,academic_year_start:Number(req.body.academicYearStart)||undefined,academic_year_end:Number(req.body.academicYearEnd)||undefined,expires_at:expiry?.toISOString(),details,notes};
    const response=await jodo(config,environment,'POST','',payload),data=remoteData(response),orderId=clean(data.order_id||data.id,120),redirectUrl=clean(data.redirect_url,1000);
    if(!orderId||!redirectUrl)throw Object.assign(new Error('Jodo did not return an order_id and redirect_url'),{status:502});
    const [created]=await pool.execute(`INSERT INTO crm_jodo_payment_links(business_unit_id,branch_id,lead_id,environment,order_id,redirect_url,payer_name,payer_phone,payer_email,student_name,identifier,custom_identifier,grade,academic_year_start,academic_year_end,expires_at_utc,amount,details_json,notes_json,status,raw_response,created_by_user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[req.businessUnit.id,branchId,leadId,environment,orderId,redirectUrl,name,phone,email,payload.student_name||null,payload.identifier||null,payload.custom_identifier||null,payload.grade||null,payload.academic_year_start||null,payload.academic_year_end||null,payload.expires_at?new Date(payload.expires_at):null,total,JSON.stringify(details),JSON.stringify(notes),'unpaid',JSON.stringify(response),req.user.id]);
    if(leadId)await pool.execute(`INSERT INTO crm_lead_activities(lead_id,activity_type,summary,details_json,actor_user_id) VALUES(?,'payment_link_created',?,?,?)`,[leadId,`Jodo payment link created for ₹${total.toFixed(2)}`,JSON.stringify({orderId,redirectUrl}),req.user.id]);
    res.status(201).json({success:true,data:{id:Number(created.insertId),orderId,redirectUrl,status:'unpaid'}});
  }));

  router.get('/:id',wrap(async(req,res)=>{const [[link]]=await pool.execute('SELECT * FROM crm_jodo_payment_links WHERE id=? AND business_unit_id=?',[req.params.id,req.businessUnit.id]);if(!link)return res.status(404).json({message:'Payment link not found'});const config=await branchConfig(pool,link.branch_id),response=await jodo(config,link.environment,'GET',`/${encodeURIComponent(link.order_id)}`),data=remoteData(response),summary=paymentSummary(data);await pool.execute(`UPDATE crm_jodo_payment_links SET status=?,transaction_id=?,paid_at_utc=?,settled_at_utc=?,settlement_utr=?,raw_response=? WHERE id=?`,[summary.status,summary.transactionId,summary.paidAt?new Date(summary.paidAt):null,summary.settledAt?new Date(summary.settledAt):null,summary.settlementUtr,JSON.stringify(response),link.id]);res.json({data:{...data,localId:Number(link.id),orderId:link.order_id,redirectUrl:link.redirect_url}});}));

  router.delete('/:id',wrap(async(req,res)=>{const [[link]]=await pool.execute('SELECT * FROM crm_jodo_payment_links WHERE id=? AND business_unit_id=?',[req.params.id,req.businessUnit.id]);if(!link)return res.status(404).json({message:'Payment link not found'});const config=await branchConfig(pool,link.branch_id),remote=remoteData(await jodo(config,link.environment,'GET',`/${encodeURIComponent(link.order_id)}`)),current=clean(remote.status||link.status,40).toLowerCase();if(['paid','settled','cancelled'].includes(current)){await pool.execute('UPDATE crm_jodo_payment_links SET status=?,raw_response=? WHERE id=?',[current,JSON.stringify(remote),link.id]);return res.status(409).json({message:`A ${current} payment link cannot be cancelled`});}const response=await jodo(config,link.environment,'DELETE',`/${encodeURIComponent(link.order_id)}`);await pool.execute(`UPDATE crm_jodo_payment_links SET status='cancelled',raw_response=? WHERE id=?`,[JSON.stringify(response),link.id]);if(link.lead_id)await pool.execute(`INSERT INTO crm_lead_activities(lead_id,activity_type,summary,actor_user_id) VALUES(?,'payment_link_cancelled',?,?)`,[link.lead_id,`Jodo payment link ${link.order_id} cancelled`,req.user.id]);res.json({success:true,message:'Payment link cancelled',data:response});}));
  return router;
}

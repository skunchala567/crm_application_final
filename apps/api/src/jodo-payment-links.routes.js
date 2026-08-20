import { Router } from 'express';
import { branchScopeSql, denyBranch } from './rbac/branch-scope.js';
import { requireAdminOrPermission } from './rbac/rbac.middleware.js';
/* Raising a link, and what a Jodo error means, are shared with the bulk cycle
   in payment-link-batch-engine.js -- see jodo-link-service.js. */
import { clean, jodo, remoteData, paymentSummary, branchJodoConfig as branchConfig, createPaymentLink } from './jodo-link-service.js';

const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);

export function createJodoPaymentLinkRoutes(pool,authenticate,requireCrmAccess,requireUserAdmin){
  const router=Router();
  /*
   * Reading collections is now something an administrator can grant to an end
   * user, so the read routes answer to the payments permissions rather than to
   * a hardcoded CRM_ADMIN check. Everything a granted user then sees is
   * narrowed to their own branches by branchScopeSql below -- the permission
   * opens the screen, the branch scope decides what is on it.
   *
   * Creating and cancelling links still spends real money against a branch's
   * Jodo credentials, so those keep requireUserAdmin.
   */
  const canView=requireAdminOrPermission(pool,'payments.collections.view');
  router.use(authenticate,requireCrmAccess);

  router.get('/branches',canView,wrap(async(req,res)=>{
    const scope=branchScopeSql(req.user,'id');
    const [rows]=await pool.execute(`SELECT id,branch_name AS name,jodo_payment_enabled AS enabled,jodo_collector_code AS collectorCode,(jodo_auth_header IS NOT NULL OR (jodo_api_key IS NOT NULL AND jodo_secret_key IS NOT NULL)) AS configured FROM branches WHERE is_active=1 AND ${scope.sql} ORDER BY branch_name`,scope.params);
    res.json({data:rows.map(row=>({...row,configured:Boolean(row.configured),enabled:Boolean(row.configured)}))});
  }));

  router.get('/',canView,wrap(async(req,res)=>{
    const scope=branchScopeSql(req.user,'p.branch_id');
    const [rows]=await pool.execute(`SELECT p.id,p.order_id AS orderId,p.redirect_url AS redirectUrl,p.environment,p.payer_name AS payerName,p.payer_phone AS payerPhone,p.payer_email AS payerEmail,p.student_name AS studentName,p.identifier,p.amount,p.status,p.transaction_id AS transactionId,p.expires_at_utc AS expiresAt,p.paid_at_utc AS paidAt,p.settlement_utr AS settlementUtr,p.created_at_utc AS createdAt,p.branch_id AS branchId,b.branch_name AS branchName,p.lead_id AS leadId,l.lead_number AS leadNumber FROM crm_jodo_payment_links p JOIN branches b ON b.id=p.branch_id LEFT JOIN crm_leads l ON l.id=p.lead_id WHERE p.business_unit_id=? AND ${scope.sql} ORDER BY p.created_at_utc DESC LIMIT 250`,[req.businessUnit.id,...scope.params]);
    res.json({data:rows});
  }));

  router.get('/collections/report',canView,wrap(async(req,res)=>{
    const where=['x.businessUnitId=?'],params=[req.businessUnit.id];
    /*
     * The caller's own branches, applied before any filter they chose, so
     * ?branchId= can only ever narrow what they may already see. A branchless
     * lead's payment matches no branch and so stays with the administrators,
     * whose 1=1 admits it, rather than surfacing in one branch's report.
     */
    const scope=branchScopeSql(req.user,'x.branchId');
    where.push(scope.sql);params.push(...scope.params);
    if(req.query.status){where.push('LOWER(x.status)=LOWER(?)');params.push(clean(req.query.status,40));}
    if(req.query.branchId){where.push('x.branchId=?');params.push(Number(req.query.branchId));}
    if(req.query.source){where.push('x.source=?');params.push(clean(req.query.source,40));}
    if(req.query.from){where.push('DATE(x.createdAt)>=?');params.push(clean(req.query.from,10));}
    if(req.query.to){where.push('DATE(x.createdAt)<=?');params.push(clean(req.query.to,10));}
    if(req.query.search){where.push('(x.orderId LIKE ? OR x.transactionId LIKE ? OR x.payerName LIKE ? OR x.payerEmail LIKE ? OR x.leadNumber LIKE ? OR x.sourceName LIKE ?)');const q=`%${clean(req.query.search,120)}%`;params.push(q,q,q,q,q,q);}
    const [rows]=await pool.execute(`SELECT x.* FROM (
      SELECT l.business_unit_id businessUnitId,l.branch_id branchId,b.branch_name branchName,l.id leadId,l.lead_number leadNumber,
       'enquiry' source,l.jodo_order_id orderId,NULL transactionId,l.student_name payerName,l.email payerEmail,l.phone payerPhone,
       l.application_payment_amount amount,l.application_payment_status status,l.application_payment_at_utc paidAt,NULL settledAt,NULL settlementUtr,
       l.created_at_utc createdAt,ef.display_name COLLATE utf8mb4_unicode_ci sourceName
      /* The three sourceName columns come from tables created under
         different collations, and a UNION needs one. It is spelled
         utf8mb4_unicode_ci rather than utf8mb4_0900_ai_ci because the
         latter exists only on MySQL 8: on MariaDB, which this deploys to,
         it raises "Unknown collation" and the whole screen returns nothing.
         utf8mb4_unicode_ci exists on both. */
      -- LEFT, because a lead may have no branch yet: WhatsApp intake creates
      -- leads with a null branch when no assignment rule matches, and money
      -- they pay must still be counted rather than dropped by the join.
      FROM crm_leads l LEFT JOIN branches b ON b.id=l.branch_id
      -- LEFT as well: leads created before the form was recorded, and leads
      -- from any other intake, still have to appear with their payment.
      LEFT JOIN crm_public_enquiry_forms ef ON ef.id=l.enquiry_form_id
      WHERE l.jodo_order_id IS NOT NULL AND l.deleted_at_utc IS NULL
      UNION ALL
      SELECT s.business_unit_id,pf.branch_id,b.branch_name,NULL,NULL,'payment_form',s.jodo_order_id,s.transaction_id,s.payer_name,s.payer_email,s.payer_phone,
       s.amount,s.status,s.paid_at_utc,s.settled_at_utc,s.settlement_utr,s.created_at_utc,pf.title COLLATE utf8mb4_unicode_ci
      FROM crm_payment_form_submissions s JOIN crm_payment_forms pf ON pf.id=s.payment_form_id JOIN branches b ON b.id=pf.branch_id
      UNION ALL
      SELECT p.business_unit_id,p.branch_id,b.branch_name,p.lead_id,l.lead_number,'payment_link',p.order_id,p.transaction_id,p.payer_name,p.payer_email,p.payer_phone,
       p.amount,p.status,p.paid_at_utc,p.settled_at_utc,p.settlement_utr,p.created_at_utc,COALESCE(p.identifier,p.custom_identifier) COLLATE utf8mb4_unicode_ci
      FROM crm_jodo_payment_links p JOIN branches b ON b.id=p.branch_id LEFT JOIN crm_leads l ON l.id=p.lead_id
    ) x WHERE ${where.join(' AND ')} ORDER BY x.createdAt DESC LIMIT 2000`,params);
    const summary=rows.reduce((s,row)=>{const status=String(row.status||'unknown').toLowerCase();s.count+=1;s.total+=Number(row.amount||0);if(['paid','settled','success','completed','captured'].includes(status)){s.collectedCount+=1;s.collectedAmount+=Number(row.amount||0);}return s;},{count:0,total:0,collectedCount:0,collectedAmount:0});
    res.json({data:rows,summary});
  }));

  router.post('/',requireUserAdmin,wrap(async(req,res)=>{
    const branchId=Number(req.body.branchId);
    // The branch decides whose Jodo credentials are charged, so it is checked
    // against the caller's own branches before anything is sent to Jodo.
    const denied=denyBranch(req.user,branchId);
    if(denied)return res.status(403).json({message:denied});
    const config=await branchConfig(pool,branchId),environment=req.body.environment==='uat'?'uat':'production';
    const name=clean(req.body.name,200),phone=clean(req.body.phone,30).replace(/\D/g,''),email=clean(req.body.email,254);
    if(!name||phone.length<10||!/^\S+@\S+\.\S+$/.test(email))return res.status(400).json({message:'Payer name, valid phone and valid email are required'});
    const details=(Array.isArray(req.body.details)?req.body.details:[]).map(item=>({component_type:clean(item.componentType||item.component_type,120),amount:Number(item.amount)})).filter(item=>item.component_type&&item.amount>0);
    if(!details.length)return res.status(400).json({message:'Add at least one payment component with an amount greater than zero'});
    const total=details.reduce((sum,item)=>sum+item.amount,0),leadReference=clean(req.body.leadId,120);let leadId=null;
    if(leadReference){const numericId=Number(leadReference)||0,[[lead]]=await pool.execute('SELECT id FROM crm_leads WHERE (id=? OR lead_number=?) AND business_unit_id=? AND branch_id=? AND deleted_at_utc IS NULL LIMIT 1',[numericId,leadReference,req.businessUnit.id,branchId]);if(!lead)return res.status(400).json({message:'Lead number does not belong to this business unit and branch'});leadId=Number(lead.id);}
    const notes=(Array.isArray(req.body.notes)?req.body.notes:[]).map(item=>({key:clean(item.key,100),value:clean(item.value,500)})).filter(item=>item.key&&item.value);
    if(leadId)notes.push({key:'crm_lead_id',value:String(leadId)});notes.push({key:'crm_source',value:'payment_link'},{key:'crm_business_unit_id',value:String(req.businessUnit.id)},{key:'crm_branch_id',value:String(branchId)});
    const expiry=req.body.expiresAt?new Date(req.body.expiresAt):null;if(expiry&&Number.isNaN(expiry.getTime()))return res.status(400).json({message:'Enter a valid expiry date and time'});
    const created=await createPaymentLink(pool,{
      config,environment,businessUnitId:req.businessUnit.id,branchId,leadId,
      name,phone,email,studentName:clean(req.body.studentName,200)||null,grade:clean(req.body.grade,120)||null,
      dateOfBirth:clean(req.body.dateOfBirth,20)||null,identifier:clean(req.body.identifier,120)||null,
      customIdentifier:clean(req.body.customIdentifier,120)||null,newAdmission:req.body.newAdmission!==false,
      academicYearStart:Number(req.body.academicYearStart)||null,academicYearEnd:Number(req.body.academicYearEnd)||null,
      expiresAt:expiry,details,notes,createdByUserId:req.user.id,
    });
    if(leadId)await pool.execute(`INSERT INTO crm_lead_activities(lead_id,activity_type,summary,details_json,actor_user_id) VALUES(?,'payment_link_created',?,?,?)`,[leadId,`Jodo payment link created for ₹${total.toFixed(2)}`,JSON.stringify({orderId:created.orderId,redirectUrl:created.redirectUrl}),req.user.id]);
    res.status(201).json({success:true,data:{id:created.id,orderId:created.orderId,redirectUrl:created.redirectUrl,status:'unpaid'}});
  }));

  // Not found rather than forbidden: a link outside the caller's branches
  // should not be distinguishable from one that does not exist.
  router.get('/:id',canView,wrap(async(req,res)=>{const scope=branchScopeSql(req.user,'branch_id');const [[link]]=await pool.execute(`SELECT * FROM crm_jodo_payment_links WHERE id=? AND business_unit_id=? AND ${scope.sql}`,[req.params.id,req.businessUnit.id,...scope.params]);if(!link)return res.status(404).json({message:'Payment link not found'});const config=await branchConfig(pool,link.branch_id),response=await jodo(config,link.environment,'GET',`/${encodeURIComponent(link.order_id)}`),data=remoteData(response),summary=paymentSummary(data);await pool.execute(`UPDATE crm_jodo_payment_links SET status=?,transaction_id=?,paid_at_utc=?,settled_at_utc=?,settlement_utr=?,raw_response=? WHERE id=?`,[summary.status,summary.transactionId,summary.paidAt?new Date(summary.paidAt):null,summary.settledAt?new Date(summary.settledAt):null,summary.settlementUtr,JSON.stringify(response),link.id]);res.json({data:{...data,localId:Number(link.id),orderId:link.order_id,redirectUrl:link.redirect_url}});}));

  router.delete('/:id',requireUserAdmin,wrap(async(req,res)=>{const scope=branchScopeSql(req.user,'branch_id');const [[link]]=await pool.execute(`SELECT * FROM crm_jodo_payment_links WHERE id=? AND business_unit_id=? AND ${scope.sql}`,[req.params.id,req.businessUnit.id,...scope.params]);if(!link)return res.status(404).json({message:'Payment link not found'});const config=await branchConfig(pool,link.branch_id),remote=remoteData(await jodo(config,link.environment,'GET',`/${encodeURIComponent(link.order_id)}`)),current=clean(remote.status||link.status,40).toLowerCase();if(['paid','settled','cancelled'].includes(current)){await pool.execute('UPDATE crm_jodo_payment_links SET status=?,raw_response=? WHERE id=?',[current,JSON.stringify(remote),link.id]);return res.status(409).json({message:`A ${current} payment link cannot be cancelled`});}const response=await jodo(config,link.environment,'DELETE',`/${encodeURIComponent(link.order_id)}`);await pool.execute(`UPDATE crm_jodo_payment_links SET status='cancelled',raw_response=? WHERE id=?`,[JSON.stringify(response),link.id]);if(link.lead_id)await pool.execute(`INSERT INTO crm_lead_activities(lead_id,activity_type,summary,actor_user_id) VALUES(?,'payment_link_cancelled',?,?)`,[link.lead_id,`Jodo payment link ${link.order_id} cancelled`,req.user.id]);res.json({success:true,message:'Payment link cancelled',data:response});}));
  return router;
}

import { Router } from 'express';

const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const eventStatus=(event,order)=>event.endsWith('.expired')?'expired':event.endsWith('.settled')?'settled':clean(order?.status||'paid',40).toLowerCase();

export function createJodoWebhookRoutes(pool){
  const router=Router();
  router.post('/',async(req,res,next)=>{try{
    const body=req.body&&typeof req.body==='object'?req.body:{};
    const event=clean(body.event,100),eventId=clean(body.event_id,120);
    const supported=new Set(['payment_link.payment.debited','payment_link.payment.settled','payment_link.payment.expired','order.payment.debited','order.payment.settled']);
    if(!supported.has(event))return res.status(202).json({success:true,message:'Event ignored'});
    if(!eventId)return res.status(400).json({message:'event_id is required'});
    const payload=body.payload||{},order=payload.order||{};
    const orderId=clean(payload.order_id||order.order_id||order.id,120);
    if(!orderId)return res.status(400).json({message:'payload.order_id is required'});
    const status=eventStatus(event,order),details=Array.isArray(order.details)?order.details:[];
    const amount=details.reduce((sum,item)=>sum+Number(item.amount||0),0)||null;
    const transactionId=clean(order.transaction_id,150)||null;
    const paidAt=order.paid_at?new Date(order.paid_at):null;
    const settlement=details.find(item=>item.settlement_utr||item.settled_at)||{};
    const settledAt=settlement.settled_at?new Date(settlement.settled_at):null;
    const settlementUtr=clean(settlement.settlement_utr,150)||null;
    const connection=await pool.getConnection();
    try{
      await connection.beginTransaction();
      const [inserted]=await connection.execute(`INSERT IGNORE INTO crm_jodo_webhook_events(event_id,event_name,order_id,status,payload_json) VALUES(?,?,?,?,?)`,[eventId,event,orderId,status,JSON.stringify(body)]);
      if(!inserted.affectedRows){await connection.rollback();return res.json({success:true,duplicate:true});}
      const [links]=await connection.execute(`UPDATE crm_jodo_payment_links SET status=?,transaction_id=COALESCE(?,transaction_id),paid_at_utc=COALESCE(?,paid_at_utc),settled_at_utc=COALESCE(?,settled_at_utc),settlement_utr=COALESCE(?,settlement_utr),raw_response=? WHERE order_id=?`,[status,transactionId,paidAt,settledAt,settlementUtr,JSON.stringify(body),orderId]);
      const [submissions]=await connection.execute(`UPDATE crm_payment_form_submissions SET status=?,transaction_id=COALESCE(?,transaction_id),paid_at_utc=COALESCE(?,paid_at_utc),settled_at_utc=COALESCE(?,settled_at_utc),settlement_utr=COALESCE(?,settlement_utr),raw_response=? WHERE jodo_order_id=?`,[status,transactionId,paidAt,settledAt,settlementUtr,JSON.stringify(body),orderId]);
      const [[lead]]=await connection.execute(`SELECT l.id,l.stage_id,b.application_stage_id FROM crm_leads l JOIN branches b ON b.id=l.branch_id WHERE l.jodo_order_id=? AND l.deleted_at_utc IS NULL ORDER BY l.id DESC LIMIT 1 FOR UPDATE`,[orderId]);
      if(lead){const collected=['paid','settled','success','completed','captured'].includes(status);await connection.execute(`UPDATE crm_leads SET application_payment_status=?,application_payment_amount=COALESCE(?,application_payment_amount),application_payment_at_utc=IF(?,COALESCE(?,CURRENT_TIMESTAMP(6)),application_payment_at_utc),stage_id=IF(?,COALESCE(?,stage_id),stage_id),updated_at_utc=CURRENT_TIMESTAMP(6) WHERE id=?`,[status,amount,collected,paidAt,collected,lead.application_stage_id,lead.id]);await connection.execute(`INSERT INTO crm_lead_activities(lead_id,activity_type,summary,details_json) VALUES(?,'payment_update',?,?)`,[lead.id,`Jodo payment ${status}`,JSON.stringify({event,eventId,orderId,transactionId,amount,settlementUtr})]);}
      if(!links.affectedRows&&!submissions.affectedRows&&!lead){await connection.rollback();return res.status(404).json({message:'No CRM payment record matches this order'});}
      await connection.commit();res.json({success:true,orderId,status});
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  }catch(error){next(error);}});
  return router;
}

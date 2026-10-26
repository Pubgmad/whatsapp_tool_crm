import {id,query,transaction} from './db.js';
import {assertMessageCapacity} from './limits.js';
import {sendTemplateMessage} from './meta.js';
import {workspaceFeatureFlags} from './feature-controls.js';

export function bookingNoticeFailureStatus(attempted,sentMessageId,error){
  const rejected=!sentMessageId&&error?.code==='META_SEND_FAILED'&&error.status>=400&&error.status<500&&![408,409,429].includes(error.status);
  return attempted&&!rejected?'unconfirmed':'failed';
}

export async function runBookingNotices(){
  await query("UPDATE availability_booking_notices SET status='unconfirmed',last_error='META_SEND_OUTCOME_UNKNOWN',claimed_at=NULL,updated_at=NOW() WHERE status='sending' AND claimed_at<NOW()-INTERVAL '2 minutes'");
  const claim=await query(`WITH due AS (
    SELECT reservation_id,kind FROM availability_booking_notices WHERE status='queued'
    ORDER BY created_at,reservation_id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE availability_booking_notices n SET status='sending',claimed_at=NOW(),updated_at=NOW()
    FROM due WHERE n.reservation_id=due.reservation_id AND n.kind=due.kind
    RETURNING n.reservation_id,n.business_id,n.kind,n.template_id`,[]);
  if(!claim.rowCount)return {claimed:0};
  const item=claim.rows[0];
  const target=(await query(`SELECT r.status AS reservation_status,s.contact_id,ct.phone,ct.unsubscribed,
    COALESCE(NULLIF(a.access_token_encrypted,''), def.access_token_encrypted) AS access_token_encrypted,
    COALESCE(NULLIF(a.waba_id,''), def.waba_id, NULLIF(b.waba_id,'')) AS waba_id,
    COALESCE(NULLIF(p.phone_number_id,''), def.phone_number_id) AS phone_number_id,
    p.registration_state,
    COALESCE(a.status, def.account_status) AS account_status,
    COALESCE(a.token_expires_at, def.token_expires_at) AS token_expires_at,
    COALESCE(def.waba_id, NULLIF(b.waba_id,'')) AS default_waba_id,
    t.meta_template_name,t.body AS template_body,t.language,t.status AS template_status,t.category,t.variables,t.buttons,t.header_text,t.waba_id AS template_waba_id,n.enabled AS rule_enabled
    FROM flow_runtime_reservations r JOIN flow_runtime_sessions s ON s.id=r.session_id AND s.business_id=r.business_id
    JOIN contacts ct ON ct.id=s.contact_id AND ct.business_id=s.business_id
    JOIN whatsapp_phone_numbers p ON p.id=s.phone_id AND p.business_id=s.business_id
    LEFT JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id
    JOIN businesses b ON b.id=r.business_id
    LEFT JOIN LATERAL (
      SELECT p2.phone_number_id, a2.waba_id, a2.access_token_encrypted, a2.status AS account_status, a2.token_expires_at
        FROM whatsapp_phone_numbers p2
        JOIN whatsapp_accounts a2 ON a2.id=p2.whatsapp_account_id AND a2.business_id=p2.business_id
       WHERE p2.business_id=b.id AND a2.status='connected' AND COALESCE(a2.access_token_encrypted,'')<>''
         AND (a2.token_expires_at IS NULL OR a2.token_expires_at>NOW())
       ORDER BY p2.is_default DESC, p2.created_at
       LIMIT 1
    ) def ON TRUE
    JOIN templates t ON t.id=$3 AND t.business_id=r.business_id
    LEFT JOIN availability_booking_notice_rules n ON n.business_id=r.business_id AND n.kind=$4
    WHERE r.id=$1 AND r.business_id=$2`,[item.reservation_id,item.business_id,item.template_id,item.kind])).rows[0];
  const enabled=(await workspaceFeatureFlags(item.business_id)).connectors;
  const valid=enabled&&target&&target.reservation_status===item.kind&&!target.unsubscribed&&target.registration_state==='registered'&&target.account_status==='connected'&&Boolean(target.access_token_encrypted)&&(!target.token_expires_at||new Date(target.token_expires_at)>new Date())&&target.rule_enabled&&target.template_status==='Approved'&&target.category==='UTILITY'&&target.meta_template_name&&Array.isArray(target.variables)&&target.variables.length===0&&(!Array.isArray(target.buttons)||target.buttons.length===0)&&!target.header_text&&(!target.template_waba_id?target.waba_id===target.default_waba_id:target.template_waba_id===target.waba_id);
  if(!valid){
    await query("UPDATE availability_booking_notices SET status='skipped',last_error='NOTICE_NOT_ELIGIBLE',claimed_at=NULL,updated_at=NOW() WHERE reservation_id=$1 AND business_id=$2 AND kind=$3 AND status='sending'",[item.reservation_id,item.business_id,item.kind]);
    return {claimed:1,status:'skipped'};
  }
  let attempted=false,sentMessageId='';
  try{
    await assertMessageCapacity(item.business_id,1,null,target.contact_id);
    attempted=true;
    const sent=await sendTemplateMessage({setup:target,to:target.phone,templateName:target.meta_template_name,language:target.language,variables:[]});
    sentMessageId=sent.metaMessageId;
    await transaction(async client=>{
      await client.query(`INSERT INTO conversations(id,business_id,contact_id,whatsapp_phone_number_id,updated_at)
        VALUES($1,$2,$3,$4,NOW()) ON CONFLICT(business_id,contact_id) DO UPDATE
        SET whatsapp_phone_number_id = CASE
              WHEN COALESCE(conversations.whatsapp_phone_number_id,'')='' THEN EXCLUDED.whatsapp_phone_number_id
              ELSE conversations.whatsapp_phone_number_id
            END,
            updated_at=NOW(),version=conversations.version+1`,[id('v'),item.business_id,target.contact_id,target.phone_number_id]);
      const conversation=(await client.query('SELECT id FROM conversations WHERE business_id=$1 AND contact_id=$2',[item.business_id,target.contact_id])).rows[0];
      await client.query(`INSERT INTO messages(id,conversation_id,direction,body,status,meta_message_id,message_type,metadata)
        VALUES($1,$2,'outgoing',$3,'sent',$4,'template',$5) ON CONFLICT DO NOTHING`,[
        id('m'),conversation.id,target.template_body||target.meta_template_name,sent.metaMessageId,
        JSON.stringify({bookingReservationId:item.reservation_id,bookingNoticeKind:item.kind,templateId:item.template_id})
      ]);
      await client.query("UPDATE availability_booking_notices SET status='sent',meta_message_id=$1,last_error=NULL,claimed_at=NULL,updated_at=NOW() WHERE reservation_id=$2 AND business_id=$3 AND kind=$4 AND status='sending'",[sent.metaMessageId,item.reservation_id,item.business_id,item.kind]);
      await client.query('INSERT INTO audit_logs(id,business_id,action,metadata) VALUES($1,$2,$3,$4)',[id('a'),item.business_id,'booking_notice_sent',JSON.stringify({reservationId:item.reservation_id,kind:item.kind,metaMessageId:sent.metaMessageId})]);
    });
    return {claimed:1,status:'sent'};
  }catch(error){
    const status=bookingNoticeFailureStatus(attempted,sentMessageId,error);
    await query('UPDATE availability_booking_notices SET status=$1,last_error=$2,claimed_at=NULL,updated_at=NOW() WHERE reservation_id=$3 AND business_id=$4 AND kind=$5 AND status=$6',[status,String(error?.code||'META_SEND_OUTCOME_UNKNOWN').slice(0,80),item.reservation_id,item.business_id,item.kind,'sending']);
    return {claimed:1,status};
  }
}

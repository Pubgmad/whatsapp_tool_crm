import {AppError,id,json,transaction} from './db.js';
import {mapContact,renderTemplate} from './workspace-mappers.js';
import {operationalPolicy} from './operational-policy.js';

export async function reconcileIntegrationApiRequest({businessId,userId,requestId,outcome,providerMessageId=''}) {
  return transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[businessId,requestId]);
    const request=(await client.query('SELECT * FROM workspace_api_requests WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,requestId])).rows[0];
    if(!request||request.operation!=='template.send')throw new AppError('Template API request not found.',404,'NOT_FOUND');
    if(request.dispatch_status==='completed')return json(request.response_body||{ok:true,reconciled:true},request.response_status||200);
    if(!['provider_accepted','unconfirmed','sending'].includes(request.dispatch_status))throw new AppError('This API request is not eligible for reconciliation.',409,'INTEGRATION_RECONCILIATION_UNAVAILABLE');
    if(request.dispatch_status==='sending'&&Date.now()-new Date(request.updated_at).getTime()<=operationalPolicy().integrationDispatchWindowSeconds*1000)throw new AppError('This API request is still within its provider delivery window.',409,'INTEGRATION_REQUEST_IN_PROGRESS');
    if(outcome==='not_sent'){
      await client.query(`UPDATE workspace_api_requests SET dispatch_status='failed',error_code='PROVIDER_NOT_SENT',
        response_status=409,response_body=$1,updated_at=NOW() WHERE business_id=$2 AND id=$3`,[JSON.stringify({error:'Provider delivery was confirmed as not sent. Use a new Idempotency-Key to retry.',code:'PROVIDER_NOT_SENT'}),businessId,requestId]);
      await client.query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'integration_api_reconciled',$4)",[id('a'),businessId,userId,JSON.stringify({requestId,outcome})]);
      return json({ok:true,resolvedAs:'not_sent'});
    }
    if(outcome!=='sent')throw new AppError('Choose sent or not_sent after checking the provider.',400,'INTEGRATION_INVALID');
    const metaMessageId=String(request.provider_message_id||providerMessageId||'').trim();
    if(metaMessageId.length<10||metaMessageId.length>512||/\s/.test(metaMessageId)||[...metaMessageId].some(character=>character.charCodeAt(0)<32))throw new AppError('Enter the confirmed provider message ID.',400,'INTEGRATION_PROVIDER_ID_REQUIRED');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('workspace_api_provider_message'),hashtext($1))",[metaMessageId]);
    const payload=request.request_payload||{},contact=(await client.query('SELECT * FROM contacts WHERE business_id=$1 AND id=$2',[businessId,request.resource_id])).rows[0];
    const template=(await client.query('SELECT * FROM templates WHERE business_id=$1 AND id=$2',[businessId,String(payload.templateId||'')])).rows[0];
    if(!contact||!template)throw new AppError('Contact or template required for reconciliation no longer exists.',409,'INTEGRATION_RECONCILIATION_UNAVAILABLE');
    let conversation=(await client.query('SELECT * FROM conversations WHERE business_id=$1 AND contact_id=$2 FOR UPDATE',[businessId,contact.id])).rows[0];
    if(!conversation)conversation=(await client.query('INSERT INTO conversations (id,business_id,contact_id,whatsapp_phone_number_id) VALUES ($1,$2,$3,$4) RETURNING *',[id('v'),businessId,contact.id,String(payload.phoneNumberId||'')])).rows[0];
    let message=(await client.query("SELECT m.id,c.business_id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.meta_message_id=$1 AND m.direction='outgoing'",[metaMessageId])).rows[0];
    if(message&&message.business_id!==businessId)throw new AppError('This provider message ID is already assigned to another workspace.',409,'INTEGRATION_PROVIDER_ID_CONFLICT');
    if(!message){
      const messageId=id('m'),body=renderTemplate(template.body,mapContact(contact),payload.variables||{});
      message=(await client.query("INSERT INTO messages (id,conversation_id,direction,body,status,meta_message_id,message_type,metadata) VALUES ($1,$2,'outgoing',$3,'sent',$4,'template',$5) RETURNING id",[messageId,conversation.id,body,metaMessageId,JSON.stringify({templateId:template.id,requestId,reconciled:true})])).rows[0];
      await client.query('UPDATE conversations SET updated_at=NOW(),version=version+1 WHERE id=$1',[conversation.id]);
    }
    const response={ok:true,reconciled:true,messageId:message.id,metaMessageId,contactId:contact.id,conversationId:conversation.id,status:'sent'};
    await client.query(`UPDATE workspace_api_requests SET resource_id=$1,provider_message_id=$2,dispatch_status='completed',
      response_status=202,response_body=$3,error_code=NULL,updated_at=NOW() WHERE business_id=$4 AND id=$5`,[message.id,metaMessageId,JSON.stringify(response),businessId,requestId]);
    await client.query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'integration_api_reconciled',$4)",[id('a'),businessId,userId,JSON.stringify({requestId,outcome,messageId:message.id,metaMessageId})]);
    return json(response,202);
  });
}

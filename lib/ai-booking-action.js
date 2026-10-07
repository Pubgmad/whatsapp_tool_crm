import {AppError,query} from './db.js';
import {sendNativeFlowInvite} from './whatsapp-experiences.js';

export async function sendApprovedBookingFlow({businessId,userId,proposal}){
  const [settings,flow,contact]=await Promise.all([
    query('SELECT booking_flow_id,booking_invite_text,booking_invite_cta FROM ai_agent_settings WHERE business_id=$1',[businessId]),
    query("SELECT * FROM whatsapp_native_flows WHERE business_id=$1 AND id=$2 AND status='published'",[businessId,proposal.arguments.flowId]),
    query('SELECT c.id,p.id AS phone_id FROM contacts c JOIN conversations v ON v.contact_id=c.id AND v.business_id=c.business_id JOIN whatsapp_phone_numbers p ON p.business_id=v.business_id AND p.phone_number_id=v.whatsapp_phone_number_id WHERE c.business_id=$1 AND c.id=$2 AND v.id=$3',[businessId,proposal.contact_id,proposal.conversation_id])
  ]);
  const config=settings.rows[0],selectedFlow=flow.rows[0],recipient=contact.rows[0];
  if(!config||config.booking_flow_id!==selectedFlow?.id||!recipient||!config.booking_invite_text||!config.booking_invite_cta)throw new AppError('The booking Flow configuration changed.',409,'AI_ACTION_STALE');
  return sendNativeFlowInvite({businessId,userId},{requestId:proposal.id,contactId:recipient.id,phoneId:recipient.phone_id,text:config.booking_invite_text,cta:config.booking_invite_cta,expiresHours:24},selectedFlow);
}

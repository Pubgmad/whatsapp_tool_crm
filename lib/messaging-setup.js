import {AppError,query} from './db.js';

export async function messagingSetupForContact(businessId,contactId){
  const result=await query(`SELECT b.*,c.whatsapp_phone_number_id AS conversation_phone_number_id,
      p.phone_number_id AS source_phone_number_id,p.display_phone_number AS source_display_phone_number,
      a.waba_id AS source_waba_id,a.access_token_encrypted AS source_access_token_encrypted
    FROM businesses b
    LEFT JOIN conversations c ON c.business_id=b.id AND c.contact_id=$2
    LEFT JOIN whatsapp_phone_numbers p ON p.business_id=b.id AND p.phone_number_id=c.whatsapp_phone_number_id
    LEFT JOIN whatsapp_accounts a ON a.business_id=b.id AND a.id=p.whatsapp_account_id
    WHERE b.id=$1 LIMIT 1`,[businessId,contactId]);
  const setup=result.rows[0];
  if(!setup)throw new AppError('Company workspace not found.',404,'NOT_FOUND');
  if(setup.conversation_phone_number_id&&setup.conversation_phone_number_id!==setup.phone_number_id&&
    (!setup.source_phone_number_id||!setup.source_access_token_encrypted))
    throw new AppError('The WhatsApp number for this conversation is no longer connected.',409,'META_SOURCE_DISCONNECTED');
  if(setup.source_phone_number_id&&setup.source_access_token_encrypted)return {
    ...setup,default_waba_id:setup.waba_id,phone_number_id:setup.source_phone_number_id,
    whatsapp_number:setup.source_display_phone_number,waba_id:setup.source_waba_id,
    access_token_encrypted:setup.source_access_token_encrypted
  };
  return {...setup,default_waba_id:setup.waba_id};
}

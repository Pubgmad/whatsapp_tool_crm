import {AppError,query} from './db.js';
import {metaReady} from './meta.js';

async function connectedAccountFallback(businessId){
  return (await query(
    `SELECT p.phone_number_id,p.display_phone_number,a.waba_id,a.access_token_encrypted,a.token_expires_at
       FROM whatsapp_phone_numbers p
       JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id
      WHERE p.business_id=$1 AND a.status='connected' AND COALESCE(a.access_token_encrypted,'')<>''
        AND (a.token_expires_at IS NULL OR a.token_expires_at>NOW())
      ORDER BY p.is_default DESC,p.created_at LIMIT 1`,
    [businessId]
  )).rows[0] || null;
}

export async function messagingSetupForContact(businessId,contactId){
  const result=await query(`SELECT b.*,c.whatsapp_phone_number_id AS conversation_phone_number_id,
      p.phone_number_id AS source_phone_number_id,p.display_phone_number AS source_display_phone_number,
      a.waba_id AS source_waba_id,a.access_token_encrypted AS source_access_token_encrypted,
      a.status AS source_account_status,a.token_expires_at AS source_token_expires_at
    FROM businesses b
    LEFT JOIN conversations c ON c.business_id=b.id AND c.contact_id=$2
    LEFT JOIN whatsapp_phone_numbers p ON p.business_id=b.id AND p.phone_number_id=c.whatsapp_phone_number_id
    LEFT JOIN whatsapp_accounts a ON a.business_id=b.id AND a.id=p.whatsapp_account_id
    WHERE b.id=$1 LIMIT 1`,[businessId,contactId]);
  const setup=result.rows[0];
  if(!setup)throw new AppError('Company workspace not found.',404,'NOT_FOUND');
  // Conversation pinned to a number must use that number's live token — never swap to another default.
  if(setup.conversation_phone_number_id){
    if(!(setup.source_phone_number_id&&setup.source_access_token_encrypted&&String(setup.source_account_status||'').toLowerCase()==='connected'&&
      (!setup.source_token_expires_at||new Date(setup.source_token_expires_at)>new Date()))){
      throw new AppError('The WhatsApp number for this conversation is no longer connected.',409,'META_SOURCE_DISCONNECTED');
    }
    return {
      ...setup,default_waba_id:setup.waba_id,phone_number_id:setup.source_phone_number_id,
      whatsapp_number:setup.source_display_phone_number,waba_id:setup.source_waba_id,
      access_token_encrypted:setup.source_access_token_encrypted
    };
  }
  // Prefer a live connected account over denormalized businesses.* (can lag after Embedded Signup).
  const fallback=await connectedAccountFallback(businessId);
  if(fallback){
    return {
      ...setup,
      default_waba_id:fallback.waba_id,
      phone_number_id:fallback.phone_number_id,
      whatsapp_number:fallback.display_phone_number,
      waba_id:fallback.waba_id,
      access_token_encrypted:fallback.access_token_encrypted,
      meta_token_expires_at:fallback.token_expires_at
    };
  }
  if(!(metaReady(setup)&&(!setup.meta_token_expires_at||new Date(setup.meta_token_expires_at)>new Date()))){
    throw new AppError('WhatsApp is not connected for this workspace.',409,'META_NOT_CONNECTED');
  }
  return {...setup,default_waba_id:setup.waba_id};
}

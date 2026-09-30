import crypto from 'node:crypto';
import {requireSession} from './auth.js';
import {AppError,query,transaction,id,json,errorJson,enterSystemContext} from './db.js';
import {encryptSecret,decryptSecret,sendTextMessage,sendTemplateMessage} from './meta.js';
import {requireWorkspaceManager} from './workspace-permissions.js';
import {readJsonBodyLimited,readTextBodyLimited} from './security.js';
import {assertSubscriptionActive,subscriptionUsage,assertMessageCapacity} from './limits.js';
import {validateTemplateParameters,templateSendComponents} from './template-send-components.js';
import {razorpayClient,verifyRazorpaySignature,paymentMinorUnits,razorpayCheckoutUrl,paymentLinkState,razorpayRequestRejected} from './razorpay.js';

const clean=value=>String(value||'').trim();
async function credentials(businessId,enabled=false) {
  const settings=(await query('SELECT * FROM merchant_payment_settings WHERE business_id=$1',[businessId])).rows[0];
  if (!settings||(enabled&&!settings.enabled)) throw new AppError('Configure and enable company Razorpay payments first.',409,'MERCHANT_PAYMENTS_NOT_CONFIGURED');
  return {settings,client:razorpayClient(settings.key_id,decryptSecret(settings.key_secret_encrypted))};
}

export async function getMerchantPayments(request) {
  try {
    const session=await requireSession(request);requireWorkspaceManager(session);
    await query("UPDATE merchant_checkouts SET message_state='unconfirmed',error_code='META_SEND_UNCONFIRMED',updated_at=NOW() WHERE business_id=$1 AND message_state='processing' AND updated_at<NOW()-INTERVAL '5 minutes'",[session.businessId]);
    const settings=(await query('SELECT enabled,updated_at FROM merchant_payment_settings WHERE business_id=$1',[session.businessId])).rows[0]||null;
    const params=new URL(request.url).searchParams;
    const raw=Number(params.get('page')||1),page=Number.isSafeInteger(raw)?Math.max(1,Math.min(raw,100000)):1;
    const rows=(await query('SELECT id,order_id,amount_minor,currency,provider_link_id,checkout_url,status,message_state,error_code,created_at FROM merchant_checkouts WHERE business_id=$1 ORDER BY created_at DESC,id LIMIT 26 OFFSET $2',[session.businessId,(page-1)*25])).rows;
    const templates=(await query("SELECT id,name,variables,component_schema FROM templates WHERE business_id=$1 AND category='UTILITY' AND status='Approved' ORDER BY name",[session.businessId])).rows;
    const app=process.env.APP_URL;
    return json({settings,checkouts:rows.slice(0,25),page,hasMore:rows.length>25,templates,webhookUrl:app?new URL('/api/webhooks/razorpay/merchant/'+encodeURIComponent(session.businessId),app).href:null});
  }catch(error){return errorJson(error);}
}

export async function applyMerchantLink(businessId,checkout,link,eventId='') {
  const status=paymentLinkState(link,checkout);
  const url=razorpayCheckoutUrl(link.short_url);
  return transaction(async client=>{
    const locked=(await client.query('SELECT * FROM merchant_checkouts WHERE id=$1 AND business_id=$2 FOR UPDATE',[checkout.id,businessId])).rows[0];
    if (!locked) throw new AppError('Checkout no longer exists.',404,'NOT_FOUND');
    if (locked.provider_link_id&&locked.provider_link_id!==link.id) throw new AppError('Provider link changed unexpectedly.',409,'PAYMENT_LINK_MISMATCH');
    if (eventId) {
      const inserted=await client.query('INSERT INTO merchant_payment_webhooks (id,business_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id',[businessId+':'+eventId,businessId]);
      if (!inserted.rowCount) return {duplicate:true};
    }
    await client.query("UPDATE merchant_checkouts SET provider_link_id=$1,checkout_url=$2,status=CASE WHEN status='captured' THEN status ELSE $3 END,error_code='',updated_at=NOW() WHERE id=$4 AND business_id=$5",[link.id,url,status,checkout.id,businessId]);
    if (status==='captured') await client.query("UPDATE whatsapp_orders SET payment_status='captured',payment_event_at=NOW(),updated_at=NOW() WHERE id=$1 AND business_id=$2",[checkout.order_id,businessId]);
    else if (locked.status!=='captured') await client.query("UPDATE whatsapp_orders SET payment_status=$1,updated_at=NOW() WHERE id=$2 AND business_id=$3 AND payment_status<>'captured'",[status==='pending'?'pending':'failed',checkout.order_id,businessId]);
    return {status:locked.status==='captured'?'captured':status,url};
  });
}

async function reconcileCheckout(businessId,checkout,client) {
  let link;
  if (checkout.provider_link_id) link=await client.paymentLink.fetch(checkout.provider_link_id);
  else {
    const result=await client.paymentLink.all({reference_id:checkout.id,count:2});
    const matches=(result.payment_links||result.items||[]).filter(item=>item.reference_id===checkout.id);
    if (matches.length!==1) throw new AppError('Provider delivery remains unconfirmed. Check the Razorpay dashboard before creating another request.',409,'PAYMENT_DELIVERY_UNCONFIRMED');
    link=matches[0];
  }
  return applyMerchantLink(businessId,checkout,link);
}

export async function updateMerchantPayments(request) {
  try {
    const session=await requireSession(request);requireWorkspaceManager(session);
    const body=await readJsonBodyLimited(request,65536);
    if (body.action==='disable') {
      if(session.role!=='Owner')throw new AppError('Only the owner can manage payment credentials.',403,'FORBIDDEN');
      await query('UPDATE merchant_payment_settings SET enabled=FALSE,updated_at=NOW() WHERE business_id=$1',[session.businessId]);
      await query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'merchant_payments_disabled','{}']);
      return json({ok:true});
    }
    assertSubscriptionActive(await subscriptionUsage(session.businessId));
    if(body.action==='configure'){
      if(session.role!=='Owner')throw new AppError('Only the owner can manage payment credentials.',403,'FORBIDDEN');
      const previous=(await query('SELECT * FROM merchant_payment_settings WHERE business_id=$1',[session.businessId])).rows[0];
      const keyId=clean(body.keyId)||previous?.key_id;
      const secret=clean(body.keySecret)||(previous?decryptSecret(previous.key_secret_encrypted):'');
      const webhook=clean(body.webhookSecret)||(previous?decryptSecret(previous.webhook_secret_encrypted):'');
      if (!/^rzp_(live|test)_[A-Za-z0-9]+$/.test(keyId||'')||secret.length<16||secret.length>512||webhook.length<32||webhook.length>512||typeof body.enabled!=='boolean')throw new AppError('Provide valid Razorpay keys and a webhook secret of at least 32 characters.',400,'MERCHANT_CREDENTIALS_INVALID');
      await razorpayClient(keyId,secret).paymentLink.all({count:1});
      await transaction(async client=>{
        await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[session.businessId]);
        const locked=(await client.query('SELECT * FROM merchant_payment_settings WHERE business_id=$1 FOR UPDATE',[session.businessId])).rows[0];
        if(locked&&locked.key_id!==keyId&&(await client.query("SELECT 1 FROM merchant_checkouts WHERE business_id=$1 LIMIT 1",[session.businessId])).rowCount)throw new AppError('Keep the original merchant account for payment reconciliation. Rotate its secret without replacing the account.',409,'MERCHANT_PAYMENTS_ACTIVE');
        if(locked&&locked.key_id!==keyId&&(await client.query('SELECT 1 FROM whatsapp_native_checkouts WHERE business_id=$1 LIMIT 1',[session.businessId])).rowCount)throw new AppError('Keep the original merchant account for native checkout reconciliation.',409,'MERCHANT_PAYMENTS_ACTIVE');
        if(locked?.updated_at?.getTime()!==previous?.updated_at?.getTime())throw new AppError('Payment settings changed. Refresh before saving.',409,'MERCHANT_CONFIGURATION_CHANGED');
        await client.query("INSERT INTO merchant_payment_settings (business_id,key_id,key_secret_encrypted,webhook_secret_encrypted,webhook_secret_previous_encrypted,enabled) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (business_id) DO UPDATE SET key_id=EXCLUDED.key_id,key_secret_encrypted=EXCLUDED.key_secret_encrypted,webhook_secret_previous_encrypted=EXCLUDED.webhook_secret_previous_encrypted,webhook_secret_encrypted=EXCLUDED.webhook_secret_encrypted,enabled=EXCLUDED.enabled,updated_at=NOW()",[session.businessId,keyId,encryptSecret(secret),encryptSecret(webhook),previous?.webhook_secret_encrypted||'',body.enabled]);
        await client.query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'merchant_payments_configured',JSON.stringify({enabled:body.enabled})]);
      });
      return json({ok:true});
    }
    const {client,settings}=await credentials(session.businessId,body.action==='create'||body.action==='send');
    if(body.action==='create'){
      const checkout=await transaction(async db=>{
        await db.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[session.businessId]);
        const latest=(await db.query('SELECT key_id,enabled FROM merchant_payment_settings WHERE business_id=$1',[session.businessId])).rows[0];
        if(!latest?.enabled||latest.key_id!==settings.key_id)throw new AppError('Merchant configuration changed. Refresh before retrying.',409,'MERCHANT_CONFIGURATION_CHANGED');
        const order=(await db.query('SELECT * FROM whatsapp_orders WHERE id=$1 AND business_id=$2 FOR UPDATE',[clean(body.orderId),session.businessId])).rows[0];
        if(!order)throw new AppError('Order not found.',404,'NOT_FOUND');
        if(order.payment_status==='captured'||order.fulfillment_status==='cancelled')throw new AppError('This order cannot receive another payment request.',409,'ORDER_PAYMENT_CLOSED');
        if((await db.query("SELECT 1 FROM whatsapp_native_checkouts WHERE business_id=$1 AND order_id=$2 AND status<>'failed'",[session.businessId,order.id])).rowCount)throw new AppError('Reconcile the existing native checkout before creating a hosted request.',409,'CHECKOUT_ALREADY_EXISTS');
        const existing=(await db.query("SELECT * FROM merchant_checkouts WHERE order_id=$1 AND business_id=$2 AND status NOT IN ('failed','expired','cancelled') ORDER BY created_at DESC LIMIT 1",[order.id,session.businessId])).rows[0];
        if(existing)return {...existing,existing:true};
        const amount=paymentMinorUnits(order.total_amount,order.currency);
        const result=(await db.query("INSERT INTO merchant_checkouts (id,business_id,order_id,amount_minor,currency,status) VALUES ($1,$2,$3,$4,$5,'processing') RETURNING *",[id('pay'),session.businessId,order.id,amount,order.currency])).rows[0];
        await db.query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'merchant_checkout_requested',JSON.stringify({checkoutId:result.id,orderId:order.id})]);
        return result;
      });
      if(checkout.existing) {
        if(checkout.status==='processing'||checkout.status==='unconfirmed')throw new AppError('Reconcile the existing payment request before retrying.',409,'PAYMENT_DELIVERY_UNCONFIRMED');
        return json({ok:true,duplicate:true,url:checkout.checkout_url,checkoutId:checkout.id});
      }
      try {
        const link=await client.paymentLink.create({amount:Number(checkout.amount_minor),currency:checkout.currency,accept_partial:false,reference_id:checkout.id,description:checkout.order_id,notify:{sms:false,email:false},reminder_enable:false,notes:{checkoutId:checkout.id}});
        const result=await applyMerchantLink(session.businessId,checkout,link);
        return json({ok:true,checkoutId:checkout.id,...result},201);
      }catch(error){
        const definitive=razorpayRequestRejected(error);
        await query('UPDATE merchant_checkouts SET status=$1,error_code=$2,updated_at=NOW() WHERE id=$3 AND business_id=$4 AND provider_link_id IS NULL',[definitive?'failed':'unconfirmed',definitive?'RAZORPAY_CREATE_REJECTED':'PAYMENT_DELIVERY_UNCONFIRMED',checkout.id,session.businessId]);
        throw new AppError(definitive?'Razorpay rejected the payment request. Check currency, amount and merchant eligibility.':'Payment creation is unconfirmed. Reconcile before retrying.',409,definitive?'RAZORPAY_CREATE_REJECTED':'PAYMENT_DELIVERY_UNCONFIRMED');
      }
    }
    const checkout=(await query('SELECT * FROM merchant_checkouts WHERE id=$1 AND business_id=$2',[clean(body.checkoutId),session.businessId])).rows[0];
    if(!checkout)throw new AppError('Checkout not found.',404,'NOT_FOUND');
    if(body.action==='reconcile')return json({ok:true,...await reconcileCheckout(session.businessId,checkout,client)});
    if(body.action!=='send')throw new AppError('Unsupported payment action.',400,'INVALID_ACTION');
    await reconcileCheckout(session.businessId,checkout,client);
    const current=(await query('SELECT * FROM merchant_checkouts WHERE id=$1 AND business_id=$2',[checkout.id,session.businessId])).rows[0];
    if(current.status!=='pending')throw new AppError('Only an unpaid active checkout can be sent.',409,'PAYMENT_LINK_INACTIVE');
    const target=(await query("SELECT o.customer_phone,p.phone_number_id,a.waba_id,a.access_token_encrypted,a.status,a.token_expires_at,ct.id AS contact_id,ct.last_message_at,c.id AS conversation_id FROM whatsapp_orders o JOIN whatsapp_phone_numbers p ON p.id=o.phone_id AND p.business_id=o.business_id JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=o.business_id JOIN contacts ct ON ct.business_id=o.business_id AND ct.phone=o.customer_phone JOIN conversations c ON c.business_id=o.business_id AND c.contact_id=ct.id AND c.whatsapp_phone_number_id=p.phone_number_id WHERE o.id=$1 AND o.business_id=$2 AND ct.unsubscribed=FALSE AND a.status='connected' AND p.registration_state='registered'",[checkout.order_id,session.businessId])).rows[0];
    if(!target||(target.token_expires_at&&new Date(target.token_expires_at)<=new Date()))throw new AppError('The customer or WhatsApp number is not eligible for this request.',409,'PAYMENT_RECIPIENT_INELIGIBLE');
    let template=null,variables=[],parameters=body.parameters||{};
    if(body.templateId){
      template=(await query("SELECT * FROM templates WHERE id=$1 AND business_id=$2 AND status='Approved' AND category='UTILITY'",[clean(body.templateId),session.businessId])).rows[0];
      const slot=Number(body.linkVariable);
      if(!template||!Number.isInteger(slot)||slot<0||slot>=template.variables.length||!Array.isArray(body.variables)||body.variables.length!==template.variables.length)throw new AppError('Choose an approved utility template and its payment-link variable.',400,'PAYMENT_TEMPLATE_INVALID');
      variables=body.variables.map(value=>clean(value));variables[slot]=current.checkout_url;
      if(variables.some(value=>!value))throw new AppError('Complete every template variable.',400,'PAYMENT_TEMPLATE_INVALID');
      validateTemplateParameters(template,parameters);
      templateSendComponents(variables,parameters);
    }else if(!target.last_message_at||Date.now()-new Date(target.last_message_at).getTime()>86400000)throw new AppError('The service window is closed. Use an approved utility template.',409,'REPLY_WINDOW_CLOSED');
    const text=clean(body.message);
    if(!template&&(!text||text.length>2000))throw new AppError('Provide the payment-request message.',400,'PAYMENT_MESSAGE_REQUIRED');
    await assertMessageCapacity(session.businessId,1,null,target.contact_id);
    const claimed=await query("UPDATE merchant_checkouts SET message_state='processing',updated_at=NOW() WHERE id=$1 AND business_id=$2 AND message_state IN ('none','failed') RETURNING id",[checkout.id,session.businessId]);
    if(!claimed.rowCount)throw new AppError('This request was already sent or delivery is unconfirmed.',409,'PAYMENT_MESSAGE_ALREADY_CLAIMED');
    try{
      const setup={...target,access_token_encrypted:target.access_token_encrypted};
      const messageBody=text+'\n'+current.checkout_url;
      const sent=template?await sendTemplateMessage({setup,to:target.customer_phone,templateName:template.meta_template_name||template.name,language:template.language,variables,parameters}):await sendTextMessage({setup,to:target.customer_phone,body:messageBody});
      await transaction(async db=>{
        await db.query("UPDATE merchant_checkouts SET message_state='sent',meta_message_id=$1,updated_at=NOW() WHERE id=$2 AND business_id=$3",[sent.metaMessageId,checkout.id,session.businessId]);
        await db.query("INSERT INTO messages (id,conversation_id,direction,body,status,meta_message_id,message_type,metadata) VALUES ($1,$2,'outgoing',$3,'sent',$4,$5,$6)",[id('m'),target.conversation_id,template?variables.join(' '):messageBody,sent.metaMessageId,template?'template':'text',JSON.stringify({checkoutId:checkout.id,templateId:template?.id})]);
        await db.query('UPDATE conversations SET updated_at=NOW(),version=version+1 WHERE id=$1',[target.conversation_id]);
        await db.query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'merchant_checkout_sent',JSON.stringify({checkoutId:checkout.id,metaMessageId:sent.metaMessageId})]);
      });
    }catch(error){
      const rejected=error.code==='META_SEND_FAILED'&&error.status<500;
      await query('UPDATE merchant_checkouts SET message_state=$1,error_code=$2,updated_at=NOW() WHERE id=$3 AND business_id=$4 AND message_state=$5',[rejected?'failed':'unconfirmed',rejected?'META_SEND_FAILED':'META_SEND_UNCONFIRMED',checkout.id,session.businessId,'processing']);
      throw new AppError('Payment message delivery was not confirmed. Check the conversation before retrying.',409,'PAYMENT_MESSAGE_UNCONFIRMED');
    }
    return json({ok:true},201);
  }catch(error){
    if(!error.code&&!error.status)return errorJson(new AppError('Razorpay could not verify the request. Check merchant credentials and eligibility.',502,'RAZORPAY_REQUEST_FAILED'));
    return errorJson(error);
  }
}

export async function receiveMerchantPaymentWebhook(request,businessId) {
  try{
    enterSystemContext();
    const raw=await readTextBodyLimited(request,262144);
    const {settings,client}=await credentials(businessId);
    const signature=request.headers.get('x-razorpay-signature');
    try{verifyRazorpaySignature(raw,signature,decryptSecret(settings.webhook_secret_encrypted));}
    catch(error){if(!settings.webhook_secret_previous_encrypted)throw error;verifyRazorpaySignature(raw,signature,decryptSecret(settings.webhook_secret_previous_encrypted));}
    const event=JSON.parse(raw);
    const {ingestNativeRazorpayWebhook}=await import('./whatsapp-native-payments.js');
    if(await ingestNativeRazorpayWebhook(businessId,event))return json({received:true,native:true});
    const entity=event.payload?.payment_link?.entity;
    if(!entity||!/^plink_[A-Za-z0-9]+$/.test(entity.id||''))return json({received:true,ignored:true});
    const checkout=(await query('SELECT * FROM merchant_checkouts WHERE business_id=$1 AND id=$2',[businessId,clean(entity.reference_id)])).rows[0];
    if(!checkout)return json({received:true,ignored:true});
    const link=await client.paymentLink.fetch(entity.id);
    const eventId=request.headers.get('x-razorpay-event-id')||crypto.createHash('sha256').update(raw).digest('hex');
    if(eventId.length>256)throw new AppError('Invalid webhook event ID.',400,'WEBHOOK_EVENT_INVALID');
    return json({received:true,...await applyMerchantLink(businessId,checkout,link,eventId)});
  }catch(error){return errorJson(error);}
}

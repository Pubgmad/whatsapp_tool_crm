import {requireSession} from './auth.js';
import {AppError,query,transaction,id,json,errorJson} from './db.js';
import {decryptSecret} from './meta.js';
import {requireWorkspaceManager} from './workspace-permissions.js';
import {readJsonBodyLimited,readTextBodyLimited} from './security.js';
import {assertSubscriptionActive,subscriptionUsage,assertMessageCapacity} from './limits.js';
import {paymentMinorUnits,razorpayClient} from './razorpay.js';

const clean=value=>String(value||'').trim();
async function graph(account,path,body){
  const response=await fetch('https://graph.facebook.com/'+(process.env.META_GRAPH_API_VERSION||'v26.0')+'/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+decryptSecret(account.access_token_encrypted),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  const payload=JSON.parse(await readTextBodyLimited(response,2_000_000));
  if(!response.ok)throw new AppError(payload.error?.message||'Meta payments request failed.',response.status>=500?502:400,response.status>=500||[408,409].includes(response.status)?'NATIVE_PAYMENT_UNCONFIRMED':'NATIVE_PAYMENT_REJECTED');
  return payload;
}
async function accountFor(businessId,accountId){
  const account=(await query("SELECT * FROM whatsapp_accounts WHERE business_id=$1 AND id=$2 AND status='connected'",[businessId,accountId])).rows[0];
  if(!account||(account.token_expires_at&&new Date(account.token_expires_at)<=new Date()))throw new AppError('Reconnect the WhatsApp account.',409,'META_RECONNECT_REQUIRED');
  return account;
}
export function nativeOrderPayload(order,configuration,text,names,goodsType,beneficiaries,reference){
  if(order.currency!=='INR'||!['digital-goods','physical-goods'].includes(goodsType)||!/^\d{1,32}$/.test(order.catalog_id)||!/^[-\w.]{1,35}$/.test(reference)||!clean(text)||clean(text).length>1024)throw new AppError('Provide an INR catalog order, goods type and message.',400,'NATIVE_ORDER_INVALID');
  const total=paymentMinorUnits(order.total_amount,'INR');
  if(total>50_000_000)throw new AppError('This checkout exceeds the native UPI transaction limit.',400,'NATIVE_ORDER_LIMIT');
  let sum=0;
  const items=order.items.map(item=>{
    const amount=paymentMinorUnits(item.price,'INR');
    if(!Number.isSafeInteger(item.quantity)||item.quantity<1||!clean(names[item.retailerId])||clean(names[item.retailerId]).length>60)throw new AppError('Every catalog item needs a valid quantity and product name.',400,'NATIVE_ORDER_INVALID');
    sum+=amount*item.quantity;
    return {retailer_id:item.retailerId,name:names[item.retailerId],quantity:item.quantity,amount:{value:amount,offset:100}};
  });
  if(!Number.isSafeInteger(sum)||sum!==total||items.length<1||items.length>100)throw new AppError('Order line amounts do not match the saved total.',409,'NATIVE_ORDER_AMOUNT_MISMATCH');
  let shipping;
  if(beneficiaries!==undefined){
    if(goodsType!=='physical-goods'||!Array.isArray(beneficiaries)||beneficiaries.length!==1)throw new AppError('Provide one shipping beneficiary for physical goods.',400,'NATIVE_ORDER_INVALID');
    shipping=beneficiaries.map(b=>{
      for(const [key,max] of Object.entries({name:200,address_line1:100,city:100,state:100,postal_code:6}))if(!clean(b[key])||clean(b[key]).length>max)throw new AppError('Complete the shipping beneficiary.',400,'NATIVE_ORDER_INVALID');
      if(!/^\d{6}$/.test(b.postal_code))throw new AppError('Provide a six-digit Indian postal code.',400,'NATIVE_ORDER_INVALID');
      return {name:clean(b.name),address_line1:clean(b.address_line1),city:clean(b.city),state:clean(b.state),postal_code:b.postal_code,country:'India'};
    });
  }
  const parameters={reference_id:reference,type:goodsType,...(shipping?{beneficiaries:shipping}:{}),payment_settings:[{type:'payment_gateway',payment_gateway:{type:'razorpay',configuration_name:configuration,razorpay:{receipt:reference,notes:{nativeCheckoutId:reference,orderId:order.id}}}}],currency:'INR',total_amount:{value:total,offset:100},order:{status:'pending',catalog_id:order.catalog_id,items,subtotal:{value:total,offset:100},tax:{value:0,offset:100}}};
  return {messaging_product:'whatsapp',recipient_type:'individual',to:order.customer_phone,type:'interactive',interactive:{type:'order_details',body:{text:clean(text)},action:{name:'review_and_pay',parameters:JSON.stringify(parameters)}}};
}
export async function getNativePayments(request){
  try{
    const session=await requireSession(request);requireWorkspaceManager(session);
    const params=new URL(request.url).searchParams;
    if(params.get('accountId')){
      const account=await accountFor(session.businessId,params.get('accountId'));
      const result=await graph(account,account.waba_id+'/payment_configurations');
      const configurations=(result.data||[]).flatMap(item=>item.payment_configurations||[item]).filter(item=>String(item.provider_name||'').toLowerCase()==='razorpay');
      return json({configurations});
    }
    const raw=Number(params.get('page')||1),page=Number.isSafeInteger(raw)?Math.min(100000,Math.max(1,raw)):1;
    const rows=(await query('SELECT id,order_id,configuration_name,amount_minor,status,message_id,provider_payment_id,refunded_minor,error_code,created_at FROM whatsapp_native_checkouts WHERE business_id=$1 ORDER BY created_at DESC,id LIMIT 26 OFFSET $2',[session.businessId,(page-1)*25])).rows;
    return json({checkouts:rows.slice(0,25),page,hasMore:rows.length>25});
  }catch(error){return errorJson(error);}
}
export function verifiedNativePayment(payment,checkout,providerPayment,providerOrder){
  if(payment.reference_id!==checkout.id||payment.currency!=='INR'||payment.amount?.offset!==100||String(payment.amount.value)!==String(checkout.amount_minor))throw new AppError('Meta payment does not match the saved checkout.',409,'NATIVE_PAYMENT_MISMATCH');
  if(payment.status!=='captured')return 'pending';
  const successful=payment.transactions?.filter(item=>item.status==='success'&&item.type==='razorpay');
  if(successful?.length!==1||!providerPayment||!providerOrder||successful[0].pg_transaction_id!==providerPayment.id||successful[0].id!==providerOrder.id||providerPayment.order_id!==providerOrder.id||providerPayment.status!=='captured'||providerPayment.currency!=='INR'||providerOrder.currency!=='INR'||String(providerPayment.amount)!==String(checkout.amount_minor)||String(providerOrder.amount)!==String(checkout.amount_minor)||providerOrder.receipt!==checkout.id||providerOrder.notes?.nativeCheckoutId!==checkout.id||providerOrder.notes?.orderId!==checkout.order_id||!Number.isSafeInteger(providerPayment.amount_refunded)||providerPayment.amount_refunded<0||providerPayment.amount_refunded>providerPayment.amount)throw new AppError('Razorpay has not confirmed the exact captured order payment.',409,'NATIVE_PAYMENT_MISMATCH');
  return providerPayment.amount_refunded>0?'refunded':'captured';
}
async function reconcile(businessId,checkout){
  const order=(await query('SELECT o.*,p.phone_number_id,p.whatsapp_account_id FROM whatsapp_orders o JOIN whatsapp_phone_numbers p ON p.id=o.phone_id AND p.business_id=o.business_id WHERE o.business_id=$1 AND o.id=$2',[businessId,checkout.order_id])).rows[0];
  const account=await accountFor(businessId,order.whatsapp_account_id);
  const result=await graph(account,order.phone_number_id+'/payments/'+encodeURIComponent(checkout.configuration_name)+'/'+encodeURIComponent(checkout.id));
  const payment=result.payments?.find(item=>item.reference_id===checkout.id);
  if(!payment)throw new AppError('Meta has not returned this checkout. Do not resend it.',409,'NATIVE_PAYMENT_UNCONFIRMED');
  let providerPayment,providerOrder;
  if(payment.status==='captured'){
    const transaction=payment.transactions?.find(item=>item.status==='success'&&item.type==='razorpay');
    if(!/^pay_[A-Za-z0-9]+$/.test(transaction?.pg_transaction_id||'')||!/^order_[A-Za-z0-9]+$/.test(transaction?.id||''))throw new AppError('Meta did not return a valid Razorpay transaction.',409,'NATIVE_PAYMENT_MISMATCH');
    const settings=(await query('SELECT * FROM merchant_payment_settings WHERE business_id=$1',[businessId])).rows[0];
    if(!settings)throw new AppError('Configure the same Razorpay merchant account to verify payment capture.',409,'MERCHANT_PAYMENTS_NOT_CONFIGURED');
    const client=razorpayClient(settings.key_id,decryptSecret(settings.key_secret_encrypted));
    providerPayment=await client.payments.fetch(transaction.pg_transaction_id);providerOrder=await client.orders.fetch(transaction.id);
  }
  const status=verifiedNativePayment(payment,checkout,providerPayment,providerOrder);
  await transaction(async client=>{
    const locked=(await client.query('SELECT * FROM whatsapp_native_checkouts WHERE id=$1 AND business_id=$2 FOR UPDATE',[checkout.id,businessId])).rows[0];
    if(['captured','refunded'].includes(locked.status)&&status==='pending')return;
    if(locked.provider_payment_id&&providerPayment&&locked.provider_payment_id!==providerPayment.id)throw new AppError('Payment identity changed.',409,'NATIVE_PAYMENT_MISMATCH');
    await client.query("UPDATE whatsapp_native_checkouts SET status=$1,provider_payment_id=COALESCE($2,provider_payment_id),provider_order_id=COALESCE($3,provider_order_id),refunded_minor=COALESCE($4,refunded_minor),error_code='',updated_at=NOW() WHERE id=$5",[status,providerPayment?.id||null,providerOrder?.id||null,providerPayment?.amount_refunded??null,checkout.id]);
    await client.query("UPDATE whatsapp_orders SET payment_status=CASE WHEN payment_status='captured' THEN payment_status ELSE $1 END,payment_event_at=NOW(),updated_at=NOW() WHERE id=$2 AND business_id=$3",[status==='captured'?'captured':status==='refunded'?'failed':'pending',checkout.order_id,businessId]);
  });
  return {status,refundedMinor:providerPayment?.amount_refunded||0};
}
export async function ingestNativePaymentWebhook(businessId,phoneNumberId,event){
  const checkout=(await query('SELECT n.* FROM whatsapp_native_checkouts n JOIN whatsapp_orders o ON o.id=n.order_id AND o.business_id=n.business_id JOIN whatsapp_phone_numbers p ON p.id=o.phone_id AND p.business_id=o.business_id WHERE n.business_id=$1 AND n.id=$2 AND p.phone_number_id=$3',[businessId,clean(event.payment?.reference_id),phoneNumberId])).rows[0];
  if(checkout)await reconcile(businessId,checkout);
}
export async function ingestNativeRazorpayWebhook(businessId,event){
  const entity=event.payload?.payment?.entity||event.payload?.refund?.entity;
  const checkoutId=entity?.notes?.nativeCheckoutId;
  const paymentId=event.payload?.payment?.entity?.id||event.payload?.refund?.entity?.payment_id;
  const checkout=(await query('SELECT * FROM whatsapp_native_checkouts WHERE business_id=$1 AND (id=$2 OR (provider_payment_id=$3 AND provider_payment_id<>\'\'))',[businessId,clean(checkoutId),clean(paymentId)])).rows[0];
  if(!checkout)return false;
  await reconcile(businessId,checkout);return true;
}
export async function updateNativePayments(request){
  try{
    const session=await requireSession(request);requireWorkspaceManager(session);
    const body=await readJsonBodyLimited(request,24000);
    assertSubscriptionActive(await subscriptionUsage(session.businessId));
    if(['configure','reconnect'].includes(body.action)){
      if(session.role!=='Owner')throw new AppError('Only the owner can link a payment configuration.',403,'FORBIDDEN');
      const account=await accountFor(session.businessId,body.accountId);
      if(!/^[A-Za-z0-9_.-]{1,60}$/.test(body.configurationName||''))throw new AppError('Provide a valid payment configuration name.',400,'NATIVE_CONFIGURATION_INVALID');
      const app=new URL(process.env.APP_URL);if(app.protocol!=='https:')throw new AppError('A production HTTPS APP_URL is required.',503,'APP_URL_INVALID');
      const result=await graph(account,account.waba_id+'/'+(body.action==='configure'?'payment_configuration':'generate_payment_configuration_oauth_link'),{configuration_name:body.configurationName,redirect_url:new URL('/app/commerce',app).href,...(body.action==='configure'?{provider_name:'razorpay'}:{})});
      const url=new URL(result.oauth_url);if(url.protocol!=='https:'||!['www.facebook.com','business.facebook.com'].includes(url.hostname)||url.username||url.password)throw new AppError('Meta returned an invalid onboarding URL.',502,'NATIVE_CONFIGURATION_INVALID');
      await query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'native_payment_'+body.action,JSON.stringify({accountId:account.id,configurationName:body.configurationName})]);
      return json({url:url.href});
    }
    if(body.action==='reconcile'){
      const checkout=(await query('SELECT * FROM whatsapp_native_checkouts WHERE business_id=$1 AND id=$2',[session.businessId,body.checkoutId])).rows[0];if(!checkout)throw new AppError('Checkout not found.',404,'NOT_FOUND');
      return json(await reconcile(session.businessId,checkout));
    }
    if(body.action==='notifyFulfillment'){
      if(!clean(body.message)||clean(body.message).length>1024)throw new AppError('Provide an order status message.',400,'NATIVE_ORDER_INVALID');
      const target=(await query("SELECT o.*,p.phone_number_id,p.whatsapp_account_id,ct.id AS contact_id,c.id AS conversation_id,(SELECT MAX(at) FROM messages WHERE conversation_id=c.id AND direction='incoming') AS last_incoming_at,n.id AS checkout_id FROM whatsapp_orders o JOIN whatsapp_native_checkouts n ON n.order_id=o.id AND n.business_id=o.business_id AND n.message_id<>'' JOIN whatsapp_phone_numbers p ON p.id=o.phone_id AND p.business_id=o.business_id JOIN contacts ct ON ct.business_id=o.business_id AND ct.phone=o.customer_phone JOIN conversations c ON c.business_id=o.business_id AND c.contact_id=ct.id AND c.whatsapp_phone_number_id=p.phone_number_id WHERE o.business_id=$1 AND o.id=$2 AND ct.unsubscribed=FALSE ORDER BY n.created_at DESC LIMIT 1",[session.businessId,body.orderId])).rows[0];
      if(!target||!['processing','shipped','completed','cancelled'].includes(target.fulfillment_status))throw new AppError('Save a supported fulfillment status before notifying the customer.',409,'ORDER_STATUS_INVALID');
      if(!target.last_incoming_at||Date.now()-new Date(target.last_incoming_at).getTime()>86400000)throw new AppError('The service window is closed. Ask the customer to message before an interactive order update.',409,'REPLY_WINDOW_CLOSED');
      const account=await accountFor(session.businessId,target.whatsapp_account_id);await assertMessageCapacity(session.businessId,1,null,target.contact_id);
      const operationId=id('nou');
      const claimed=await query("INSERT INTO whatsapp_native_order_updates (id,business_id,order_id,fulfillment_status,status) VALUES ($1,$2,$3,$4,'processing') ON CONFLICT (order_id,fulfillment_status) DO NOTHING RETURNING id",[operationId,session.businessId,target.id,target.fulfillment_status]);
      if(!claimed.rowCount)throw new AppError('This status update already has a recorded delivery attempt. Do not duplicate it.',409,'ORDER_UPDATE_EXISTS');
      let messageId;
      try{
        const result=await graph(account,target.phone_number_id+'/messages',{messaging_product:'whatsapp',recipient_type:'individual',to:target.customer_phone,type:'interactive',interactive:{type:'order_status',body:{text:clean(body.message)},action:{name:'review_order',parameters:JSON.stringify({reference_id:target.checkout_id,order:{status:target.fulfillment_status==='cancelled'?'canceled':target.fulfillment_status}})}}});
        messageId=result.messages?.[0]?.id;if(typeof messageId!=='string'||!messageId)throw new AppError('Meta did not confirm the order update.',409,'NATIVE_PAYMENT_UNCONFIRMED');
      }catch(error){await query('UPDATE whatsapp_native_order_updates SET status=$1 WHERE id=$2',[error.code==='NATIVE_PAYMENT_REJECTED'?'failed':'unconfirmed',operationId]);throw error;}
      await transaction(async client=>{
        await client.query("UPDATE whatsapp_native_order_updates SET status='confirmed',message_id=$1 WHERE id=$2",[messageId,operationId]);
        await client.query("INSERT INTO messages (id,conversation_id,direction,body,message_type,status,meta_message_id,metadata) VALUES ($1,$2,'outgoing',$3,'interactive','sent',$4,$5)",[id('m'),target.conversation_id,clean(body.message),messageId,JSON.stringify({orderId:target.id,orderUpdateId:operationId})]);
        await client.query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'native_order_update_sent',JSON.stringify({orderId:target.id,operationId,messageId,status:target.fulfillment_status})]);
      });
      return json({ok:true,messageId},201);
    }
    if(body.action!=='send')throw new AppError('Unsupported native payment action.',400,'INVALID_ACTION');
    const target=(await query("SELECT o.*,p.phone_number_id,p.whatsapp_account_id,ct.id AS contact_id,(SELECT MAX(at) FROM messages WHERE conversation_id=c.id AND direction='incoming') AS last_message_at,c.id AS conversation_id FROM whatsapp_orders o JOIN whatsapp_phone_numbers p ON p.id=o.phone_id AND p.business_id=o.business_id JOIN contacts ct ON ct.business_id=o.business_id AND ct.phone=o.customer_phone JOIN conversations c ON c.business_id=o.business_id AND c.contact_id=ct.id AND c.whatsapp_phone_number_id=p.phone_number_id WHERE o.business_id=$1 AND o.id=$2 AND ct.unsubscribed=FALSE AND p.registration_state='registered'",[session.businessId,body.orderId])).rows[0];
    if(!target)throw new AppError('The order or customer is not eligible for checkout.',409,'NATIVE_ORDER_INVALID');
    if(!target.last_message_at||Date.now()-new Date(target.last_message_at).getTime()>86400000)throw new AppError('The service window is closed. The customer must message you before an interactive checkout.',409,'REPLY_WINDOW_CLOSED');
    const account=await accountFor(session.businessId,target.whatsapp_account_id);
    const configs=await graph(account,account.waba_id+'/payment_configurations');
    const config=(configs.data||[]).flatMap(item=>item.payment_configurations||[item]).find(item=>item.configuration_name===body.configurationName&&item.status==='Active'&&String(item.provider_name).toLowerCase()==='razorpay');
    if(!config)throw new AppError('Select an active Razorpay payment configuration linked to this WABA.',409,'NATIVE_CONFIGURATION_INACTIVE');
    if(!(await query('SELECT 1 FROM merchant_payment_settings WHERE business_id=$1 AND enabled=TRUE',[session.businessId])).rowCount)throw new AppError('Enable the linked Razorpay merchant credentials for capture verification.',409,'MERCHANT_PAYMENTS_NOT_CONFIGURED');
    const catalogs=await graph(account,account.waba_id+'/product_catalogs?fields=id&limit=100');
    if(!catalogs.data?.some(item=>item.id===target.catalog_id))throw new AppError('The order catalog is not linked to this WABA.',403,'CATALOG_ACCESS_DENIED');
    const names={};let cursor='';
    for(let n=0;n<10;n++){
      const result=await graph(account,target.catalog_id+'/products?fields=retailer_id,name&limit=100'+(cursor?'&after='+encodeURIComponent(cursor):''));
      for(const product of result.data||[])if(target.items.some(item=>item.retailerId===product.retailer_id))names[product.retailer_id]=product.name;
      if(target.items.every(item=>names[item.retailerId])||!result.paging?.next)break;cursor=result.paging?.cursors?.after;if(!cursor)break;
    }
    const reference=id('np');const wire=nativeOrderPayload(target,config.configuration_name,body.message,names,body.goodsType,body.beneficiaries,reference);
    await assertMessageCapacity(session.businessId,1,null,target.contact_id);
    await transaction(async client=>{
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[session.businessId]);
      const order=(await client.query('SELECT * FROM whatsapp_orders WHERE id=$1 AND business_id=$2 FOR UPDATE',[target.id,session.businessId])).rows[0];
      if(order.payment_status==='captured'||order.fulfillment_status==='cancelled'||String(order.total_amount)!==String(target.total_amount)||JSON.stringify(order.items)!==JSON.stringify(target.items))throw new AppError('The order changed or has closed.',409,'ORDER_PAYMENT_CLOSED');
      if((await client.query("SELECT 1 FROM merchant_checkouts WHERE business_id=$1 AND order_id=$2 AND status NOT IN ('failed','expired','cancelled')",[session.businessId,target.id])).rowCount)throw new AppError('Reconcile or close the hosted payment request before native checkout.',409,'CHECKOUT_ALREADY_EXISTS');
      await client.query("INSERT INTO whatsapp_native_checkouts (id,business_id,order_id,configuration_name,amount_minor,status) VALUES ($1,$2,$3,$4,$5,'processing')",[reference,session.businessId,target.id,config.configuration_name,paymentMinorUnits(target.total_amount,'INR')]);
    });
    let messageId;
    try{
      const result=await graph(account,target.phone_number_id+'/messages',wire);messageId=result.messages?.[0]?.id;
      if(typeof messageId!=='string'||!messageId)throw new AppError('Meta did not confirm checkout delivery.',409,'NATIVE_PAYMENT_UNCONFIRMED');
    }catch(error){await query('UPDATE whatsapp_native_checkouts SET status=$1,error_code=$2,updated_at=NOW() WHERE id=$3',[error.code==='NATIVE_PAYMENT_REJECTED'?'failed':'unconfirmed',error.code||'NATIVE_PAYMENT_UNCONFIRMED',reference]);throw error;}
    await transaction(async client=>{
      await client.query("UPDATE whatsapp_native_checkouts SET message_id=$1,status=CASE WHEN status IN ('captured','refunded') THEN status ELSE 'pending' END,updated_at=NOW() WHERE id=$2",[messageId,reference]);
      await client.query("UPDATE whatsapp_orders SET reference_id=$1,checkout_message_id=$2,payment_status=CASE WHEN payment_status='captured' THEN payment_status ELSE 'pending' END,updated_at=NOW() WHERE id=$3 AND business_id=$4",[reference,messageId,target.id,session.businessId]);
      await client.query("INSERT INTO messages (id,conversation_id,direction,body,message_type,status,meta_message_id,metadata) VALUES ($1,$2,'outgoing',$3,'interactive','sent',$4,$5)",[id('m'),target.conversation_id,clean(body.message),messageId,JSON.stringify({nativeCheckoutId:reference,orderId:target.id})]);
      await client.query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'native_checkout_sent',JSON.stringify({checkoutId:reference,orderId:target.id,messageId})]);
    });
    return json({ok:true,checkoutId:reference,messageId},201);
  }catch(error){if(error.code==='23505')return errorJson(new AppError('An existing native checkout must be reconciled, not resent.',409,'CHECKOUT_ALREADY_EXISTS'));return errorJson(error);}
}

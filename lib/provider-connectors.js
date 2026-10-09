import crypto from 'node:crypto';
import {isIP} from 'node:net';
import {requireSession} from './auth.js';
import {AppError,query,transaction,id,json,errorJson,enterSystemContext,enterTenantContext} from './db.js';
import {encryptSecret,decryptSecret} from './meta.js';
import {readBodyLimited,readJsonBodyLimited,enforceRequestRateLimit} from './security.js';
import {assertSubscriptionActive,subscriptionUsage} from './limits.js';
import {workspaceFeatureFlags} from './feature-controls.js';

const topics={shopify:['orders/create','orders/updated','orders/paid','orders/cancelled','refunds/create','checkouts/create','checkouts/update','customers/data_request','customers/redact','shop/redact'],woocommerce:['order.created','order.updated']};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const invalid=()=>new AppError('Invalid provider event.',400,'CONNECTOR_EVENT_INVALID');
const owner=session=>{if(session.role!=='Owner')throw new AppError('Only the owner can manage connectors.',403,'FORBIDDEN');};

// Sources are identifiers only. No configured URL or payload URL is fetched.
export function connectorSource(provider,value){
  if(provider==='shopify'&&typeof value==='string'&&/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value)&&value.length<255)return value;
  if(provider==='woocommerce'){
    let url;try{url=new URL(value);}catch{throw invalid();}
    if(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&!url.port&&!isIP(url.hostname)&&url.hostname.includes('.')&&!url.hostname.endsWith('.local')&&url.href.length<1000)return url.href.replace(/\/$/,'');
  }
  throw new AppError('Use a myshopify.com hostname or a public HTTPS WooCommerce store URL.',400,'CONNECTOR_SOURCE_INVALID');
}

export function verifyProviderSignature(raw,signature,secret){
  if(!secret||typeof signature!=='string'||! /^(?:[A-Za-z0-9+/]{43}=)$/.test(signature))return false;
  const supplied=Buffer.from(signature,'base64'),expected=crypto.createHmac('sha256',secret).update(raw).digest();
  return supplied.length===expected.length&&crypto.timingSafeEqual(supplied,expected);
}

function externalId(value){
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>0)return String(value);
  if(typeof value==='string'&&/^[a-zA-Z0-9_-]{1,150}$/.test(value))return value;
  throw invalid();
}

function signedCheckoutUrl(value){
  if(typeof value!=='string'||value.length>2048)return '';
  let url;try{url=new URL(value);}catch{return '';}
  return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!isIP(url.hostname)
    &&url.hostname.includes('.')&&!url.hostname.endsWith('.local')?url.href:'';
}

export function normalizeProviderEvent(provider,topic,body){
  if(!topics[provider]?.includes(topic)||!body||typeof body!=='object'||Array.isArray(body))throw invalid();
  if(provider==='shopify'&&['customers/data_request','customers/redact','shop/redact'].includes(topic)){
    const identifier=topic==='shop/redact'?body.shop_id:body.customer?.id??body.shop_id;
    const orderIds=Array.isArray(body.orders_to_redact)?body.orders_to_redact.map(externalId):[];
    return {resource:'privacy',externalId:externalId(identifier),occurredAt:new Date().toISOString(),privacyTopic:topic,orderIds};
  }
  if(provider==='shopify'&&topic==='refunds/create'){
    const occurredAt=new Date(body.created_at||Date.now());
    if(!Number.isFinite(occurredAt.getTime()))throw invalid();
    return {resource:'order',externalId:externalId(body.order_id),occurredAt:occurredAt.toISOString(),phone:'',amount:'0',currency:'USD',terminal:true,state:'refunded'};
  }
  const checkout=topic.startsWith('checkouts/'),resource=checkout?'checkout':'order';
  const external=externalId(checkout?body.token:body.id);
  const occurred=provider==='shopify'?body.updated_at||body.created_at:(body.date_modified_gmt||body.date_created_gmt);
  const occurredAt=new Date(provider==='woocommerce'&&typeof occurred==='string'&&!/[zZ]|[+-]\d\d:\d\d$/.test(occurred)?occurred+'Z':occurred);
  if(!occurred||!Number.isFinite(occurredAt.getTime())||occurredAt.getTime()>Date.now()+300000)throw invalid();
  const candidate=provider==='shopify'?(body.phone||body.shipping_address?.phone||body.billing_address?.phone):(body.billing?.phone);
  // Require an explicit international number; never guess a country from billing data.
  const phone=typeof candidate==='string'&&/^\+[1-9][0-9 ()-]{7,25}$/.test(candidate)?candidate.replace(/[^0-9]/g,''):'';
  const amount=String(provider==='shopify'?body.total_price??'':body.total??'');
  const currency=body.currency;
  if(!/^\d{1,15}(\.\d{1,6})?$/.test(amount)||typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency))throw invalid();
  const terminal=topic.endsWith('/paid')||topic.endsWith('/cancelled')||!!body.completed_at||!!body.closed_at||!!body.cancelled_at||['completed','cancelled','refunded','failed'].includes(body.status)||['paid','refunded','voided'].includes(body.financial_status);
  return {resource,externalId:external,occurredAt:occurredAt.toISOString(),phone:phone.length<=15?phone:'',amount,currency,terminal,checkoutId:provider==='shopify'&&!checkout&&body.checkout_token?externalId(body.checkout_token):'',checkoutUrl:provider==='shopify'&&checkout?signedCheckoutUrl(body.abandoned_checkout_url):'',state:checkout?(terminal?'closed':'open'):String(body.financial_status||body.status||'unknown').slice(0,40)};
}

export async function providerConnectorSettings(request){
  try{
    const session=await requireSession(request);owner(session);
    if(request.method==='GET'){
      const [connectors,events,flows,candidates]=await Promise.all([
        query(`SELECT c.id,c.name,c.provider,c.source,c.flow_id,c.enabled,c.recovery_enabled,c.recovery_flow_id,c.recovery_after_minutes,c.created_at,
          EXISTS(SELECT 1 FROM availability_connections a WHERE a.business_id=c.business_id AND a.webhook_connector_id=c.id AND a.auth_method='oauth') AS oauth_managed
          FROM provider_connectors c WHERE c.business_id=$1 ORDER BY c.created_at DESC LIMIT 100`,[session.businessId]),
        query('SELECT id,connector_id,topic,status,error_code,session_id,received_at FROM provider_connector_events WHERE business_id=$1 ORDER BY received_at DESC LIMIT 50',[session.businessId]),
        query("SELECT id,name FROM automation_flows WHERE business_id=$1 AND status='active' AND trigger_mode='manual' ORDER BY name LIMIT 200",[session.businessId]),
        query(`SELECT r.connector_id,r.external_id,r.data-'checkoutUrlEncrypted'-'checkoutUrl' AS data,r.occurred_at,r.recovery_status,r.recovery_reason,s.status AS session_status,c.recovery_after_minutes
          FROM provider_connector_records r JOIN provider_connectors c ON c.id=r.connector_id AND c.business_id=r.business_id
          LEFT JOIN automation_sessions s ON s.id=r.recovery_session_id AND s.business_id=r.business_id
          WHERE r.business_id=$1 AND c.enabled AND c.provider='shopify' AND r.resource='checkout'
            AND r.data->>'terminal'='false' AND r.occurred_at<=NOW()-(c.recovery_after_minutes*INTERVAL '1 minute')
            AND NOT EXISTS (SELECT 1 FROM provider_connector_records o WHERE o.business_id=r.business_id AND o.connector_id=r.connector_id
              AND o.resource='order' AND o.data->>'checkoutId'=r.external_id)
          ORDER BY r.occurred_at DESC,r.external_id LIMIT 100`,[session.businessId])
      ]);
      return json({connectors:connectors.rows,events:events.rows,flows:flows.rows,recoveryCandidates:candidates.rows,topics});
    }
    const body=await readJsonBodyLimited(request,8192);
    await assertSubscriptionActive(await subscriptionUsage(session.businessId));
    return await transaction(async client=>{
      let connectorId=body.id;
      if(body.action==='create'){
        const source=connectorSource(body.provider,body.source);
        if(typeof body.name!=='string'||!body.name.trim()||body.name.length>120||typeof body.secret!=='string'||body.secret.length<16||body.secret.length>512||body.secret!==body.secret.trim())throw new AppError('Provide a name and a signing secret of 16 to 512 characters.',400,'CONNECTOR_INVALID');
        if(body.flowId)await connectorWorkflow(client,session.businessId,body.flowId);
        connectorId=id('pc');
        await client.query('INSERT INTO provider_connectors (id,business_id,name,provider,source,secret_encrypted,flow_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',[connectorId,session.businessId,body.name.trim(),body.provider,source,encryptSecret(body.secret),body.flowId||null]);
      }else if(body.action==='toggle'){
        if(typeof body.enabled!=='boolean')throw invalid();
        const result=await client.query(`UPDATE provider_connectors c SET enabled=$1 WHERE c.id=$2 AND c.business_id=$3
          AND ($1=TRUE OR NOT EXISTS(SELECT 1 FROM availability_connections a WHERE a.business_id=c.business_id AND a.webhook_connector_id=c.id AND a.auth_method='oauth')) RETURNING id`,[body.enabled,body.id,session.businessId]);
        if(!result.rowCount)throw new AppError('Connector not found.',404,'NOT_FOUND');
      }else if(body.action==='rotate'){
        if(typeof body.secret!=='string'||body.secret.length<16||body.secret.length>512||body.secret!==body.secret.trim())throw invalid();
        const result=await client.query(`UPDATE provider_connectors c SET secret_encrypted=$1 WHERE c.id=$2 AND c.business_id=$3
          AND NOT EXISTS(SELECT 1 FROM availability_connections a WHERE a.business_id=c.business_id AND a.webhook_connector_id=c.id AND a.auth_method='oauth') RETURNING id`,[encryptSecret(body.secret),body.id,session.businessId]);
        if(!result.rowCount)throw new AppError('Connector not found.',404,'NOT_FOUND');
      }else if(body.action==='recovery_settings'){
        if(!Number.isSafeInteger(body.minutes)||body.minutes<15||body.minutes>10080)throw new AppError('Recovery review must be between 15 minutes and 7 days.',400,'CONNECTOR_RECOVERY_INVALID');
        if(typeof body.enabled!=='boolean'||typeof body.flowId!=='string')throw invalid();
        if(body.enabled){
          const flags=await workspaceFeatureFlags(session.businessId,(sql,params)=>client.query(sql,params));
          if(!flags.checkout_recovery||!flags.connectors||!flags.automation)throw new AppError('Enable checkout recovery, connectors and automation in Super Admin first.',403,'FEATURE_DISABLED');
          if(!body.flowId)throw new AppError('Choose an approved marketing workflow.',400,'CONNECTOR_FLOW_INVALID');
          await connectorWorkflow(client,session.businessId,body.flowId,'MARKETING');
        }else if(body.flowId)await connectorWorkflow(client,session.businessId,body.flowId,'MARKETING');
        const result=await client.query('UPDATE provider_connectors SET recovery_after_minutes=$1,recovery_enabled=$2,recovery_flow_id=$3 WHERE id=$4 AND business_id=$5 AND provider=$6 RETURNING id',[body.minutes,body.enabled,body.flowId||null,body.id,session.businessId,'shopify']);
        if(!result.rowCount)throw new AppError('Shopify connector not found.',404,'NOT_FOUND');
      }else if(body.action==='retry_recovery'){
        const result=await client.query(`UPDATE provider_connector_records SET recovery_status='pending',recovery_reason='',recovery_attempted_at=NULL
          WHERE business_id=$1 AND connector_id=$2 AND resource='checkout' AND external_id=$3 AND recovery_status='skipped'
          AND data->>'terminal'='false' RETURNING external_id`,[session.businessId,body.id,body.checkoutId]);
        if(!result.rowCount)throw new AppError('Skipped open checkout not found.',404,'NOT_FOUND');
      }else throw new AppError('Unsupported connector action.',400,'INVALID_ACTION');
      await client.query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'connector_'+body.action,JSON.stringify({connectorId})]);
      return json({ok:true,id:connectorId},body.action==='create'?201:200);
    });
  }catch(error){return errorJson(error);}
}

export async function receiveProviderEvent(request,{params}){
  try{
    const {connectorId}=await params;
    if(!/^pc_[a-f0-9]{16}$/.test(connectorId||''))throw new AppError('Connector unavailable.',404,'NOT_FOUND');
    enterSystemContext();
    await enforceRequestRateLimit(request,'connector-inbound');
    const connector=(await query("SELECT c.* FROM provider_connectors c JOIN businesses b ON b.id=c.business_id WHERE c.id=$1 AND c.enabled AND b.account_status<>'suspended' AND NOT EXISTS (SELECT 1 FROM workspace_deletion_requests WHERE business_id=c.business_id AND status IN ('scheduled','pending_approval'))",[connectorId])).rows[0];
    if(!connector)throw new AppError('Connector unavailable.',404,'NOT_FOUND');
    enterTenantContext(connector.business_id);
    const raw=await readBodyLimited(request,262144);
    const shop=connector.provider==='shopify';
    if(!verifyProviderSignature(raw,request.headers.get(shop?'x-shopify-hmac-sha256':'x-wc-webhook-signature'),decryptSecret(connector.secret_encrypted)))throw new AppError('Invalid provider signature.',401,'CONNECTOR_UNAUTHORIZED');
    const source=request.headers.get(shop?'x-shopify-shop-domain':'x-wc-webhook-source');
    if(connectorSource(connector.provider,source)!==connector.source)throw new AppError('Provider source mismatch.',401,'CONNECTOR_UNAUTHORIZED');
    let body;try{body=JSON.parse(raw.toString('utf8'));}catch{throw invalid();}
    // WooCommerce's activation ping has no order payload. Authenticate before acknowledging it.
    if(!shop&&body&&Object.keys(body).length===1&&/^\d+$/.test(String(body.webhook_id)))return json({ok:true,ping:true});
    const topic=request.headers.get(shop?'x-shopify-topic':'x-wc-webhook-topic');
    const deliveryId=shop?request.headers.get('x-shopify-event-id')||request.headers.get('x-shopify-webhook-id'):[request.headers.get('x-wc-webhook-id'),request.headers.get('x-wc-webhook-delivery-id')].join(':');
    if(!/^[a-zA-Z0-9:_-]{1,150}$/.test(deliveryId||'')||(!shop&&!/^\d+:\d+$/.test(deliveryId)))throw invalid();
    const data=normalizeProviderEvent(connector.provider,topic,body);
    if(data.checkoutUrl){data.checkoutUrlEncrypted=encryptSecret(data.checkoutUrl);delete data.checkoutUrl;}
    const result=await transaction(async client=>{
      const active=(await client.query('SELECT secret_encrypted FROM provider_connectors WHERE id=$1 AND business_id=$2 AND enabled FOR UPDATE',[connector.id,connector.business_id])).rows[0];
      if(!active||active.secret_encrypted!==connector.secret_encrypted)throw new AppError('Connector credential changed.',401,'CONNECTOR_UNAUTHORIZED');
      const bodyHash=hash(raw);
      const previous=(await client.query('SELECT delivery_id,body_hash FROM provider_connector_events WHERE connector_id=$1 AND business_id=$2 AND (delivery_id=$3 OR body_hash=$4)',[connector.id,connector.business_id,deliveryId,bodyHash])).rows;
      if(previous.some(row=>row.delivery_id===deliveryId&&row.body_hash!==bodyHash))throw new AppError('Delivery ID reused with different data.',409,'CONNECTOR_REPLAY_CONFLICT');
      if(previous.length)return {ok:true,duplicate:true};
      await client.query('INSERT INTO provider_connector_events (id,business_id,connector_id,delivery_id,body_hash,topic,data) VALUES ($1,$2,$3,$4,$5,$6,$7)',[id('pce'),connector.business_id,connector.id,deliveryId,bodyHash,topic,JSON.stringify(data)]);
      return {ok:true,duplicate:false};
    });
    return json(result,result.duplicate?200:202);
  }catch(error){return errorJson(error);}
}

export async function receiveShopifyPrivacyEvent(request){
  try{
    enterSystemContext();
    await enforceRequestRateLimit(request,'connector-inbound');
    const raw=await readBodyLimited(request,262144);
    if(!verifyProviderSignature(raw,request.headers.get('x-shopify-hmac-sha256'),process.env.SHOPIFY_CLIENT_SECRET))throw new AppError('Invalid provider signature.',401,'CONNECTOR_UNAUTHORIZED');
    const source=connectorSource('shopify',request.headers.get('x-shopify-shop-domain'));
    const topic=request.headers.get('x-shopify-topic');
    if(!['customers/data_request','customers/redact','shop/redact'].includes(topic))throw invalid();
    const deliveryId=request.headers.get('x-shopify-event-id')||request.headers.get('x-shopify-webhook-id');
    if(!/^[a-zA-Z0-9:_-]{1,150}$/.test(deliveryId||''))throw invalid();
    let body;try{body=JSON.parse(raw.toString('utf8'));}catch{throw invalid();}
    if(connectorSource('shopify',body.shop_domain)!==source)throw new AppError('Provider source mismatch.',401,'CONNECTOR_UNAUTHORIZED');
    const data=normalizeProviderEvent('shopify',topic,body),bodyHash=hash(raw);
    const connectors=(await query(`SELECT DISTINCT c.id,c.business_id FROM availability_connections a
      JOIN provider_connectors c ON c.id=a.webhook_connector_id AND c.business_id=a.business_id
      WHERE a.provider='shopify' AND a.auth_method='oauth' AND a.source=$1 AND c.provider='shopify' AND c.source=$1`,[source])).rows;
    for(const connector of connectors){
      await query(`INSERT INTO provider_connector_events(id,business_id,connector_id,delivery_id,body_hash,topic,data)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(connector_id,delivery_id) DO NOTHING`,
      [id('pce'),connector.business_id,connector.id,deliveryId,bodyHash,topic,JSON.stringify(data)]);
    }
    return json({ok:true,accepted:connectors.length},202);
  }catch(error){return errorJson(error);}
}

async function connectorWorkflow(client,businessId,flowId,category='UTILITY'){
  const flow=(await client.query("SELECT * FROM automation_flows WHERE id=$1 AND business_id=$2 AND status='active' AND trigger_mode='manual' FOR SHARE",[flowId,businessId])).rows[0];
  const nodes=flow?.definition?.nodes;
  if(!Array.isArray(nodes)||nodes.length>50||!nodes.length)throw new AppError(`Use an active manual ${category.toLowerCase()} workflow.`,400,'CONNECTOR_FLOW_INVALID');
  const visited=new Set();let next=flow.definition.startNodeId,templates=0;
  while(next){
    const node=nodes.find(item=>item.id===next);
    if(!node||visited.has(next)||!['template','end'].includes(node.type)||(node.type==='end'&&(node.body||node.next))||(node.type==='template'&&(node.inputKind!=='none'||!node.next)))throw new AppError('Use a linear template workflow ending in completion.',400,'CONNECTOR_FLOW_INVALID');
    if(node.type==='template'){
      const approved=(await client.query("SELECT id FROM templates WHERE business_id=$1 AND status='Approved' AND category=$4 AND ((id=$2 AND $2<>'') OR (meta_template_name=$3 AND $2=''))",[businessId,node.templateId||'',node.templateName||'',category])).rowCount;
      if(!approved)throw new AppError(`An approved ${category.toLowerCase()} template is required.`,400,'CONNECTOR_FLOW_INVALID');
      templates++;
    }
    visited.add(next);next=node.next||'';
  }
  if((category==='MARKETING'&&templates!==1)||!templates||visited.size!==nodes.length)throw new AppError('Recovery requires one approved marketing template followed by completion.',400,'CONNECTOR_FLOW_INVALID');
  return flow;
}

// Invoke from a trusted system-context worker. Transactions commit inbox state and jobs together.
export async function runProviderConnectorEvents({limit=20,transact=transaction}={}){
  const summary={processed:0,skipped:0};
  for(let index=0;index<Math.min(50,Math.max(1,Number(limit)||20));index++){
    const outcome=await transact(async client=>{
      const event=(await client.query("SELECT e.* FROM provider_connector_events e WHERE e.status='queued' ORDER BY e.received_at,e.id LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];
      if(!event)return null;
      const connector=(await client.query("SELECT c.* FROM provider_connectors c JOIN businesses b ON b.id=c.business_id WHERE c.id=$1 AND c.business_id=$2 AND c.enabled AND b.account_status<>'suspended' AND NOT EXISTS (SELECT 1 FROM workspace_deletion_requests WHERE business_id=c.business_id AND status IN ('scheduled','pending_approval')) FOR UPDATE OF c",[event.connector_id,event.business_id])).rows[0];
      let code='',sessionId=null;
      const data=event.data;
      if(connector?.provider==='shopify'&&data?.resource==='order'&&['orders/updated','orders/paid','refunds/create'].includes(event.topic)){
        const {reconcileShopifyLedgerFromWebhook}=await import('./shopify-drafts.js');
        await reconcileShopifyLedgerFromWebhook(event.business_id,data.externalId).catch(()=>null);
      }
      const features=await workspaceFeatureFlags(event.business_id,(sql,params)=>client.query(sql,params));
      if(connector&&data.resource==='privacy'){
        if(event.topic==='customers/redact'&&data.orderIds?.length){
          await client.query("DELETE FROM provider_connector_records WHERE business_id=$1 AND connector_id=$2 AND resource='order' AND external_id=ANY($3::text[])",[event.business_id,connector.id,data.orderIds]);
          await client.query("UPDATE provider_connector_events SET data=data-'phone' WHERE business_id=$1 AND connector_id=$2 AND data->>'externalId'=ANY($3::text[])",[event.business_id,connector.id,data.orderIds]);
        }
        code='PRIVACY_REQUEST_RECEIVED';
      }
      else if(!features.connectors||!features.automation)code='FEATURE_DISABLED';
      else if(!connector)code='CONNECTOR_DISABLED';
      else{
        const updated=await client.query(`INSERT INTO provider_connector_records (business_id,connector_id,resource,external_id,data,occurred_at) VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (connector_id,resource,external_id) DO UPDATE SET data=EXCLUDED.data,occurred_at=EXCLUDED.occurred_at
          WHERE provider_connector_records.occurred_at<EXCLUDED.occurred_at AND NOT (provider_connector_records.data->>'terminal'='true' AND EXCLUDED.data->>'terminal'='false') RETURNING external_id,dispatched`,[event.business_id,connector.id,data.resource,data.externalId,JSON.stringify(data),data.occurredAt]);
        if(!updated.rowCount)code='STALE_EVENT';
        else if(data.resource==='checkout')code='CHECKOUT_STATE_ONLY';
        else if(updated.rows[0].dispatched)code='ALREADY_DISPATCHED';
        else if(!connector.flow_id||!['orders/create','order.created'].includes(event.topic)||['cancelled','refunded','voided','failed'].includes(data.state))code='STATE_ONLY';
        else{
          // Billing phone and email marketing opt-in are never treated as WhatsApp consent.
          const contacts=(await client.query(`SELECT c.id,v.id AS conversation_id FROM contacts c JOIN conversations v ON v.business_id=c.business_id AND v.contact_id=c.id
            WHERE c.business_id=$1 AND REGEXP_REPLACE(c.phone,'[^0-9]','','g')=$2 AND $2<>'' AND c.unsubscribed=FALSE AND c.opt_in_at IS NOT NULL
            AND c.marketing_permission=TRUE AND EXISTS (SELECT 1 FROM contact_consent_events ce WHERE ce.business_id=c.business_id AND ce.contact_id=c.id AND LENGTH(ce.evidence)>=10 AND ce.source=c.opt_in_source AND ce.occurred_at>=c.opt_in_at)
            AND v.automation_paused=FALSE FOR UPDATE OF c,v`,[event.business_id,data.phone])).rows;
          if(contacts.length!==1)code='CONSENT_OR_CONTACT_UNAVAILABLE';
          else if((await client.query("SELECT 1 FROM automation_sessions WHERE business_id=$1 AND contact_id=$2 AND status IN ('active','handoff')",[event.business_id,contacts[0].id])).rowCount)code='WORKFLOW_ACTIVE';
          else{
            await client.query('SAVEPOINT connector_dispatch');
            try{
              await assertSubscriptionActive(await subscriptionUsage(event.business_id,client));
              const flow=await connectorWorkflow(client,event.business_id,connector.flow_id);
              sessionId=id('fs');
              await client.query('INSERT INTO automation_sessions (id,business_id,contact_id,flow_id,current_node_id,context) VALUES ($1,$2,$3,$4,$5,$6)',[sessionId,event.business_id,contacts[0].id,flow.id,flow.definition.startNodeId,JSON.stringify({providerConnectorId:connector.id,providerEventId:event.id,orderId:data.externalId,orderAmount:data.amount,orderCurrency:data.currency})]);
              await client.query('INSERT INTO automation_jobs (id,business_id,session_id,input) VALUES ($1,$2,$3,$4)',[id('aj'),event.business_id,sessionId,JSON.stringify({phase:'start',conversationId:contacts[0].conversation_id})]);
              await client.query("UPDATE provider_connector_records SET dispatched=TRUE WHERE business_id=$1 AND connector_id=$2 AND resource='order' AND external_id=$3",[event.business_id,connector.id,data.externalId]);
            }catch(error){
              await client.query('ROLLBACK TO SAVEPOINT connector_dispatch');
              if(!error.status||error.status>=500)throw error;
              code=error.code||'DISPATCH_UNAVAILABLE';sessionId=null;
            }
          }
        }
      }
      await client.query('UPDATE provider_connector_events SET status=$1,error_code=$2,session_id=$3 WHERE id=$4 AND business_id=$5',[code?'skipped':'processed',code,sessionId,event.id,event.business_id]);
      return code?'skipped':'processed';
    });
    if(!outcome)break;summary[outcome]++;
  }
  return summary;
}

// A checkout is queued at most once. Rejected candidates remain visible to the owner for correction.
export async function runCheckoutRecovery({limit=20,transact=transaction}={}){
  const flags=await workspaceFeatureFlags();
  const summary={queued:0,skipped:0};
  if(!flags.checkout_recovery||!flags.connectors||!flags.automation)return summary;
  for(let index=0;index<Math.min(50,Math.max(1,Number(limit)||20));index++){
    const outcome=await transact(async client=>{
      const record=(await client.query(`SELECT r.*,c.recovery_flow_id FROM provider_connector_records r
        JOIN provider_connectors c ON c.id=r.connector_id AND c.business_id=r.business_id
        JOIN businesses b ON b.id=r.business_id
        WHERE r.resource='checkout' AND r.recovery_status='pending' AND r.data->>'terminal'='false'
          AND r.occurred_at<=NOW()-(c.recovery_after_minutes*INTERVAL '1 minute')
          AND c.enabled AND c.recovery_enabled AND c.provider='shopify' AND b.account_status<>'suspended'
          AND b.feature_overrides->>'checkout_recovery' IS DISTINCT FROM 'false'
          AND b.feature_overrides->>'connectors' IS DISTINCT FROM 'false'
          AND b.feature_overrides->>'automation' IS DISTINCT FROM 'false'
          AND NOT EXISTS (SELECT 1 FROM workspace_deletion_requests d WHERE d.business_id=r.business_id AND d.status IN ('scheduled','pending_approval'))
        ORDER BY r.occurred_at,r.external_id LIMIT 1 FOR UPDATE OF r SKIP LOCKED`)).rows[0];
      if(!record)return null;
      let reason='',sessionId=null;
      const purchased=(await client.query(`SELECT 1 FROM provider_connector_records o WHERE o.business_id=$1 AND o.connector_id=$2
        AND o.resource='order' AND o.data->>'checkoutId'=$3
        UNION ALL SELECT 1 FROM provider_connector_events e WHERE e.business_id=$1 AND e.connector_id=$2 AND e.status='queued'
        AND ((e.data->>'resource'='order' AND e.data->>'checkoutId'=$3)
          OR (e.data->>'resource'='checkout' AND e.data->>'externalId'=$3 AND e.data->>'terminal'='true')) LIMIT 1`,[record.business_id,record.connector_id,record.external_id])).rowCount;
      if(purchased)reason='ORDER_EXISTS';
      else if(!record.data.phone)reason='PHONE_UNAVAILABLE';
      else if(!record.data.checkoutUrlEncrypted)reason='RECOVERY_URL_UNAVAILABLE';
      else{
        const contacts=(await client.query(`SELECT c.id,v.id AS conversation_id FROM contacts c
          JOIN conversations v ON v.business_id=c.business_id AND v.contact_id=c.id
          WHERE c.business_id=$1 AND REGEXP_REPLACE(c.phone,'[^0-9]','','g')=$2
            AND c.unsubscribed=FALSE AND c.marketing_permission=TRUE AND c.opt_in_at IS NOT NULL
            AND EXISTS (SELECT 1 FROM contact_consent_events ce WHERE ce.business_id=c.business_id AND ce.contact_id=c.id
              AND ce.source=c.opt_in_source AND ce.occurred_at>=c.opt_in_at AND LENGTH(ce.evidence)>=10)
            AND v.automation_paused=FALSE FOR UPDATE OF c,v`,[record.business_id,record.data.phone])).rows;
        if(contacts.length!==1)reason='CONSENT_OR_CONTACT_UNAVAILABLE';
        else if((await client.query("SELECT 1 FROM automation_sessions WHERE business_id=$1 AND contact_id=$2 AND status IN ('active','handoff')",[record.business_id,contacts[0].id])).rowCount)reason='WORKFLOW_ACTIVE';
        else{
          await client.query('SAVEPOINT checkout_recovery');
          try{
            await assertSubscriptionActive(await subscriptionUsage(record.business_id,client));
            const flow=await connectorWorkflow(client,record.business_id,record.recovery_flow_id,'MARKETING');
            sessionId=id('fs');
            await client.query('INSERT INTO automation_sessions (id,business_id,contact_id,flow_id,current_node_id,context) VALUES ($1,$2,$3,$4,$5,$6)',
              [sessionId,record.business_id,contacts[0].id,flow.id,flow.definition.startNodeId,JSON.stringify({providerConnectorId:record.connector_id,providerCheckoutId:record.external_id,checkoutAmount:record.data.amount,checkoutCurrency:record.data.currency})]);
            await client.query('INSERT INTO automation_jobs (id,business_id,session_id,input) VALUES ($1,$2,$3,$4)',
              [id('aj'),record.business_id,sessionId,JSON.stringify({phase:'start',conversationId:contacts[0].conversation_id})]);
          }catch(error){
            await client.query('ROLLBACK TO SAVEPOINT checkout_recovery');
            if(!error.status||error.status>=500)throw error;
            reason=error.code||'RECOVERY_UNAVAILABLE';sessionId=null;
          }
        }
      }
      await client.query(`UPDATE provider_connector_records SET recovery_status=$1,recovery_reason=$2,recovery_session_id=$3,recovery_attempted_at=NOW()
        WHERE business_id=$4 AND connector_id=$5 AND resource='checkout' AND external_id=$6`,
        [reason?'skipped':'queued',reason,sessionId,record.business_id,record.connector_id,record.external_id]);
      return reason?'skipped':'queued';
    });
    if(!outcome)break;
    summary[outcome]++;
  }
  return summary;
}

const calendarText=value=>String(value).replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');
const calendarTime=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
function foldCalendarLine(line){
  const parts=[];let segment='';
  for(const character of line){if(Buffer.byteLength(segment+character)>75){parts.push(segment);segment=' ';}segment+=character;}
  parts.push(segment);return parts.join('\r\n');
}
export function providerCalendar(records){
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//WhatsApp Growth Desk//Provider orders//EN','CALSCALE:GREGORIAN'];
  for(const record of records){
    lines.push('BEGIN:VEVENT','UID:'+hash(record.connector_id+':'+record.external_id)+'@provider-connectors','DTSTAMP:'+calendarTime(record.occurred_at),'DTSTART:'+calendarTime(record.occurred_at),'SUMMARY:'+calendarText('Order '+record.external_id),'DESCRIPTION:'+calendarText(record.data.amount+' '+record.data.currency),'END:VEVENT');
  }
  return lines.concat('END:VCALENDAR').map(foldCalendarLine).join('\r\n')+'\r\n';
}
export async function providerConnectorCalendar(request){
  try{
    const session=await requireSession(request);owner(session);
    const records=(await query("SELECT connector_id,external_id,data,occurred_at FROM provider_connector_records WHERE business_id=$1 AND resource='order' ORDER BY occurred_at DESC LIMIT 500",[session.businessId])).rows;
    return new Response(providerCalendar(records),{headers:{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'attachment; filename="provider-orders.ics"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }catch(error){return errorJson(error);}
}

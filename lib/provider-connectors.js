import crypto from 'node:crypto';
import {isIP} from 'node:net';
import {requireSession} from './auth.js';
import {AppError,query,transaction,id,json,errorJson,enterSystemContext,enterTenantContext} from './db.js';
import {encryptSecret,decryptSecret} from './meta.js';
import {readBodyLimited,readJsonBodyLimited,enforceRequestRateLimit} from './security.js';
import {assertSubscriptionActive,subscriptionUsage} from './limits.js';

const topics={shopify:['orders/create','orders/updated','orders/paid','orders/cancelled','checkouts/create','checkouts/update'],woocommerce:['order.created','order.updated']};
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

export function normalizeProviderEvent(provider,topic,body){
  if(!topics[provider]?.includes(topic)||!body||typeof body!=='object'||Array.isArray(body))throw invalid();
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
  return {resource,externalId:external,occurredAt:occurredAt.toISOString(),phone:phone.length<=15?phone:'',amount,currency,terminal,checkoutId:provider==='shopify'&&body.checkout_id?externalId(body.checkout_id):'',state:checkout?(terminal?'closed':'open'):String(body.financial_status||body.status||'unknown').slice(0,40)};
}

export async function providerConnectorSettings(request){
  try{
    const session=await requireSession(request);owner(session);
    if(request.method==='GET')return json({connectors:(await query('SELECT id,name,provider,source,flow_id,enabled,created_at FROM provider_connectors WHERE business_id=$1 ORDER BY created_at DESC LIMIT 100',[session.businessId])).rows,events:(await query('SELECT id,connector_id,topic,status,error_code,session_id,received_at FROM provider_connector_events WHERE business_id=$1 ORDER BY received_at DESC LIMIT 50',[session.businessId])).rows,flows:(await query("SELECT id,name FROM automation_flows WHERE business_id=$1 AND status='active' AND trigger_mode='manual' ORDER BY name",[session.businessId])).rows,topics});
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
        const result=await client.query('UPDATE provider_connectors SET enabled=$1 WHERE id=$2 AND business_id=$3 RETURNING id',[body.enabled,body.id,session.businessId]);
        if(!result.rowCount)throw new AppError('Connector not found.',404,'NOT_FOUND');
      }else if(body.action==='rotate'){
        if(typeof body.secret!=='string'||body.secret.length<16||body.secret.length>512||body.secret!==body.secret.trim())throw invalid();
        const result=await client.query('UPDATE provider_connectors SET secret_encrypted=$1 WHERE id=$2 AND business_id=$3 RETURNING id',[encryptSecret(body.secret),body.id,session.businessId]);
        if(!result.rowCount)throw new AppError('Connector not found.',404,'NOT_FOUND');
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

async function connectorWorkflow(client,businessId,flowId){
  const flow=(await client.query("SELECT * FROM automation_flows WHERE id=$1 AND business_id=$2 AND status='active' AND trigger_mode='manual' FOR SHARE",[flowId,businessId])).rows[0];
  const nodes=flow?.definition?.nodes;
  if(!Array.isArray(nodes)||nodes.length>50||!nodes.length)throw new AppError('Use an active manual utility workflow.',400,'CONNECTOR_FLOW_INVALID');
  const visited=new Set();let next=flow.definition.startNodeId,templates=0;
  while(next){
    const node=nodes.find(item=>item.id===next);
    if(!node||visited.has(next)||!['template','end'].includes(node.type)||(node.type==='end'&&(node.body||node.next))||(node.type==='template'&&(node.inputKind!=='none'||!node.next)))throw new AppError('Use a linear utility template workflow ending in completion.',400,'CONNECTOR_FLOW_INVALID');
    if(node.type==='template'){
      const approved=(await client.query("SELECT id FROM templates WHERE business_id=$1 AND status='Approved' AND category='UTILITY' AND ((id=$2 AND $2<>'') OR (meta_template_name=$3 AND $2=''))",[businessId,node.templateId||'',node.templateName||''])).rowCount;
      if(!approved)throw new AppError('An approved utility template is required.',400,'CONNECTOR_FLOW_INVALID');
      templates++;
    }
    visited.add(next);next=node.next||'';
  }
  if(!templates||visited.size!==nodes.length)throw new AppError('Every workflow node must be reachable.',400,'CONNECTOR_FLOW_INVALID');
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
      if(!connector)code='CONNECTOR_DISABLED';
      else{
        const data=event.data;
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

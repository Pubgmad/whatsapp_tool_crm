import crypto from 'node:crypto';
import { AppError, id, query, transaction } from './db.js';
import {liveAvailableFor} from './external-availability.js';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const actions = ['list', 'reserve', 'confirm', 'cancel'];
const invalid = (message = 'Invalid Flow runtime request.', status = 400) => { throw new AppError(message, status, 'FLOW_RUNTIME_INVALID'); };
const object = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) invalid();
}
function text(value, max = 128) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) invalid();
  return value;
}
const screenName = value => { if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]{0,79}$/.test(value) || value === 'SUCCESS') invalid('Invalid runtime screen.'); return value; };

export function availableCapacity(capacity,localAvailable,externalAvailable){
  if(externalAvailable===null)return Math.max(0,Number(localAvailable));
  return Math.max(0,Math.min(Number(localAvailable),Number(externalAvailable)-(Number(capacity)-Number(localAvailable))));
}

export function isManagedRuntimeEndpoint(flow, appUrl = process.env.APP_URL) {
  try {
    const endpoint=new URL(flow.endpoint_uri),app=new URL(appUrl);
    return endpoint.protocol==='https:' && endpoint.origin===app.origin && endpoint.pathname==='/api/whatsapp/flows/runtime/data/'+encodeURIComponent(flow.id) && !endpoint.search && !endpoint.hash;
  } catch { return false; }
}

export function validateRuntimeConfig(value, flowJson) {
  keys(value, ['enabled','mode','resourceIds','initialScreen','reviewScreen','allowedActions','holdMinutes','reviewRoutes']);
  if (typeof value.enabled !== 'boolean' || !['booking','order'].includes(value.mode) || !Array.isArray(value.resourceIds) || value.resourceIds.length < 1 || value.resourceIds.length > 100) invalid('Select runtime resources and mode.');
  value.resourceIds.forEach(item => text(item));
  if (new Set(value.resourceIds).size !== value.resourceIds.length || !Array.isArray(value.allowedActions) || new Set(value.allowedActions).size !== value.allowedActions.length || value.allowedActions.some(action => !actions.includes(action)) || !value.allowedActions.includes('list')) invalid('Invalid allowed runtime actions.');
  const initialScreen = screenName(value.initialScreen), reviewScreen = screenName(value.reviewScreen);
  if (initialScreen === reviewScreen || !Number.isInteger(value.holdMinutes) || value.holdMinutes < 1 || value.holdMinutes > 30 || value.allowedActions.includes('confirm') && !value.allowedActions.includes('reserve')) invalid('Invalid runtime configuration.');
  if (flowJson && (!['3.0'].includes(flowJson.data_api_version) || ![initialScreen,reviewScreen].every(name => flowJson.screens?.some(screen => screen.id === name)))) invalid('Upload Data API 3.0 screens before configuring the runtime.');
  const reviewRoutes=value.reviewRoutes??[];
  if(!Array.isArray(reviewRoutes)||reviewRoutes.length>100)invalid('Invalid conditional review routes.');
  const seen=new Set();
  for(const rule of reviewRoutes){
    keys(rule,['resourceId','minQuantity','targetScreen']);
    text(rule.resourceId);screenName(rule.targetScreen);
    if(!value.resourceIds.includes(rule.resourceId)||!Number.isInteger(rule.minQuantity)||rule.minQuantity<1||rule.minQuantity>1000||rule.targetScreen===initialScreen)invalid('Invalid conditional review route.');
    const key=`${rule.resourceId}:${rule.minQuantity}`;
    if(seen.has(key))invalid('Conditional review thresholds must be unique per resource.');
    seen.add(key);
    if(flowJson&&(!flowJson.screens?.some(screen=>screen.id===rule.targetScreen)||!flowJson.routing_model?.[initialScreen]?.includes(rule.targetScreen)
      ||value.allowedActions.includes('cancel')&&!flowJson.routing_model?.[rule.targetScreen]?.includes(initialScreen)))
      invalid('The published Flow must allow navigation to every conditional review screen.');
  }
  return { ...value, resourceIds: [...value.resourceIds], allowedActions: [...value.allowedActions],reviewRoutes:reviewRoutes.map(rule=>({...rule})) };
}

export function selectReviewScreen(config,resourceId,quantity){
  const rule=(config.reviewRoutes||[]).filter(item=>item.resourceId===resourceId&&quantity>=item.minQuantity)
    .sort((a,b)=>b.minQuantity-a.minQuantity)[0];
  return rule?.targetScreen||config.reviewScreen;
}

export function validateRuntimeResource(value) {
  keys(value, ['id','kind','title','capacity','enabled','startsAt','endsAt','catalogId','retailerId','unitPrice','currency']);
  const resourceId = value.id === undefined ? id('frr') : text(value.id);
  text(value.title,80);
  if (!['slot','product'].includes(value.kind) || typeof value.enabled !== 'boolean' || !Number.isInteger(value.capacity) || value.capacity < 0 || value.capacity > 1000000 || typeof value.unitPrice !== 'string' || !/^\d{1,12}(?:\.\d{1,6})?$/.test(value.unitPrice) || !/^[A-Z]{3}$/.test(value.currency || '')) invalid('Invalid inventory resource.');
  let startsAt = null, endsAt = null;
  if (value.kind === 'slot') {
    const date = input => typeof input === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(input) && Number.isFinite(Date.parse(input));
    if (!date(value.startsAt) || !date(value.endsAt) || Date.parse(value.endsAt) <= Date.parse(value.startsAt) || value.catalogId || value.retailerId) invalid('Provide a dated booking slot with an explicit timezone.');
    startsAt = value.startsAt; endsAt = value.endsAt;
  } else if (value.startsAt || value.endsAt || !/^\d{1,32}$/.test(value.catalogId || '')) invalid('Provide the real catalog and retailer IDs.');
  if (value.kind === 'product') text(value.retailerId,256);
  return { ...value, id: resourceId, startsAt, endsAt, catalogId: value.catalogId || '', retailerId: value.retailerId || '' };
}

export function validateRuntimePayload(payload) {
  keys(payload, ['version','action','screen','data','flow_token']);
  if (payload.version !== '3.0' || !['ping','INIT','BACK','data_exchange'].includes(payload.action)) invalid('Unsupported Flow Data API action or version.');
  if (payload.action === 'ping') { if (payload.data !== undefined) keys(payload.data, []); return payload; }
  if (!/^[a-f0-9]{64}$/.test(payload.flow_token || '')) invalid('This Flow session is unavailable.',427);
  if (payload.action !== 'INIT') screenName(payload.screen);
  const data = payload.data || {};
  if (Object.hasOwn(data,'error')) {
    keys(data, ['error','error_message']); text(data.error,256);
    if (data.error_message !== undefined) text(data.error_message,1000);
    return payload;
  }
  if (payload.action !== 'data_exchange') keys(data, []);
  else {
    keys(data, ['operation','resource_id','quantity','request_id']);
    if (!actions.includes(data.operation)) invalid('Runtime action is not allowed.');
    const fields = data.operation === 'list' ? ['operation'] : data.operation === 'reserve' ? ['operation','resource_id','quantity','request_id'] : ['operation','request_id'];
    keys(data, fields);
    if (data.operation !== 'list' && !/^[A-Za-z0-9_-]{16,80}$/.test(data.request_id || '')) invalid('Provide a stable request ID.');
    if (data.operation === 'reserve') {
      text(data.resource_id);
      if (!Number.isInteger(data.quantity) || data.quantity < 1 || data.quantity > 1000) invalid('Invalid reservation quantity.');
    }
  }
  return payload;
}

export async function saveRuntimeConfig(businessId, flowId, config, transact = transaction) {
  return transact(async client => {
    const flow = (await client.query('SELECT * FROM whatsapp_native_flows WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,text(flowId)])).rows[0];
    if (!flow?.endpoint_phone_id) invalid('Configure a managed encrypted endpoint first.',409);
    if (!isManagedRuntimeEndpoint(flow)) invalid('Use this Flow\'s managed encrypted endpoint.',409);
    const validated = validateRuntimeConfig(config, flow.flow_json);
    const resources = (await client.query('SELECT id,kind FROM flow_runtime_resources WHERE business_id=$1 AND id=ANY($2::text[]) FOR SHARE',[businessId,validated.resourceIds])).rows;
    if (resources.length !== validated.resourceIds.length || resources.some(resource => resource.kind !== (validated.mode === 'order' ? 'product' : 'slot'))) invalid('Resources must belong to this workspace and match the runtime mode.');
    await client.query(`INSERT INTO flow_runtime_configs(flow_id,business_id,config) VALUES($1,$2,$3)
      ON CONFLICT(flow_id) DO UPDATE SET config=EXCLUDED.config,revision=flow_runtime_configs.revision+1`,[flowId,businessId,JSON.stringify(validated)]);
    return validated;
  });
}

export async function saveRuntimeResource(businessId, input, transact = transaction) {
  const resource = validateRuntimeResource(input);
  return transact(async client => {
    const existing = (await client.query('SELECT * FROM flow_runtime_resources WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,resource.id])).rows[0];
    if (existing && (existing.kind !== resource.kind || existing.catalog_id !== resource.catalogId || existing.retailer_id !== resource.retailerId || String(existing.starts_at ? new Date(existing.starts_at).toISOString() : '') !== String(resource.startsAt ? new Date(resource.startsAt).toISOString() : '') || String(existing.ends_at ? new Date(existing.ends_at).toISOString() : '') !== String(resource.endsAt ? new Date(resource.endsAt).toISOString() : ''))) invalid('Resource identity and slot times are immutable. Create a new resource.',409);
    const used = Number((await client.query("SELECT COALESCE(SUM(quantity),0) AS used FROM flow_runtime_reservations WHERE business_id=$1 AND resource_id=$2 AND (status IN ('confirmed','pending_external','cancel_pending') OR status='held' AND expires_at>NOW())",[businessId,resource.id])).rows[0].used);
    if (resource.capacity < used) invalid('Capacity cannot be below existing reservations.',409);
    if(existing&&resource.capacity!==1){
      const calendarWrite=await client.query('SELECT 1 FROM availability_mappings WHERE business_id=$1 AND resource_id=$2 AND write_enabled LIMIT 1',[businessId,resource.id]);
      if(calendarWrite.rowCount)invalid('Calendar-backed booking slots must have capacity one.',409);
    }
    if (existing) await client.query('UPDATE flow_runtime_resources SET title=$1,capacity=$2,enabled=$3,unit_price=$4,currency=$5 WHERE business_id=$6 AND id=$7',[resource.title,resource.capacity,resource.enabled,resource.unitPrice,resource.currency,businessId,resource.id]);
    else await client.query(`INSERT INTO flow_runtime_resources(id,business_id,kind,title,capacity,enabled,starts_at,ends_at,catalog_id,retailer_id,unit_price,currency)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[resource.id,businessId,resource.kind,resource.title,resource.capacity,resource.enabled,resource.startsAt,resource.endsAt,resource.catalogId,resource.retailerId,resource.unitPrice,resource.currency]);
    return resource;
  });
}

// Call before sending a Flow. The raw bearer token is returned once and never stored.
export async function createRuntimeSession({ businessId, flowId, contactId, phoneId, expiresMinutes = 60, flowToken }, transact = transaction) {
  if (!Number.isInteger(expiresMinutes) || expiresMinutes < 1 || expiresMinutes > 1440) invalid('Invalid session expiry.');
  const token = flowToken === undefined ? crypto.randomBytes(32).toString('hex') : flowToken;
  if (!/^[a-f0-9]{64}$/.test(token || '')) invalid('Invalid session token.');
  return transact(async client => {
    const row = (await client.query(`SELECT c.*,f.endpoint_phone_id FROM flow_runtime_configs c
      JOIN whatsapp_native_flows f ON f.id=c.flow_id AND f.business_id=c.business_id
      JOIN whatsapp_phone_numbers p ON p.id=f.endpoint_phone_id AND p.business_id=f.business_id AND p.whatsapp_account_id=f.whatsapp_account_id
      JOIN contacts t ON t.id=$3 AND t.business_id=f.business_id
      WHERE c.business_id=$1 AND c.flow_id=$2 AND p.id=$4 AND NOT t.unsubscribed FOR SHARE OF c,f,p,t`,[businessId,text(flowId),text(contactId),text(phoneId)])).rows[0];
    if (!row?.config?.enabled) invalid('This runtime is unavailable.',409);
    validateRuntimeConfig(row.config);
    const sessionId = id('frs');
    await client.query(`INSERT INTO flow_runtime_sessions(id,business_id,flow_id,phone_id,contact_id,token_hash,revision,screen,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW()+$9*INTERVAL '1 minute')`,[sessionId,businessId,flowId,phoneId,contactId,hash(token),row.revision,row.config.initialScreen,expiresMinutes]);
    return { sessionId, flowToken: token };
  });
}

export async function provisionRuntimeInvite(client, {businessId, flow, contactId, phoneId, flowToken, expiresHours}) {
  const config = (await client.query('SELECT config FROM flow_runtime_configs WHERE business_id=$1 AND flow_id=$2 FOR SHARE',[businessId,flow.id])).rows[0]?.config;
  const managedEndpoint = isManagedRuntimeEndpoint(flow);
  if (!managedEndpoint && !config?.enabled) return null;
  if (!managedEndpoint || !config?.enabled) invalid('Enable the managed Flow runtime and its encrypted endpoint before sending.',409);
  if (expiresHours > 24) invalid('Managed Flow invitations cannot outlive their 24-hour runtime session.',400);
  const session=await createRuntimeSession({businessId,flowId:flow.id,contactId,phoneId,flowToken,expiresMinutes:expiresHours*60},async work=>work(client));
  return {...session,initialScreen:config.initialScreen};
}

async function listResources(client, businessId, config) {
  const rows = (await client.query(`SELECT r.*,r.capacity-COALESCE((SELECT SUM(v.quantity) FROM flow_runtime_reservations v
    WHERE v.business_id=r.business_id AND v.resource_id=r.id AND (v.status IN ('confirmed','pending_external','cancel_pending') OR v.status='held' AND v.expires_at>NOW())),0) AS available
    FROM flow_runtime_resources r WHERE r.business_id=$1 AND r.id=ANY($2::text[]) AND r.enabled
    AND (r.starts_at IS NULL OR r.starts_at>NOW()) ORDER BY r.starts_at NULLS LAST,r.title,r.id LIMIT 100`,[businessId,config.resourceIds])).rows;
  const verified=[];
  for (let offset=0;offset<rows.length;offset+=5) {
    const batch=rows.slice(offset,offset+5);
    const availability=await Promise.all(batch.map(async row=>{
      const local=Number(row.available);
      if(local<=0)return null;
      const external=await liveAvailableFor(client,businessId,row);
      const available=availableCapacity(row.capacity,local,external);
      return available>0 ? {id:row.id,title:row.title,available,unit_price:row.unit_price,currency:row.currency,...(row.starts_at ? {starts_at:new Date(row.starts_at).toISOString(),ends_at:new Date(row.ends_at).toISOString()} : {})} : null;
    }));
    verified.push(...availability.filter(Boolean));
  }
  return verified;
}

export async function handleRuntimeExchange({ businessId, flowId, payload }, transact = transaction) {
  validateRuntimePayload(payload);
  if (payload.action === 'ping') return { data: { status:'active' } };
  return transact(async client => {
    const configRow = (await client.query('SELECT * FROM flow_runtime_configs WHERE business_id=$1 AND flow_id=$2 FOR SHARE',[businessId,flowId])).rows[0];
    if (!configRow?.config?.enabled) invalid('This Flow session is unavailable.',427);
    const config = validateRuntimeConfig(configRow.config);
    const session = (await client.query(`SELECT s.*,t.phone AS customer_phone FROM flow_runtime_sessions s
      JOIN whatsapp_native_flows f ON f.id=s.flow_id AND f.business_id=s.business_id AND f.endpoint_phone_id=s.phone_id
      JOIN whatsapp_phone_numbers p ON p.id=s.phone_id AND p.business_id=s.business_id AND p.whatsapp_account_id=f.whatsapp_account_id
      JOIN contacts t ON t.id=s.contact_id AND t.business_id=s.business_id AND NOT t.unsubscribed
      WHERE s.business_id=$1 AND s.flow_id=$2 AND s.token_hash=$3 AND s.expires_at>NOW() AND s.revision=$4 FOR UPDATE OF s`,[businessId,flowId,hash(payload.flow_token),configRow.revision])).rows[0];
    if (!session) invalid('This Flow session has expired or is unavailable.',427);
    if (!(await client.query('SELECT 1 WHERE $1::timestamptz>clock_timestamp()',[session.expires_at])).rowCount) invalid('This Flow session has expired.',427);
    if (payload.data?.error) return { data: { acknowledged:true } };
    const data = payload.data || {}, operation = payload.action === 'data_exchange' ? data.operation : 'list';
    if (!config.allowedActions.includes(operation)) invalid('Runtime action is not allowed.',403);
    const fingerprint = hash(JSON.stringify([payload.action,payload.screen || '',operation,data.resource_id || '',data.quantity ?? null]));
    if (data.request_id) {
      const previous = (await client.query('SELECT * FROM flow_runtime_requests WHERE business_id=$1 AND session_id=$2 AND request_id=$3',[businessId,session.id,data.request_id])).rows[0];
      if (previous) { if (previous.fingerprint !== fingerprint) invalid('Request ID was already used for a different action.',409); return previous.response; }
    }
    if (session.completed) invalid('This Flow session is complete.',427);
    if (payload.action !== 'INIT' && payload.screen !== session.screen || payload.action === 'INIT' && session.screen !== config.initialScreen) invalid('This Flow screen is no longer current.',409);
    await client.query("UPDATE flow_runtime_reservations SET status='expired' WHERE business_id=$1 AND session_id=$2 AND status='held' AND expires_at<=NOW()",[businessId,session.id]);
    let response;
    if (operation === 'list') {
      if (payload.action === 'BACK' && [config.reviewScreen,...config.reviewRoutes.map(rule=>rule.targetScreen)].includes(session.screen)) invalid('Cancel the reservation before returning.',409);
      response = {screen:session.screen,data:{resources:await listResources(client,businessId,config)}};
    } else if (operation === 'reserve') {
      if (session.screen !== config.initialScreen || !config.resourceIds.includes(data.resource_id)) invalid('Select an allowed resource on the initial screen.');
      const resource = (await client.query(`SELECT * FROM flow_runtime_resources WHERE business_id=$1 AND id=$2 AND enabled
        AND (starts_at IS NULL OR starts_at>NOW()) FOR UPDATE`,[businessId,data.resource_id])).rows[0];
      if (!resource || resource.kind !== (config.mode === 'order' ? 'product' : 'slot')) invalid('This resource is unavailable.',409);
      const used = Number((await client.query("SELECT COALESCE(SUM(quantity),0) AS used FROM flow_runtime_reservations WHERE business_id=$1 AND resource_id=$2 AND (status IN ('confirmed','pending_external','cancel_pending') OR status='held' AND expires_at>NOW())",[businessId,resource.id])).rows[0].used);
      if (used + data.quantity > resource.capacity) invalid('The requested quantity is no longer available.',409);
      const external=await liveAvailableFor(client,businessId,resource);
      if(external!==null&&used+data.quantity>external)invalid('External availability has changed. Choose another resource.',409);
      const snapshot = {title:resource.title,unit_price:resource.unit_price,currency:resource.currency,catalog_id:resource.catalog_id,retailer_id:resource.retailer_id,starts_at:resource.starts_at,ends_at:resource.ends_at};
      const reservation = (await client.query(`INSERT INTO flow_runtime_reservations(id,business_id,session_id,resource_id,quantity,snapshot,status,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,'held',LEAST($7::timestamptz,NOW()+$8*INTERVAL '1 minute',COALESCE($9::timestamptz,'infinity'::timestamptz))) RETURNING id,expires_at`,[id('frv'),businessId,session.id,resource.id,data.quantity,JSON.stringify(snapshot),session.expires_at,config.holdMinutes,resource.starts_at])).rows[0];
      response = {screen:selectReviewScreen(config,resource.id,data.quantity),data:{reservation_id:reservation.id,quantity:data.quantity,...snapshot,expires_at:new Date(reservation.expires_at).toISOString()}};
    } else {
      if (![config.reviewScreen,...config.reviewRoutes.map(rule=>rule.targetScreen)].includes(session.screen)) invalid('Reservation review is required.',409);
      const reservation = (await client.query("SELECT * FROM flow_runtime_reservations WHERE business_id=$1 AND session_id=$2 AND status='held' FOR UPDATE",[businessId,session.id])).rows[0];
      if(reservation&&session.screen!==selectReviewScreen(config,reservation.resource_id,reservation.quantity))invalid('This reservation belongs to a different review screen.',409);
      if (!reservation) {
        if (operation !== 'cancel') invalid('The reservation has expired. Cancel and select again.',409);
      } else {
        const resource = (await client.query('SELECT * FROM flow_runtime_resources WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,reservation.resource_id])).rows[0];
        if (operation === 'confirm') {
          if (!resource?.enabled) invalid('This resource is unavailable.',409);
          const external=await liveAvailableFor(client,businessId,resource);
          if(external!==null){
            const used=Number((await client.query("SELECT COALESCE(SUM(quantity),0) AS used FROM flow_runtime_reservations WHERE business_id=$1 AND resource_id=$2 AND (status IN ('confirmed','pending_external','cancel_pending') OR status='held' AND expires_at>NOW())",[businessId,resource.id])).rows[0].used);
            if(used>external)invalid('External availability has changed. Cancel this reservation.',409);
          }
          // Transaction NOW() can predate a lock wait; confirm against the wall clock.
          if (!(await client.query('SELECT 1 WHERE $1::timestamptz>clock_timestamp() AND $2::timestamptz>clock_timestamp()',[reservation.expires_at,session.expires_at])).rowCount) invalid('The reservation has expired. Cancel and select again.',409);
          let orderId = null;
          if (config.mode === 'order') {
            orderId = id('wo'); const item = reservation.snapshot;
            if (!/^\d{5,20}$/.test(session.customer_phone || '')) invalid('The customer phone is invalid.',409);
            await client.query(`INSERT INTO whatsapp_orders(id,business_id,phone_id,source_message_id,customer_phone,catalog_id,items,currency,total_amount)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric*$10::integer)`,[orderId,businessId,session.phone_id,`flow:${session.id}`,session.customer_phone,item.catalog_id,JSON.stringify([{retailerId:item.retailer_id,quantity:reservation.quantity,price:item.unit_price,currency:item.currency}]),item.currency,item.unit_price,reservation.quantity]);
          }
          const writeMapping=config.mode==='booking'?(await client.query(`SELECT m.connection_id,m.external_id,c.granted_scopes FROM availability_mappings m
            JOIN availability_connections c ON c.id=m.connection_id AND c.business_id=m.business_id AND c.enabled
            WHERE m.business_id=$1 AND m.resource_id=$2 AND m.write_enabled FOR SHARE OF m,c`,[businessId,reservation.resource_id])).rows[0]:null;
          if(writeMapping&&!writeMapping.granted_scopes?.includes('https://www.googleapis.com/auth/calendar.events'))invalid('Reconnect Google Calendar with booking access.',409);
          const pendingExternal=Boolean(writeMapping);
          if(pendingExternal){
            const eventId=crypto.createHash('sha256').update(`${businessId}:${reservation.id}`).digest('hex');
            await client.query(`INSERT INTO availability_fulfillments(reservation_id,business_id,connection_id,provider,external_target,external_id,status)
              VALUES($1,$2,$3,'google_calendar',$4,$5,'pending')`,[reservation.id,businessId,writeMapping.connection_id,writeMapping.external_id,eventId]);
          }
          await client.query("UPDATE flow_runtime_reservations SET status=$1,order_id=$2 WHERE business_id=$3 AND id=$4",[pendingExternal?'pending_external':'confirmed',orderId,businessId,reservation.id]);
          await client.query('UPDATE flow_runtime_sessions SET completed=TRUE WHERE business_id=$1 AND id=$2',[businessId,session.id]);
          await client.query('INSERT INTO events(id,business_id,type,contact_id,metadata) VALUES($1,$2,$3,$4,$5)',[id('e'),businessId,pendingExternal?'whatsapp_flow_booking_pending':orderId ? 'whatsapp_order_received' : 'whatsapp_flow_booking_confirmed',session.contact_id,JSON.stringify({flowId,sessionId:session.id,reservationId:reservation.id,orderId,status:pendingExternal?'pending_external':'confirmed'})]);
          response = {screen:'SUCCESS',data:{fulfillment_status:pendingExternal?'pending_external':'confirmed',extension_message_response:{params:{flow_token:payload.flow_token,reservation_id:reservation.id,...(orderId ? {order_id:orderId} : {})}}}};
        } else await client.query("UPDATE flow_runtime_reservations SET status='cancelled' WHERE business_id=$1 AND id=$2",[businessId,reservation.id]);
      }
      if (operation === 'cancel') response = {screen:config.initialScreen,data:{resources:await listResources(client,businessId,config)}};
    }
    await client.query('UPDATE flow_runtime_sessions SET screen=$1 WHERE business_id=$2 AND id=$3',[response.screen,businessId,session.id]);
    try{
      const {recordFlowScreenView,flowSessionKey}=await import('./flow-screen-analytics.js');
      const sessionKey=flowSessionKey(payload.flow_token);
      if(sessionKey){
        await recordFlowScreenView({businessId,flowId,sessionId:sessionKey,screenId:response.screen,completed:response.screen==='SUCCESS'});
        if(payload.screen&&payload.screen!==response.screen){
          if(response.screen!=='SUCCESS')await recordFlowScreenView({businessId,flowId,sessionId:sessionKey,screenId:payload.screen,abandoned:true});
          else await recordFlowScreenView({businessId,flowId,sessionId:sessionKey,screenId:payload.screen});
        }
      }
    }catch{}
    if (data.request_id) await client.query('INSERT INTO flow_runtime_requests(business_id,session_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4,$5)',[businessId,session.id,data.request_id,fingerprint,JSON.stringify(response)]);
    return response;
  });
}

export async function getRuntimeSettings(businessId, flowId, execute = query) {
  text(flowId);
  const flow = (await execute('SELECT id FROM whatsapp_native_flows WHERE business_id=$1 AND id=$2',[businessId,flowId])).rows[0];
  if (!flow) invalid('Flow not found.',404);
  const config = (await execute('SELECT config,revision FROM flow_runtime_configs WHERE business_id=$1 AND flow_id=$2',[businessId,flowId])).rows[0];
  const resources = (await execute('SELECT * FROM flow_runtime_resources WHERE business_id=$1 ORDER BY title,id LIMIT 100',[businessId])).rows;
  const reservations = (await execute(`SELECT r.id,r.resource_id,r.quantity,r.status,r.expires_at,r.order_id,f.status AS fulfillment_status,f.last_error,f.external_id AS calendar_event_id,d.status AS shopify_draft_status,d.draft_id AS shopify_draft_id,d.shopify_order_id,d.shopify_order_status,d.shopify_financial_status,d.shopify_total_amount,d.shopify_currency,d.shopify_checked_at,d.last_error AS shopify_issue,ps.state AS shopify_payment_state,ps.received_amount AS shopify_received_amount,ps.refunded_amount AS shopify_refunded_amount,ps.verified_at AS shopify_payment_verified_at FROM flow_runtime_reservations r
    JOIN flow_runtime_sessions s ON s.id=r.session_id AND s.business_id=r.business_id
    LEFT JOIN availability_fulfillments f ON f.reservation_id=r.id AND f.business_id=r.business_id
    LEFT JOIN shopify_draft_intents d ON d.order_id=r.order_id AND d.business_id=r.business_id
    LEFT JOIN shopify_order_settlements ps ON ps.order_id=r.order_id AND ps.business_id=r.business_id
    WHERE s.business_id=$1 AND s.flow_id=$2 ORDER BY r.created_at DESC LIMIT 50`,[businessId,flowId])).rows;
  return {config:config?.config || null,revision:config?.revision || null,resources,reservations};
}

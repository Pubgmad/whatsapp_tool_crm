import crypto from 'node:crypto';
import {requireSession} from './auth.js';
import {AppError,query,transaction,id,json,errorJson} from './db.js';
import {encryptSecret,decryptSecret} from './meta.js';
import {readJsonBodyLimited,readTextBodyLimited} from './security.js';
import {assertWorkspaceFeature,workspaceFeatureFlags} from './feature-controls.js';
import {connectorSource} from './provider-connectors.js';
import {createShopifyDraftForOrder,reconcileShopifyDraftForOrder,reconcileShopifyOrderForDraft} from './shopify-drafts.js';
import {shopifyAccessToken,shopifyOAuthConfigured} from './shopify-auth.js';

const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
export const codeChallenge=verifier=>crypto.createHash('sha256').update(verifier).digest('base64url');
export const GOOGLE_FREEBUSY_SCOPE='https://www.googleapis.com/auth/calendar.freebusy';
export const GOOGLE_EVENTS_SCOPE='https://www.googleapis.com/auth/calendar.events';
const oauthUrl=()=>{
  let app;
  try { app=new URL(process.env.APP_URL||''); } catch { throw new AppError('Configure a public HTTPS APP_URL first.',503,'AVAILABILITY_NOT_CONFIGURED'); }
  if(app.protocol!=='https:')throw new AppError('Configure a public HTTPS APP_URL first.',503,'AVAILABILITY_NOT_CONFIGURED');
  return new URL('/api/whatsapp/availability/google/callback',app).href;
};
const googleConfigured=()=>Boolean(process.env.GOOGLE_CLIENT_ID?.trim()&&process.env.GOOGLE_CLIENT_SECRET?.trim());
const connectionId=value=>/^avc_[a-f0-9]{16}$/.test(value||'');
const resourceId=value=>/^frr_[a-f0-9]{16}$/.test(value||'');
const shopVariant=value=>/^gid:\/\/shopify\/ProductVariant\/[1-9]\d{0,19}$/.test(value||'');
const calendarId=value=>typeof value==='string'&&value.length>=1&&value.length<=255&&!/[\x00-\x20\x7f]/.test(value);

async function providerJson(url,options,limit=200000) {
  let response;
  try { response=await fetch(url,{...options,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)}); }
  catch { throw new AppError('External availability is temporarily unreachable.',503,'AVAILABILITY_UNREACHABLE'); }
  let payload;
  try { payload=JSON.parse(await readTextBodyLimited(response,limit)); }
  catch { throw new AppError('External availability returned an invalid response.',502,'AVAILABILITY_INVALID_RESPONSE'); }
  if(!response.ok){
    const reconnect=response.status===401||response.status===403||payload.error==='invalid_grant';
    throw new AppError(reconnect?'Reconnect the external availability provider.':'External availability is unavailable.',reconnect?409:503,reconnect?'AVAILABILITY_REAUTHORIZE':'AVAILABILITY_UNREACHABLE');
  }
  return payload;
}

export function shopifyApiUrl(domain) {
  connectorSource('shopify',domain);
  const version=process.env.SHOPIFY_ADMIN_API_VERSION;
  if(!/^20\d{2}-(01|04|07|10)$/.test(version||''))throw new AppError('Set SHOPIFY_ADMIN_API_VERSION to a supported Shopify release.',503,'AVAILABILITY_NOT_CONFIGURED');
  return `https://${domain}/admin/api/${version}/graphql.json`;
}

export async function shopifyQuantity({domain,token,variantId,fetcher=providerJson}) {
  if(!shopVariant(variantId))throw new AppError('Provide a Shopify ProductVariant ID.',400,'AVAILABILITY_MAPPING_INVALID');
  const payload=await fetcher(shopifyApiUrl(domain),{method:'POST',headers:{'content-type':'application/json','x-shopify-access-token':token},body:JSON.stringify({query:'query Availability($id: ID!) { productVariant(id: $id) { id inventoryQuantity inventoryItem { tracked } } }',variables:{id:variantId}})});
  if(payload.errors?.length||payload.data?.productVariant?.id!==variantId||payload.data.productVariant.inventoryItem?.tracked!==true||!Number.isSafeInteger(payload.data.productVariant.inventoryQuantity)||payload.data.productVariant.inventoryQuantity<0)throw new AppError('Shopify inventory is unavailable or untracked for this variant.',409,'AVAILABILITY_UNCONFIRMED');
  return payload.data.productVariant.inventoryQuantity;
}

export async function googleAccessToken(refreshToken) {
  if(!googleConfigured())throw new AppError('Google Calendar OAuth is not configured.',503,'AVAILABILITY_NOT_CONFIGURED');
  const payload=await providerJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:refreshToken,grant_type:'refresh_token'})},20000);
  if(typeof payload.access_token!=='string'||!payload.access_token)throw new AppError('Reconnect Google Calendar.',409,'AVAILABILITY_REAUTHORIZE');
  return payload.access_token;
}

export async function googleCalendarAvailable({refreshToken,calendar,startsAt,endsAt,fetcher=providerJson,accessToken}) {
  if(!calendarId(calendar)||!startsAt||!endsAt||Date.parse(endsAt)<=Date.parse(startsAt))throw new AppError('Invalid calendar or booking time.',400,'AVAILABILITY_MAPPING_INVALID');
  const token=accessToken||await googleAccessToken(refreshToken);
  const payload=await fetcher('https://www.googleapis.com/calendar/v3/freeBusy',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({timeMin:new Date(startsAt).toISOString(),timeMax:new Date(endsAt).toISOString(),items:[{id:calendar}]})});
  const result=payload.calendars?.[calendar];
  if(!result||result.errors?.length||!Array.isArray(result.busy))throw new AppError('Calendar availability could not be verified.',409,'AVAILABILITY_UNCONFIRMED');
  return result.busy.length===0;
}

export async function liveAvailableFor(client,businessId,resource) {
  const mapping=(await client.query(`SELECT m.external_id,c.id,c.business_id,c.provider,c.source,c.credential_encrypted,c.refresh_encrypted,c.auth_method,c.enabled
    FROM availability_mappings m JOIN availability_connections c ON c.id=m.connection_id AND c.business_id=m.business_id
    WHERE m.business_id=$1 AND m.resource_id=$2`,[businessId,resource.id])).rows[0];
  if(!mapping)return null;
  if(!mapping.enabled||!(await workspaceFeatureFlags(businessId,(sql,params)=>client.query(sql,params))).connectors)throw new AppError('External availability is disabled.',409,'AVAILABILITY_DISABLED');
  if(mapping.provider==='shopify'&&resource.kind==='product')return shopifyQuantity({domain:mapping.source,token:await shopifyAccessToken(mapping,client),variantId:mapping.external_id});
  if(mapping.provider==='google_calendar'&&resource.kind==='slot')return await googleCalendarAvailable({refreshToken:decryptSecret(mapping.refresh_encrypted),calendar:mapping.external_id,startsAt:resource.starts_at,endsAt:resource.ends_at})?resource.capacity:0;
  throw new AppError('External mapping does not match its resource.',409,'AVAILABILITY_MAPPING_INVALID');
}

export async function availabilitySettings(request) {
  try {
    const session=await requireSession(request);
    if(session.role!=='Owner')throw new AppError('Only the workspace owner can manage availability.',403,'FORBIDDEN');
    await assertWorkspaceFeature('connectors',session.businessId);
    if(request.method==='GET'){
      const [connections,mappings,noticeRules,notices]=await Promise.all([
        query('SELECT id,provider,source,enabled,order_sync_enabled,auth_method,token_expires_at,granted_scopes,created_at,updated_at FROM availability_connections WHERE business_id=$1 ORDER BY created_at DESC LIMIT 50',[session.businessId]),
        query('SELECT resource_id,connection_id,external_id,write_enabled,updated_at FROM availability_mappings WHERE business_id=$1 ORDER BY updated_at DESC LIMIT 100',[session.businessId]),
        query('SELECT kind,template_id,enabled,updated_at FROM availability_booking_notice_rules WHERE business_id=$1',[session.businessId]),
        query('SELECT reservation_id,kind,status,last_error,created_at FROM availability_booking_notices WHERE business_id=$1 ORDER BY created_at DESC LIMIT 20',[session.businessId])
      ]);
      return json({connections:connections.rows,mappings:mappings.rows,noticeRules:noticeRules.rows,notices:notices.rows,googleConfigured:googleConfigured(),shopifyConfigured:shopifyOAuthConfigured()});
    }
    const body=await readJsonBodyLimited(request,8192);
    if(body.action==='booking_notice_rule'){
      if(!['confirmed','cancelled'].includes(body.kind)||typeof body.enabled!=='boolean'||!/^[-_a-zA-Z0-9]{1,100}$/.test(body.templateId||''))throw new AppError('Choose a valid booking notice rule.',400,'NOTICE_RULE_INVALID');
      const template=(await query("SELECT id FROM templates WHERE id=$1 AND business_id=$2 AND status='Approved' AND category='UTILITY' AND meta_template_name<>'' AND jsonb_array_length(variables)=0 AND jsonb_array_length(buttons)=0 AND header_text=''",[body.templateId,session.businessId])).rows[0];
      if(!template)throw new AppError('Choose an approved text-only utility template without variables or buttons.',409,'NOTICE_TEMPLATE_INELIGIBLE');
      await transaction(async client=>{
        await client.query('INSERT INTO availability_booking_notice_rules(business_id,kind,template_id,enabled) VALUES($1,$2,$3,$4) ON CONFLICT(business_id,kind) DO UPDATE SET template_id=EXCLUDED.template_id,enabled=EXCLUDED.enabled,updated_at=NOW()',[session.businessId,body.kind,body.templateId,body.enabled]);
        await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'booking_notice_rule_changed',JSON.stringify({kind:body.kind,templateId:body.templateId,enabled:body.enabled})]);
      });
      return json({ok:true});
    }
    if(body.action==='map'){
      if(!resourceId(body.resourceId)||!connectionId(body.connectionId))throw new AppError('Select a Flow resource and connection.',400,'AVAILABILITY_MAPPING_INVALID');
      await transaction(async client=>{
        const resource=(await client.query('SELECT id,kind,capacity,starts_at,ends_at FROM flow_runtime_resources WHERE id=$1 AND business_id=$2 FOR SHARE',[body.resourceId,session.businessId])).rows[0];
        const connection=(await client.query('SELECT * FROM availability_connections WHERE id=$1 AND business_id=$2 AND enabled FOR SHARE',[body.connectionId,session.businessId])).rows[0];
        if(!resource||!connection||connection.provider==='shopify'&&resource.kind!=='product'||connection.provider==='google_calendar'&&resource.kind!=='slot')throw new AppError('Choose a compatible resource and active connection.',409,'AVAILABILITY_MAPPING_INVALID');
        const count=Number((await client.query('SELECT COUNT(*) AS count FROM availability_mappings WHERE business_id=$1 AND resource_id<>$2',[session.businessId,resource.id])).rows[0].count);
        if(count>=20)throw new AppError('A workspace can map at most 20 live resources.',409,'AVAILABILITY_MAPPING_LIMIT');
        if(connection.provider==='shopify'&&!shopVariant(body.externalId)||connection.provider==='google_calendar'&&!calendarId(body.externalId))throw new AppError('Provide a valid external variant or calendar ID.',400,'AVAILABILITY_MAPPING_INVALID');
        if(body.writeEnabled===true&&connection.provider==='google_calendar'&&!connection.granted_scopes?.includes(GOOGLE_EVENTS_SCOPE))throw new AppError('Reconnect Google Calendar with booking access before enabling event creation.',409,'AVAILABILITY_REAUTHORIZE');
        if(body.writeEnabled===true&&connection.provider==='shopify'&&(!connection.granted_scopes?.includes('write_draft_orders')||!connection.granted_scopes?.includes('read_draft_orders')))throw new AppError('Reconnect Shopify with read and write draft-order access.',409,'AVAILABILITY_REAUTHORIZE');
        if(body.writeEnabled!==undefined&&typeof body.writeEnabled!=='boolean')throw new AppError('Invalid fulfillment setting.',400,'AVAILABILITY_MAPPING_INVALID');
        if(body.writeEnabled===true&&connection.provider==='google_calendar'&&resource.capacity!==1)throw new AppError('Calendar event creation requires a single-capacity booking slot.',409,'AVAILABILITY_MAPPING_INVALID');
        const tested=connection.provider==='shopify'?await shopifyQuantity({domain:connection.source,token:await shopifyAccessToken(connection,client),variantId:body.externalId}):await googleCalendarAvailable({refreshToken:decryptSecret(connection.refresh_encrypted),calendar:body.externalId,startsAt:resource.starts_at,endsAt:resource.ends_at});
        if(tested===null)throw new AppError('External resource could not be verified.',409,'AVAILABILITY_UNCONFIRMED');
        await client.query('INSERT INTO availability_mappings(resource_id,business_id,connection_id,external_id,write_enabled) VALUES($1,$2,$3,$4,$5) ON CONFLICT(resource_id) DO UPDATE SET connection_id=EXCLUDED.connection_id,external_id=EXCLUDED.external_id,write_enabled=EXCLUDED.write_enabled,updated_at=NOW()',[resource.id,session.businessId,connection.id,body.externalId,body.writeEnabled===true]);
        await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'availability_mapped',JSON.stringify({resourceId:resource.id,connectionId:connection.id})]);
      });
      return json({ok:true});
    }
    if(body.action==='unmap'){
      if(!resourceId(body.resourceId))throw new AppError('Invalid Flow resource.',400,'AVAILABILITY_MAPPING_INVALID');
      await query('DELETE FROM availability_mappings WHERE business_id=$1 AND resource_id=$2',[session.businessId,body.resourceId]);
      return json({ok:true});
    }
    if(body.action==='toggle'){
      if(!connectionId(body.id)||typeof body.enabled!=='boolean')throw new AppError('Invalid connection.',400,'AVAILABILITY_MAPPING_INVALID');
      const changed=await query('UPDATE availability_connections SET enabled=$1,updated_at=NOW() WHERE business_id=$2 AND id=$3 RETURNING id',[body.enabled,session.businessId,body.id]);
      if(!changed.rowCount)throw new AppError('Connection not found.',404,'NOT_FOUND');
      return json({ok:true});
    }
    if(body.action==='shopify_order_sync'){
      if(!connectionId(body.id)||typeof body.enabled!=='boolean')throw new AppError('Invalid Shopify order sync setting.',400,'AVAILABILITY_MAPPING_INVALID');
      await transaction(async client=>{
        const connection=(await client.query("SELECT id,enabled,granted_scopes FROM availability_connections WHERE id=$1 AND business_id=$2 AND provider='shopify' FOR UPDATE",[body.id,session.businessId])).rows[0];
        if(!connection)throw new AppError('Shopify connection not found.',404,'NOT_FOUND');
        if(body.enabled&&(!connection.enabled||!connection.granted_scopes?.includes('read_draft_orders')||!connection.granted_scopes?.includes('read_orders')))
          throw new AppError('Enable Shopify and reconnect with read_draft_orders and read_orders before automatic order checks.',409,'AVAILABILITY_REAUTHORIZE');
        await client.query('UPDATE availability_connections SET order_sync_enabled=$1,updated_at=NOW() WHERE id=$2 AND business_id=$3',[body.enabled,body.id,session.businessId]);
        await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'shopify_order_sync_changed',JSON.stringify({connectionId:body.id,enabled:body.enabled})]);
      });
      return json({ok:true});
    }
    if(body.action==='retry_fulfillment'){
      if(!/^frv_[a-f0-9]{16}$/.test(body.reservationId||''))throw new AppError('Invalid reservation.',400,'AVAILABILITY_MAPPING_INVALID');
      await transaction(async client=>{
        const fulfillment=(await client.query("SELECT * FROM availability_fulfillments WHERE business_id=$1 AND reservation_id=$2 AND status='needs_reconnect' FOR UPDATE",[session.businessId,body.reservationId])).rows[0];
        if(!fulfillment)throw new AppError('No reconnect-required booking was found.',404,'NOT_FOUND');
        const connection=(await client.query("SELECT id,granted_scopes FROM availability_connections WHERE business_id=$1 AND provider='google_calendar' AND enabled FOR SHARE",[session.businessId])).rows[0];
        if(!connection?.granted_scopes?.includes(GOOGLE_EVENTS_SCOPE))throw new AppError('Authorize Calendar bookings before retrying.',409,'AVAILABILITY_REAUTHORIZE');
        await client.query("UPDATE availability_fulfillments SET connection_id=$1,status=CASE WHEN requested_action='cancel' THEN 'cancel_pending' ELSE 'pending' END,next_attempt_at=NOW(),last_error=NULL,updated_at=NOW() WHERE business_id=$2 AND reservation_id=$3",[connection.id,session.businessId,body.reservationId]);
        await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'availability_fulfillment_retried',JSON.stringify({reservationId:body.reservationId})]);
      });
      return json({ok:true});
    }
    if(body.action==='cancel_fulfillment'){
      if(!/^frv_[a-f0-9]{16}$/.test(body.reservationId||''))throw new AppError('Invalid reservation.',400,'AVAILABILITY_MAPPING_INVALID');
      await transaction(async client=>{
        const fulfillment=(await client.query('SELECT status,requested_action FROM availability_fulfillments WHERE business_id=$1 AND reservation_id=$2 FOR UPDATE',[session.businessId,body.reservationId])).rows[0];
        if(!fulfillment)throw new AppError('Calendar booking not found.',404,'NOT_FOUND');
        if(fulfillment.status==='cancelled'||fulfillment.requested_action==='cancel')return;
        const reservation=(await client.query('SELECT status FROM flow_runtime_reservations WHERE business_id=$1 AND id=$2 FOR UPDATE',[session.businessId,body.reservationId])).rows[0];
        if(!reservation||!['pending_external','confirmed','external_failed'].includes(reservation.status))throw new AppError('This booking cannot be cancelled.',409,'CALENDAR_BOOKING_INVALID');
        await client.query("UPDATE flow_runtime_reservations SET status='cancel_pending' WHERE business_id=$1 AND id=$2",[session.businessId,body.reservationId]);
        await client.query("UPDATE availability_fulfillments SET requested_action='cancel',status='cancel_pending',next_attempt_at=NOW(),claimed_at=NULL,last_error=NULL,updated_at=NOW() WHERE business_id=$1 AND reservation_id=$2",[session.businessId,body.reservationId]);
        await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'availability_booking_cancellation_requested',JSON.stringify({reservationId:body.reservationId})]);
      });
      return json({ok:true});
    }
    if(['create_shopify_draft','reconcile_shopify_draft','reconcile_shopify_order'].includes(body.action)){
      if(!/^wo_[a-f0-9]{16}$/.test(body.orderId||''))throw new AppError('Invalid CRM order.',400,'AVAILABILITY_MAPPING_INVALID');
      const result=body.action==='create_shopify_draft'?await createShopifyDraftForOrder(session.businessId,body.orderId):body.action==='reconcile_shopify_draft'?await reconcileShopifyDraftForOrder(session.businessId,body.orderId):await reconcileShopifyOrderForDraft(session.businessId,body.orderId);
      await query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,body.action,JSON.stringify({orderId:body.orderId,status:result.status})]);
      return json(result);
    }
    if(body.action==='disconnect'){
      if(!connectionId(body.id))throw new AppError('Invalid connection.',400,'AVAILABILITY_MAPPING_INVALID');
      const removed=await transaction(async client=>{
        const connection=(await client.query('SELECT * FROM availability_connections WHERE business_id=$1 AND id=$2 FOR UPDATE',[session.businessId,body.id])).rows[0];
        if(!connection)throw new AppError('Connection not found.',404,'NOT_FOUND');
        await client.query('DELETE FROM availability_mappings WHERE business_id=$1 AND connection_id=$2',[session.businessId,body.id]);
        await client.query('DELETE FROM availability_connections WHERE business_id=$1 AND id=$2',[session.businessId,body.id]);
        await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'availability_disconnected',JSON.stringify({provider:connection.provider,source:connection.source})]);
        return connection;
      });
      let revoked=null;
      if(removed.provider==='google_calendar'&&removed.refresh_encrypted){
        try{
          const response=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:decryptSecret(removed.refresh_encrypted)}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
          revoked=response.ok;
        }catch{revoked=false;}
      }
      return json({ok:true,revoked});
    }
    throw new AppError('Unsupported availability action.',400,'INVALID_ACTION');
  } catch(error){return errorJson(error);}
}

export async function googleAuthorizationStart(request) {
  try {
    const session=await requireSession(request);
    if(session.role!=='Owner')throw new AppError('Only the owner can connect a calendar.',403,'FORBIDDEN');
    await assertWorkspaceFeature('connectors',session.businessId);
    if(!googleConfigured())throw new AppError('Google Calendar OAuth is not configured.',503,'AVAILABILITY_NOT_CONFIGURED');
    const mode=new URL(request.url).searchParams.get('mode')==='booking'?'booking':'availability';
    const state=crypto.randomBytes(32).toString('hex');
    const verifier=crypto.randomBytes(32).toString('base64url');
    await query("INSERT INTO availability_oauth_states(state_hash,business_id,user_id,code_verifier_encrypted,mode,expires_at) VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL '10 minutes')",[digest(state),session.businessId,session.userId,encryptSecret(verifier),mode]);
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:oauthUrl(),response_type:'code',scope:[GOOGLE_FREEBUSY_SCOPE,...(mode==='booking'?[GOOGLE_EVENTS_SCOPE]:[])].join(' '),access_type:'offline',prompt:'consent',state,code_challenge:codeChallenge(verifier),code_challenge_method:'S256'}).toString();
    return Response.redirect(url,303);
  } catch(error){return errorJson(error);}
}

export async function googleAuthorizationCallback(request) {
  try {
    const session=await requireSession(request);
    if(session.role!=='Owner')throw new AppError('Only the owner can connect a calendar.',403,'FORBIDDEN');
    const params=new URL(request.url).searchParams,state=params.get('state'),code=params.get('code');
    if(!/^[a-f0-9]{64}$/.test(state||'')||typeof code!=='string'||code.length<10||code.length>4096||params.has('error'))throw new AppError('Google authorization was not completed.',400,'AVAILABILITY_AUTH_FAILED');
    const used=await query('DELETE FROM availability_oauth_states WHERE state_hash=$1 AND business_id=$2 AND user_id=$3 AND expires_at>NOW() RETURNING code_verifier_encrypted,mode',[digest(state),session.businessId,session.userId]);
    if(!used.rowCount||!used.rows[0].code_verifier_encrypted)throw new AppError('Google authorization has expired. Start again.',409,'AVAILABILITY_AUTH_EXPIRED');
    const token=await providerJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,code,code_verifier:decryptSecret(used.rows[0].code_verifier_encrypted),grant_type:'authorization_code',redirect_uri:oauthUrl()})},20000);
    const scopes=String(token.scope||'').split(' ').filter(Boolean);
    if(typeof token.refresh_token!=='string'||!token.refresh_token||!scopes.includes(GOOGLE_FREEBUSY_SCOPE)||used.rows[0].mode==='booking'&&!scopes.includes(GOOGLE_EVENTS_SCOPE))throw new AppError('Google did not grant the requested calendar access.',409,'AVAILABILITY_AUTH_FAILED');
    await transaction(async client=>{
      if(!scopes.includes(GOOGLE_EVENTS_SCOPE)){
        const active=await client.query(`SELECT 1 FROM availability_mappings WHERE business_id=$1 AND write_enabled LIMIT 1`,[session.businessId]);
        if(active.rowCount)throw new AppError('Calendar booking mappings require booking access. Reconnect using Authorize Calendar bookings.',409,'AVAILABILITY_AUTH_FAILED');
      }
      const saved=await client.query("INSERT INTO availability_connections(id,business_id,provider,source,refresh_encrypted,granted_scopes) VALUES($1,$2,'google_calendar','calendar',$3,$4) ON CONFLICT(business_id,provider,source) DO UPDATE SET refresh_encrypted=EXCLUDED.refresh_encrypted,granted_scopes=EXCLUDED.granted_scopes,enabled=TRUE,updated_at=NOW() RETURNING id",[id('avc'),session.businessId,encryptSecret(token.refresh_token),scopes]);
      if(scopes.includes(GOOGLE_EVENTS_SCOPE))await client.query("UPDATE availability_fulfillments SET status=CASE WHEN requested_action='cancel' THEN 'cancel_pending' ELSE 'pending' END,next_attempt_at=NOW(),last_error=NULL,updated_at=NOW() WHERE business_id=$1 AND connection_id=$2 AND status='needs_reconnect'",[session.businessId,saved.rows[0].id]);
      await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'availability_google_connected',JSON.stringify({provider:'google_calendar'})]);
    });
    return Response.redirect(new URL('/app/settings/whatsapp',process.env.APP_URL),303);
  } catch(error){return errorJson(error);}
}

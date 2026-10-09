import crypto from 'node:crypto';
import {requireSession} from './auth.js';
import {AppError,errorJson,id,query,transaction} from './db.js';
import {assertWorkspaceFeature} from './feature-controls.js';
import {connectorSource} from './provider-connectors.js';
import {decryptSecret,encryptSecret} from './meta.js';
import {readTextBodyLimited} from './security.js';

const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
export const shopifyOAuthConfigured=()=>Boolean(process.env.SHOPIFY_CLIENT_ID?.trim()&&process.env.SHOPIFY_CLIENT_SECRET?.trim()&&process.env.SHOPIFY_ADMIN_API_VERSION?.trim());
const scopes=['read_products','read_inventory','read_orders','read_draft_orders','write_draft_orders'];
export const SHOPIFY_WEBHOOK_TOPICS=[
  {topic:'ORDERS_UPDATED',handle:'orders/updated',privacy:false,managed:true},
  {topic:'ORDERS_PAID',handle:'orders/paid',privacy:false,managed:true},
  {topic:'REFUNDS_CREATE',handle:'refunds/create',privacy:false,managed:true},
  {topic:'CUSTOMERS_DATA_REQUEST',handle:'customers/data_request',privacy:true,managed:false},
  {topic:'CUSTOMERS_REDACT',handle:'customers/redact',privacy:true,managed:false},
  {topic:'SHOP_REDACT',handle:'shop/redact',privacy:true,managed:false}
];
const callbackUrl=()=>{
  let app;try{app=new URL(process.env.APP_URL);}catch{throw new AppError('Configure the public HTTPS APP_URL.',503,'SHOPIFY_OAUTH_NOT_CONFIGURED');}
  if(app.protocol!=='https:'||app.username||app.password||app.search||app.hash)throw new AppError('Configure the public HTTPS APP_URL.',503,'SHOPIFY_OAUTH_NOT_CONFIGURED');
  return new URL('/api/whatsapp/availability/shopify/callback',app.origin).href;
};
export function shopifyWebhookCallbackUrl(connectorId){
  if(!/^pc_[a-f0-9]{16}$/.test(connectorId||''))throw new AppError('Shopify webhook connector is invalid.',500,'SHOPIFY_WEBHOOK_INVALID');
  let app;try{app=new URL(process.env.APP_URL);}catch{throw new AppError('Configure the public HTTPS APP_URL.',503,'SHOPIFY_OAUTH_NOT_CONFIGURED');}
  if(app.protocol!=='https:'||app.username||app.password||app.search||app.hash)throw new AppError('Configure the public HTTPS APP_URL.',503,'SHOPIFY_OAUTH_NOT_CONFIGURED');
  return new URL(`/api/connectors/events/${connectorId}`,app.origin).href;
}
export function shopifyPrivacyCallbackUrl(){
  let app;try{app=new URL(process.env.APP_URL);}catch{throw new AppError('Configure the public HTTPS APP_URL.',503,'SHOPIFY_OAUTH_NOT_CONFIGURED');}
  if(app.protocol!=='https:'||app.username||app.password||app.search||app.hash)throw new AppError('Configure the public HTTPS APP_URL.',503,'SHOPIFY_OAUTH_NOT_CONFIGURED');
  return new URL('/api/webhooks/shopify/privacy',app.origin).href;
}
function adminApiUrl(shop){
  connectorSource('shopify',shop);
  const version=process.env.SHOPIFY_ADMIN_API_VERSION;
  if(!/^20\d{2}-(01|04|07|10)$/.test(version||''))throw new AppError('Configure SHOPIFY_ADMIN_API_VERSION.',503,'SHOPIFY_OAUTH_NOT_CONFIGURED');
  return `https://${shop}/admin/api/${version}/graphql.json`;
}
async function webhookGraphql(shop,token,queryText,variables,fetcher,{allowGraphqlErrors=false}={}){
  let response,payload;
  try{
    response=await fetcher(adminApiUrl(shop),{method:'POST',headers:{'content-type':'application/json','x-shopify-access-token':token},body:JSON.stringify({query:queryText,variables}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)});
    payload=JSON.parse(await readTextBodyLimited(response,100000));
  }catch{throw new AppError('Shopify webhook subscriptions could not be checked.',503,'SHOPIFY_WEBHOOK_UNAVAILABLE');}
  if(response.status===401||response.status===403)throw new AppError('Reconnect Shopify to repair webhook subscriptions.',409,'SHOPIFY_REAUTHORIZE');
  if(!response.ok||payload.errors?.length&&!allowGraphqlErrors)throw new AppError('Shopify webhook subscriptions could not be checked.',503,'SHOPIFY_WEBHOOK_UNAVAILABLE');
  if(payload.errors?.length)return {_topLevelErrors:payload.errors};
  return payload.data;
}
export async function reconcileShopifyWebhooks({shop,token,connectorId,fetcher=fetch}){
  const callbackUrl=shopifyWebhookCallbackUrl(connectorId);
  const privacyCallbackUrl=shopifyPrivacyCallbackUrl();
  const listed=await webhookGraphql(shop,token,`query ManagedWebhooks { webhookSubscriptions(first: 250) { nodes { id topic uri } } }`,{},fetcher);
  if(!Array.isArray(listed?.webhookSubscriptions?.nodes))throw new AppError('Shopify returned an invalid webhook subscription list.',503,'SHOPIFY_WEBHOOK_UNAVAILABLE');
  const subscriptions=listed.webhookSubscriptions.nodes;
  const results=[];
  for(const required of SHOPIFY_WEBHOOK_TOPICS){
    if(!required.managed){
      results.push({...required,status:process.env.SHOPIFY_PRIVACY_WEBHOOKS_CONFIGURED==='true'?'configured':'configuration_required',subscriptionId:''});
      continue;
    }
    const matching=subscriptions.filter(item=>item?.topic===required.topic);
    const exact=matching.filter(item=>item.uri===callbackUrl);
    let status='active',subscriptionId=exact[0]?.id||'';
    if(!exact.length&&matching.length){
      const data=await webhookGraphql(shop,token,`mutation RepairWebhook($id: ID!, $subscription: WebhookSubscriptionInput!) { webhookSubscriptionUpdate(id:$id,webhookSubscription:$subscription) { webhookSubscription { id topic uri } userErrors { field message } } }`,{id:matching[0].id,subscription:{uri:callbackUrl,format:'JSON'}},fetcher,{allowGraphqlErrors:true});
      const result=data?.webhookSubscriptionUpdate,errors=[...(data?._topLevelErrors||[]),...(result?.userErrors||[])];
      if(errors.length)status='error';
      else if(result?.webhookSubscription?.uri===callbackUrl){status='repaired';subscriptionId=result.webhookSubscription.id;}
      else status='error';
    }else if(!exact.length){
      const data=await webhookGraphql(shop,token,`mutation CreateWebhook($topic: WebhookSubscriptionTopic!, $subscription: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic:$topic,webhookSubscription:$subscription) { webhookSubscription { id topic uri } userErrors { field message } } }`,{topic:required.topic,subscription:{uri:callbackUrl,format:'JSON'}},fetcher,{allowGraphqlErrors:true});
      const result=data?.webhookSubscriptionCreate,errors=[...(data?._topLevelErrors||[]),...(result?.userErrors||[])];
      if(errors.length)status='error';
      else if(result?.webhookSubscription?.uri===callbackUrl){status='created';subscriptionId=result.webhookSubscription.id;}
      else status='error';
    }
    const extras=[...exact.slice(1),...(exact.length?matching.filter(item=>item.uri!==callbackUrl):matching.slice(1))];
    for(const extra of extras){
      if(!/^gid:\/\/shopify\/WebhookSubscription\/\d+$/.test(extra?.id||''))continue;
      await webhookGraphql(shop,token,`mutation DeleteWebhook($id: ID!) { webhookSubscriptionDelete(id:$id) { deletedWebhookSubscriptionId userErrors { field message } } }`,{id:extra.id},fetcher).catch(()=>null);
    }
    results.push({...required,status,subscriptionId});
  }
  const operationalHealthy=results.filter(item=>!item.privacy).every(item=>['active','created','repaired'].includes(item.status));
  const privacyHealthy=results.filter(item=>item.privacy).every(item=>item.status==='configured');
  return {state:operationalHealthy?(privacyHealthy?'active':'privacy_action_required'):'degraded',callbackUrl,privacyCallbackUrl,topics:results,checkedAt:new Date().toISOString()};
}
async function tokenRequest(shop,form){
  let response,payload;
  try{response=await fetch(`https://${shop}/admin/oauth/access_token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},body:new URLSearchParams(form),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)});payload=JSON.parse(await readTextBodyLimited(response,20000));}
  catch{throw new AppError('Shopify authorization is temporarily unavailable.',503,'SHOPIFY_AUTH_UNAVAILABLE');}
  if(!response.ok)throw new AppError('Reconnect Shopify to restore access.',409,'SHOPIFY_REAUTHORIZE');
  if(typeof payload.access_token!=='string'||!payload.access_token||typeof payload.refresh_token!=='string'||!payload.refresh_token||!Number.isSafeInteger(payload.expires_in)||payload.expires_in<1||!Number.isSafeInteger(payload.refresh_token_expires_in)||payload.refresh_token_expires_in<1)throw new AppError('Shopify returned incomplete offline credentials.',409,'SHOPIFY_AUTH_INVALID');
  return payload;
}
export function verifyShopifyOAuthHmac(params,secret){
  const entries=[...params.entries()];
  if(entries.some(([key])=>params.getAll(key).length!==1))return false;
  const supplied=params.get('hmac');
  if(!/^[a-f0-9]{64}$/.test(supplied||''))return false;
  const message=entries.filter(([key])=>key!=='hmac').sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('&');
  const expected=crypto.createHmac('sha256',secret).update(message).digest();
  return crypto.timingSafeEqual(expected,Buffer.from(supplied,'hex'));
}
export async function shopifyAuthorizationStart(request){
  try{
    const session=await requireSession(request);
    if(session.role!=='Owner')throw new AppError('Only the owner can connect Shopify.',403,'FORBIDDEN');
    await assertWorkspaceFeature('connectors',session.businessId);
    if(!shopifyOAuthConfigured())throw new AppError('Shopify OAuth is not configured by the platform.',503,'SHOPIFY_OAUTH_NOT_CONFIGURED');
    const shop=connectorSource('shopify',new URL(request.url).searchParams.get('shop'));
    const state=crypto.randomBytes(32).toString('hex');
    await query("INSERT INTO shopify_oauth_states(state_hash,business_id,user_id,shop,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '10 minutes')",[digest(state),session.businessId,session.userId,shop]);
    const url=new URL(`https://${shop}/admin/oauth/authorize`);
    url.search=new URLSearchParams({client_id:process.env.SHOPIFY_CLIENT_ID,scope:scopes.join(','),redirect_uri:callbackUrl(),state}).toString();
    return Response.redirect(url,303);
  }catch(error){return errorJson(error);}
}
export async function shopifyAuthorizationCallback(request){
  try{
    const session=await requireSession(request);
    if(session.role!=='Owner')throw new AppError('Only the owner can connect Shopify.',403,'FORBIDDEN');
    await assertWorkspaceFeature('connectors',session.businessId);
    if(!shopifyOAuthConfigured())throw new AppError('Shopify OAuth is not configured by the platform.',503,'SHOPIFY_OAUTH_NOT_CONFIGURED');
    const params=new URL(request.url).searchParams,shop=connectorSource('shopify',params.get('shop'));
    const state=params.get('state'),code=params.get('code');
    if(!/^[a-f0-9]{64}$/.test(state||'')||typeof code!=='string'||code.length<8||code.length>4096||!verifyShopifyOAuthHmac(params,process.env.SHOPIFY_CLIENT_SECRET))throw new AppError('Shopify authorization failed verification.',403,'SHOPIFY_AUTH_INVALID');
    const used=await query('DELETE FROM shopify_oauth_states WHERE state_hash=$1 AND business_id=$2 AND user_id=$3 AND shop=$4 AND expires_at>NOW() RETURNING shop',[digest(state),session.businessId,session.userId,shop]);
    if(!used.rowCount)throw new AppError('Shopify authorization expired. Connect again.',409,'SHOPIFY_AUTH_EXPIRED');
    const payload=await tokenRequest(shop,{client_id:process.env.SHOPIFY_CLIENT_ID,client_secret:process.env.SHOPIFY_CLIENT_SECRET,code,expiring:'1'});
    const granted=String(payload.scope||'').split(',').filter(Boolean);
    if(scopes.some(scope=>!granted.includes(scope)&&!(scope.startsWith('read_')&&granted.includes(scope.replace(/^read_/,'write_')))))throw new AppError('Shopify did not grant the required inventory, draft and order scopes.',409,'SHOPIFY_SCOPE_MISSING');
    const effectiveScopes=[...new Set([...granted,...scopes.filter(scope=>scope.startsWith('read_')&&granted.includes(scope.replace(/^read_/,'write_')))])];
    let response,verified;
    try{response=await fetch(adminApiUrl(shop),{method:'POST',headers:{'content-type':'application/json','x-shopify-access-token':payload.access_token},body:JSON.stringify({query:'query VerifyShop { shop { myshopifyDomain } }'}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)});verified=JSON.parse(await readTextBodyLimited(response,20000));}
    catch{throw new AppError('Shopify store identity could not be verified.',503,'SHOPIFY_AUTH_UNAVAILABLE');}
    if(!response.ok||verified.errors?.length||verified.data?.shop?.myshopifyDomain!==shop)throw new AppError('Shopify store identity did not match the authorized shop.',409,'SHOPIFY_AUTH_INVALID');
    const connected=await transaction(async client=>{
      const saved=await client.query(`INSERT INTO availability_connections(id,business_id,provider,source,credential_encrypted,refresh_encrypted,granted_scopes,token_expires_at,refresh_expires_at,auth_method)
        VALUES($1,$2,'shopify',$3,$4,$5,$6,NOW()+$7::int*INTERVAL '1 second',NOW()+$8::int*INTERVAL '1 second','oauth')
        ON CONFLICT(business_id,provider,source) DO UPDATE SET credential_encrypted=EXCLUDED.credential_encrypted,refresh_encrypted=EXCLUDED.refresh_encrypted,
        granted_scopes=EXCLUDED.granted_scopes,token_expires_at=EXCLUDED.token_expires_at,refresh_expires_at=EXCLUDED.refresh_expires_at,auth_method='oauth',enabled=TRUE,updated_at=NOW()
        RETURNING id,webhook_connector_id`,
        [id('avc'),session.businessId,shop,encryptSecret(payload.access_token),encryptSecret(payload.refresh_token),effectiveScopes,payload.expires_in,payload.refresh_token_expires_in]);
      let connectorId=saved.rows[0].webhook_connector_id;
      if(connectorId){
        const repaired=await client.query("UPDATE provider_connectors SET secret_encrypted=$1,enabled=TRUE WHERE id=$2 AND business_id=$3 AND provider='shopify' AND source=$4 RETURNING id",[encryptSecret(process.env.SHOPIFY_CLIENT_SECRET),connectorId,session.businessId,shop]);
        if(!repaired.rowCount)connectorId=null;
      }
      if(!connectorId){
        connectorId=id('pc');
        await client.query("INSERT INTO provider_connectors(id,business_id,name,provider,source,secret_encrypted) VALUES($1,$2,$3,'shopify',$4,$5)",[connectorId,session.businessId,`Shopify ${shop}`,shop,encryptSecret(process.env.SHOPIFY_CLIENT_SECRET)]);
        await client.query('UPDATE availability_connections SET webhook_connector_id=$1 WHERE id=$2 AND business_id=$3',[connectorId,saved.rows[0].id,session.businessId]);
      }
      await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'availability_shopify_oauth_connected',JSON.stringify({shop})]);
      return {connectionId:saved.rows[0].id,connectorId};
    });
    let webhookStatus;
    try{webhookStatus=await reconcileShopifyWebhooks({shop,token:payload.access_token,connectorId:connected.connectorId});}
    catch(error){webhookStatus={state:error.code==='SHOPIFY_REAUTHORIZE'?'reauthorize':'degraded',callbackUrl:shopifyWebhookCallbackUrl(connected.connectorId),privacyCallbackUrl:shopifyPrivacyCallbackUrl(),topics:[],checkedAt:new Date().toISOString(),error:error.code||'SHOPIFY_WEBHOOK_UNAVAILABLE'};}
    await query('UPDATE availability_connections SET webhook_status=$1,webhook_checked_at=NOW(),updated_at=NOW() WHERE id=$2 AND business_id=$3',[JSON.stringify(webhookStatus),connected.connectionId,session.businessId]);
    return Response.redirect(new URL('/app/settings/whatsapp',process.env.APP_URL),303);
  }catch(error){return errorJson(error);}
}
export async function repairShopifyWebhooks(connection){
  if(connection.provider!=='shopify'||!connection.webhook_connector_id)throw new AppError('Reconnect Shopify to configure webhook delivery.',409,'SHOPIFY_REAUTHORIZE');
  let status;
  try{
    status=await reconcileShopifyWebhooks({shop:connection.source,token:await shopifyAccessToken(connection),connectorId:connection.webhook_connector_id});
  }catch(error){
    status={state:error.code==='SHOPIFY_REAUTHORIZE'?'reauthorize':'degraded',callbackUrl:shopifyWebhookCallbackUrl(connection.webhook_connector_id),privacyCallbackUrl:shopifyPrivacyCallbackUrl(),topics:[],checkedAt:new Date().toISOString(),error:error.code||'SHOPIFY_WEBHOOK_UNAVAILABLE'};
  }
  await query('UPDATE availability_connections SET webhook_status=$1,webhook_checked_at=NOW(),updated_at=NOW() WHERE id=$2 AND business_id=$3',[JSON.stringify(status),connection.id,connection.business_id]);
  return status;
}
export async function shopifyAccessToken(connection,existingClient=null){
  if(connection.auth_method!=='oauth')return decryptSecret(connection.credential_encrypted);
  const renew=async client=>{
    const row=(await client.query("SELECT * FROM availability_connections WHERE id=$1 AND business_id=$2 AND provider='shopify' AND enabled FOR UPDATE",[connection.id||connection.connection_id,connection.business_id])).rows[0];
    if(!row||row.source!==connection.source)throw new AppError('Reconnect Shopify.',409,'SHOPIFY_REAUTHORIZE');
    if(row.token_expires_at&&new Date(row.token_expires_at).getTime()>Date.now()+120000)return decryptSecret(row.credential_encrypted);
    if(!row.refresh_encrypted||!row.refresh_expires_at||new Date(row.refresh_expires_at).getTime()<=Date.now())throw new AppError('Shopify authorization expired. Reconnect the store.',409,'SHOPIFY_REAUTHORIZE');
    const refreshed=await tokenRequest(row.source,{client_id:process.env.SHOPIFY_CLIENT_ID,client_secret:process.env.SHOPIFY_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:decryptSecret(row.refresh_encrypted)});
    await client.query("UPDATE availability_connections SET credential_encrypted=$1,refresh_encrypted=$2,token_expires_at=NOW()+$3::int*INTERVAL '1 second',refresh_expires_at=NOW()+$4::int*INTERVAL '1 second',updated_at=NOW() WHERE id=$5 AND business_id=$6",[encryptSecret(refreshed.access_token),encryptSecret(refreshed.refresh_token),refreshed.expires_in,refreshed.refresh_token_expires_in,row.id,row.business_id]);
    return refreshed.access_token;
  };
  return existingClient?renew(existingClient):transaction(renew);
}

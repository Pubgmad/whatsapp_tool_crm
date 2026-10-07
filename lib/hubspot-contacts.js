import crypto from 'node:crypto';
import {requireSession} from './auth.js';
import {AppError,query,transaction,id,json,errorJson} from './db.js';
import {encryptSecret,decryptSecret} from './meta.js';
import {readJsonBodyLimited,readTextBodyLimited} from './security.js';
import {assertWorkspaceFeature,workspaceFeatureFlags} from './feature-controls.js';
import {archiveCrmObjectPage,crmObjectCursor,crmObjectSettings,removeCrmFieldMapping,saveCrmFieldMapping,setCrmObjectSync,storeCrmObjectPage} from './crm-objects.js';
import {tenantDisplayName} from './crm-outbound-context.js';

const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const configured=()=>Boolean(process.env.HUBSPOT_CLIENT_ID?.trim()&&process.env.HUBSPOT_CLIENT_SECRET?.trim());
const scopes=['crm.objects.contacts.read','crm.objects.contacts.write','crm.objects.companies.read','crm.objects.companies.write','crm.objects.deals.read','crm.objects.deals.write'];
const redirectUri=()=>{
  let url;try{url=new URL(process.env.APP_URL||'');}catch{throw new AppError('Configure APP_URL first.',503,'CRM_NOT_CONFIGURED');}
  if(url.protocol!=='https:')throw new AppError('Use a public HTTPS APP_URL for HubSpot OAuth.',503,'CRM_NOT_CONFIGURED');
  return new URL('/api/crm/hubspot/callback',url).href;
};

async function hubspotJson(path,{method='GET',token,body}={}){
  let response;
  try{response=await fetch('https://api.hubapi.com'+path,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':body instanceof URLSearchParams?'application/x-www-form-urlencoded':'application/json'}:{})},...(body?{body:body instanceof URLSearchParams?body:JSON.stringify(body)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});}catch{throw new AppError('HubSpot is temporarily unreachable.',503,'CRM_UNREACHABLE');}
  let payload;try{payload=JSON.parse(await readTextBodyLimited(response,500000));}catch{throw new AppError('HubSpot returned an invalid response.',502,'CRM_INVALID_RESPONSE');}
  if(!response.ok){
    const reconnect=response.status===401||response.status===403||payload.error==='invalid_grant';
    throw new AppError(reconnect?'Reconnect HubSpot.':'HubSpot rejected the request.',reconnect?409:response.status===429?429:502,reconnect?'CRM_REAUTHORIZE':response.status===429?'CRM_RATE_LIMIT':'CRM_PROVIDER_ERROR');
  }
  return payload;
}

export function normalizeHubSpotContact(value){
  if(!value||!/^\d{1,32}$/.test(String(value.id||''))||value.archived)return null;
  const phone=String(value.properties?.phone||'').trim();
  if(!/^\+[1-9]\d{7,14}$/.test(phone))return null;
  const name=[value.properties?.firstname,value.properties?.lastname].filter(part=>typeof part==='string'&&part.trim()).join(' ').trim().slice(0,120)||phone;
  const at=new Date(value.updatedAt);
  if(!Number.isFinite(at.getTime()))return null;
  return {externalId:String(value.id),phone:phone.slice(1),name,updatedAt:at.toISOString()};
}

export function hubspotName(name){
  const words=String(name||'').trim().split(/\s+/);
  return {firstname:(words.shift()||'').slice(0,100),lastname:words.join(' ').slice(0,100)};
}

async function tokenFor(connection){
  if(new Date(connection.expires_at).getTime()>Date.now()+60000)return decryptSecret(connection.access_encrypted);
  if(!configured())throw new AppError('HubSpot OAuth is not configured.',503,'CRM_NOT_CONFIGURED');
  const old=connection.refresh_encrypted;
  const result=await hubspotJson('/oauth/2026-03/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:process.env.HUBSPOT_CLIENT_ID,client_secret:process.env.HUBSPOT_CLIENT_SECRET,refresh_token:decryptSecret(old)})});
  if(typeof result.access_token!=='string'||!result.access_token||!Number.isInteger(result.expires_in)||result.expires_in<60)throw new AppError('Reconnect HubSpot.',409,'CRM_REAUTHORIZE');
  const refresh=result.refresh_token||decryptSecret(old);
  const changed=await query('UPDATE crm_connections SET access_encrypted=$1,refresh_encrypted=$2,expires_at=NOW()+$3*INTERVAL \'1 second\',updated_at=NOW() WHERE id=$4 AND business_id=$5 AND refresh_encrypted=$6 RETURNING id',[encryptSecret(result.access_token),encryptSecret(refresh),result.expires_in,connection.id,connection.business_id,old]);
  if(!changed.rowCount){const current=(await query('SELECT access_encrypted FROM crm_connections WHERE id=$1 AND business_id=$2',[connection.id,connection.business_id])).rows[0];if(!current)throw new AppError('HubSpot connection is missing.',409,'CRM_REAUTHORIZE');return decryptSecret(current.access_encrypted);}
  return result.access_token;
}

export async function hubspotStart(request){
  try{
    const session=await requireSession(request);
    if(session.role!=='Owner')throw new AppError('Only the owner can connect HubSpot.',403,'FORBIDDEN');
    await assertWorkspaceFeature('crm_sync',session.businessId);
    if(!configured())throw new AppError('HubSpot OAuth is not configured.',503,'CRM_NOT_CONFIGURED');
    const state=crypto.randomBytes(32).toString('hex');
    await query("INSERT INTO crm_oauth_states(state_hash,business_id,user_id,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '10 minutes')",[digest(state),session.businessId,session.userId]);
    const url=new URL('https://app.hubspot.com/oauth/authorize');
    url.search=new URLSearchParams({client_id:process.env.HUBSPOT_CLIENT_ID,redirect_uri:redirectUri(),scope:scopes.join(' '),state}).toString();
    return Response.redirect(url,303);
  }catch(error){return errorJson(error);}
}

export async function hubspotCallback(request){
  try{
    const session=await requireSession(request);
    if(session.role!=='Owner')throw new AppError('Only the owner can connect HubSpot.',403,'FORBIDDEN');
    const params=new URL(request.url).searchParams,state=params.get('state'),code=params.get('code');
    if(!/^[a-f0-9]{64}$/.test(state||'')||typeof code!=='string'||code.length<10||code.length>4096||params.has('error'))throw new AppError('HubSpot authorization was not completed.',400,'CRM_AUTH_FAILED');
    const consumed=await query("DELETE FROM crm_oauth_states WHERE state_hash=$1 AND business_id=$2 AND user_id=$3 AND expires_at>NOW() AND code_verifier_encrypted='' RETURNING state_hash",[digest(state),session.businessId,session.userId]);
    if(!consumed.rowCount)throw new AppError('HubSpot authorization expired. Start again.',409,'CRM_AUTH_EXPIRED');
    const result=await hubspotJson('/oauth/2026-03/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',client_id:process.env.HUBSPOT_CLIENT_ID,client_secret:process.env.HUBSPOT_CLIENT_SECRET,redirect_uri:redirectUri(),code})});
    if(typeof result.access_token!=='string'||!result.access_token||typeof result.refresh_token!=='string'||!result.refresh_token||!Number.isInteger(result.expires_in)||result.expires_in<60||!/^\d+$/.test(String(result.hub_id||''))||Array.isArray(result.scopes)&&scopes.some(scope=>!result.scopes.includes(scope)))throw new AppError('HubSpot did not grant the required contact scopes.',409,'CRM_AUTH_FAILED');
    await transaction(async client=>{
      const existing=(await client.query("SELECT id,external_account_id FROM crm_connections WHERE business_id=$1 AND provider='hubspot' FOR UPDATE",[session.businessId])).rows[0];
      if(existing&&existing.external_account_id!==String(result.hub_id))throw new AppError('Disconnect the previous HubSpot account before connecting another.',409,'CRM_ACCOUNT_CHANGED');
      await client.query("INSERT INTO crm_connections(id,business_id,provider,external_account_id,access_encrypted,refresh_encrypted,expires_at) VALUES($1,$2,'hubspot',$3,$4,$5,NOW()+$6*INTERVAL '1 second') ON CONFLICT(business_id,provider) DO UPDATE SET access_encrypted=EXCLUDED.access_encrypted,refresh_encrypted=EXCLUDED.refresh_encrypted,expires_at=EXCLUDED.expires_at,updated_at=NOW()",[existing?.id||id('crmc'),session.businessId,String(result.hub_id),encryptSecret(result.access_token),encryptSecret(result.refresh_token),result.expires_in]);
      await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'hubspot_connected',JSON.stringify({hubId:result.hub_id})]);
    });
    return Response.redirect(new URL('/app/settings/whatsapp',process.env.APP_URL),303);
  }catch(error){return errorJson(error);}
}

export async function importCrmContactPage(connection,items,cursor,normalize=normalizeHubSpotContact,cursorField='cursor'){
  if(!['cursor','lead_cursor'].includes(cursorField))throw new AppError('Invalid CRM cursor field.',400,'CRM_INVALID_CURSOR');
  let imported=0,linked=0,conflicts=0,skipped=0;
  await transaction(async client=>{
    for(const raw of items){
      const contact=normalize(raw);
      if(!contact){skipped++;continue;}
      const existingLink=(await client.query('SELECT * FROM crm_contact_links WHERE business_id=$1 AND connection_id=$2 AND external_id=$3 FOR UPDATE',[connection.business_id,connection.id,contact.externalId])).rows[0];
      if(existingLink){
        if(existingLink.external_object_type!==(contact.objectType||'Contact')){conflicts++;continue;}
        const local=(await client.query('SELECT c.id,c.name,c.phone,c.updated_at,c.updated_at>l.local_synced_at AS locally_changed FROM contacts c JOIN crm_contact_links l ON l.contact_id=c.id AND l.business_id=c.business_id WHERE c.business_id=$1 AND c.id=$2 AND l.connection_id=$3 FOR UPDATE OF c',[connection.business_id,existingLink.contact_id,connection.id])).rows[0];
        if(!local||local.phone!==contact.phone||local.locally_changed){conflicts++;continue;}
        if(local.name!==contact.name){
          const changed=(await client.query('UPDATE contacts SET name=$1,updated_at=NOW() WHERE business_id=$2 AND id=$3 RETURNING updated_at',[contact.name,connection.business_id,local.id])).rows[0];
          local.updated_at=changed.updated_at;
        }
        await client.query('UPDATE crm_contact_links l SET external_updated_at=$1,local_synced_at=c.updated_at,account_external_id=$5 FROM contacts c WHERE l.business_id=$2 AND l.connection_id=$3 AND l.external_id=$4 AND c.id=l.contact_id AND c.business_id=l.business_id',[contact.updatedAt,connection.business_id,connection.id,contact.externalId,contact.accountExternalId||'']);
        linked++;continue;
      }
      const inserted=await client.query("INSERT INTO contacts(id,business_id,name,phone,source) VALUES($1,$2,$3,$4,$5) ON CONFLICT(business_id,phone) DO NOTHING RETURNING id",[id('ct'),connection.business_id,contact.name,contact.phone,connection.provider==='salesforce'?'Salesforce':'HubSpot']);
      const local=(await client.query('SELECT id,updated_at FROM contacts WHERE business_id=$1 AND phone=$2 FOR UPDATE',[connection.business_id,contact.phone])).rows[0];
      const linkedElsewhere=(await client.query('SELECT 1 FROM crm_contact_links WHERE connection_id=$1 AND contact_id=$2',[connection.id,local.id])).rowCount;
      if(linkedElsewhere){conflicts++;continue;}
      await client.query('INSERT INTO crm_contact_links(business_id,connection_id,external_id,contact_id,phone_snapshot,external_updated_at,local_synced_at,external_object_type,account_external_id) SELECT $1,$2,$3,c.id,$4,$5,c.updated_at,$7,$8 FROM contacts c WHERE c.business_id=$1 AND c.id=$6',[connection.business_id,connection.id,contact.externalId,contact.phone,contact.updatedAt,local.id,contact.objectType||'Contact',contact.accountExternalId||'']);
      if(inserted.rowCount)imported++;else linked++;
    }
    await client.query(`UPDATE crm_connections SET ${cursorField}=$1,last_sync_at=NOW(),last_error='',updated_at=NOW() WHERE business_id=$2 AND id=$3`,[cursor,connection.business_id,connection.id]);
  });
  return {imported,linked,conflicts,skipped};
}

export async function exportOutboundHubSpotContact(connection, contact) {
  const phone = String(contact.phone || '').replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(phone)) return null;
  const company = tenantDisplayName(contact);
  if (!company) return null;
  const token = await tokenFor(connection);
  const created = await hubspotJson('/crm/objects/2026-03/contacts', {
    method: 'POST',
    token,
    body: {
      properties: {
        ...hubspotName(contact.name),
        phone: `+${phone}`,
        company: company.slice(0, 255)
      }
    }
  });
  if (!/^\d{1,32}$/.test(String(created.id || ''))) return null;
  await query(
    `INSERT INTO crm_contact_links(business_id,connection_id,external_id,contact_id,phone_snapshot,external_updated_at,local_synced_at,external_object_type)
     VALUES($1,$2,$3,$4,$5,$6,NOW(),'Contact') ON CONFLICT DO NOTHING`,
    [connection.business_id, connection.id, String(created.id), contact.id, contact.phone, created.updatedAt || new Date().toISOString()]
  );
  return String(created.id);
}

export async function syncHubSpotContacts(businessId){
  const claim=await query("UPDATE crm_connections SET sync_claimed_at=NOW(),last_attempt_at=NOW() WHERE business_id=$1 AND provider='hubspot' AND enabled AND (sync_claimed_at IS NULL OR sync_claimed_at<NOW()-INTERVAL '2 minutes') RETURNING *",[businessId]);
  const connection=claim.rows[0];
  if(!connection)throw new AppError('HubSpot is disconnected or sync is in progress.',409,'CRM_SYNC_UNAVAILABLE');
  try{
    const token=await tokenFor(connection);
    const params=new URLSearchParams({limit:'100',properties:'phone,firstname,lastname'});
    if(connection.cursor)params.set('after',connection.cursor);
    const page=await hubspotJson('/crm/objects/2026-03/contacts?'+params,{token});
    if(!Array.isArray(page.results)||page.results.length>100||page.paging?.next?.after&&String(page.paging.next.after).length>256)throw new AppError('HubSpot returned an invalid contacts page.',502,'CRM_INVALID_RESPONSE');
    const counts=await importCrmContactPage(connection,page.results,String(page.paging?.next?.after||''));
    const candidates=(await query(`SELECT l.external_id,l.phone_snapshot,c.id,c.name,c.phone,c.xmin::text AS row_version FROM crm_contact_links l JOIN contacts c ON c.id=l.contact_id AND c.business_id=l.business_id
      WHERE l.business_id=$1 AND l.connection_id=$2 AND c.updated_at>l.local_synced_at AND c.phone=l.phone_snapshot ORDER BY c.updated_at,c.id LIMIT 5`,[businessId,connection.id])).rows;
    let exported=0;
    for(const contact of candidates){
      const result=await hubspotJson('/crm/objects/2026-03/contacts/'+encodeURIComponent(contact.external_id),{method:'PATCH',token,body:{properties:hubspotName(contact.name)}});
      if(String(result.id)!==contact.external_id)throw new AppError('HubSpot did not confirm the contact update.',409,'CRM_UNCONFIRMED');
      await query(`UPDATE crm_contact_links l SET local_synced_at=c.updated_at,external_updated_at=$1 FROM contacts c
        WHERE l.connection_id=$2 AND l.business_id=$3 AND l.external_id=$4 AND c.id=l.contact_id AND c.business_id=l.business_id AND c.xmin::text=$5 AND c.phone=l.phone_snapshot`,[result.updatedAt||new Date().toISOString(),connection.id,businessId,contact.external_id,contact.row_version]);
      exported++;
    }
    const objects=connection.sync_objects_enabled?await syncHubSpotObjects(connection,token):null;
    return {...counts,exported,hasMore:Boolean(page.paging?.next?.after),...(objects?{objects}:{})};
  }catch(error){await query('UPDATE crm_connections SET last_error=$1,updated_at=NOW() WHERE id=$2 AND business_id=$3',[error.code||'CRM_SYNC_FAILED',connection.id,businessId]);throw error;}
  finally{await query('UPDATE crm_connections SET sync_claimed_at=NULL WHERE id=$1 AND business_id=$2',[connection.id,businessId]);}
}

async function syncHubSpotObjects(connection,token){
  const result={};
  for(const [kind,objectName,properties] of [['company','companies','name,domain,industry'],['deal','deals','dealname,dealstage,amount,deal_currency_code,closedate']]){
    const previous=await crmObjectCursor(connection,kind);
    const params=new URLSearchParams({limit:'100',properties,associations:'contacts'});
    if(previous.cursor)params.set('after',previous.cursor);
    const page=await hubspotJson(`/crm/objects/2026-03/${objectName}?${params}`,{token});
    if(!Array.isArray(page.results)||page.results.length>100||page.paging?.next?.after&&String(page.paging.next.after).length>256)throw new AppError('HubSpot returned an invalid object page.',502,'CRM_INVALID_RESPONSE');
    result[kind]=await storeCrmObjectPage(connection,kind,page.results,{cursor:String(page.paging?.next?.after||'')});
    const archivedParams=new URLSearchParams({limit:'100',archived:'true',properties});
    if(previous.archived_cursor)archivedParams.set('after',previous.archived_cursor);
    const archived=await hubspotJson(`/crm/objects/2026-03/${objectName}?${archivedParams}`,{token});
    if(!Array.isArray(archived.results)||archived.results.length>100||archived.paging?.next?.after&&String(archived.paging.next.after).length>256)throw new AppError('HubSpot returned an invalid archived object page.',502,'CRM_INVALID_RESPONSE');
    await archiveCrmObjectPage(connection,kind,archived.results,{cursor:String(archived.paging?.next?.after||'')});
  }
  return result;
}

export async function hubspotSettings(request){
  try{
    const session=await requireSession(request);
    if(session.role!=='Owner')throw new AppError('Only the owner can manage CRM synchronization.',403,'FORBIDDEN');
    await assertWorkspaceFeature('crm_sync',session.businessId);
    if(request.method==='GET'){
      const connection=(await query("SELECT id,external_account_id,enabled,sync_outbound_enabled,sync_outbound_objects_enabled,sync_objects_enabled,last_sync_at,last_error,updated_at FROM crm_connections WHERE business_id=$1 AND provider='hubspot'",[session.businessId])).rows[0]||null;
      const stats=connection?(await query('SELECT COUNT(*)::int AS linked FROM crm_contact_links WHERE business_id=$1 AND connection_id=$2',[session.businessId,connection.id])).rows[0]:null;
      return json({connection,stats,configured:configured(),...(connection?await crmObjectSettings(session.businessId,connection.id):{})});
    }
    const body=await readJsonBodyLimited(request,4096);
    if(body.action==='toggle'){
      if(typeof body.enabled!=='boolean')throw new AppError('Choose a valid sync status.',400,'CRM_INVALID_ACTION');
      const result=await query("UPDATE crm_connections SET enabled=$1,updated_at=NOW() WHERE business_id=$2 AND provider='hubspot' RETURNING id",[body.enabled,session.businessId]);
      if(!result.rowCount)throw new AppError('Connect HubSpot first.',409,'CRM_NOT_CONNECTED');
      await query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'hubspot_sync_toggled',JSON.stringify({enabled:body.enabled})]);
      return json({ok:true});
    }
    if(body.action==='toggle_outbound'){
      if(typeof body.syncOutboundEnabled!=='boolean')throw new AppError('Choose a valid outbound sync status.',400,'CRM_INVALID_ACTION');
      const result=await query("UPDATE crm_connections SET sync_outbound_enabled=$1,updated_at=NOW() WHERE business_id=$2 AND provider='hubspot' RETURNING id",[body.syncOutboundEnabled,session.businessId]);
      if(!result.rowCount)throw new AppError('Connect HubSpot first.',409,'CRM_NOT_CONNECTED');
      return json({ok:true});
    }
    if(body.action==='toggle_outbound_objects'){
      if(typeof body.syncOutboundObjectsEnabled!=='boolean')throw new AppError('Choose a valid object push status.',400,'CRM_INVALID_ACTION');
      const result=await query("UPDATE crm_connections SET sync_outbound_objects_enabled=$1,updated_at=NOW() WHERE business_id=$2 AND provider='hubspot' RETURNING id",[body.syncOutboundObjectsEnabled,session.businessId]);
      if(!result.rowCount)throw new AppError('Connect HubSpot first.',409,'CRM_NOT_CONNECTED');
      return json({ok:true});
    }
    if(body.action==='sync'){
      const result=await syncHubSpotContacts(session.businessId);
      await query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'hubspot_sync_run',JSON.stringify(result)]);
      return json(result);
    }
    if(body.action==='sync_objects'){
      await setCrmObjectSync(session,'hubspot',body.enabled);
      return json({ok:true});
    }
    if(body.action==='map_field'||body.action==='remove_field_mapping'){
      const connection=(await query("SELECT id,provider FROM crm_connections WHERE business_id=$1 AND provider='hubspot'",[session.businessId])).rows[0];
      if(!connection)throw new AppError('Connect HubSpot first.',409,'CRM_NOT_CONNECTED');
      if(body.action==='map_field')await saveCrmFieldMapping(session,connection,body);
      else await removeCrmFieldMapping(session,connection,body);
      return json({ok:true});
    }
    throw new AppError('Unsupported CRM action.',400,'CRM_INVALID_ACTION');
  }catch(error){return errorJson(error);}
}

export async function patchHubSpotCrmObject(connection, kind, externalId, properties) {
  if (!properties || !Object.keys(properties).length) return false;
  const token = await tokenFor(connection);
  const type = kind === 'company' ? 'companies' : 'deals';
  await hubspotJson(`/crm/v3/objects/${type}/${externalId}`, { method: 'PATCH', token, body: { properties } });
  return true;
}

export async function runDueHubSpotSync(){
  if(!(await workspaceFeatureFlags()).crm_sync)return {attempted:0,failed:0};
  const due=(await query("SELECT c.business_id FROM crm_connections c JOIN businesses b ON b.id=c.business_id WHERE c.provider='hubspot' AND c.enabled AND b.account_status<>'suspended' AND b.feature_overrides->>'crm_sync' IS DISTINCT FROM 'false' AND NOT EXISTS (SELECT 1 FROM workspace_deletion_requests d WHERE d.business_id=b.id AND d.status IN ('scheduled','pending_approval')) AND (c.last_attempt_at IS NULL OR c.last_attempt_at<NOW()-INTERVAL '5 minutes') AND (c.sync_claimed_at IS NULL OR c.sync_claimed_at<NOW()-INTERVAL '2 minutes') ORDER BY c.last_attempt_at NULLS FIRST,c.id LIMIT 1")).rows[0];
  if(!due)return {attempted:0,failed:0};
  try{await syncHubSpotContacts(due.business_id);return {attempted:1,failed:0};}
  catch(error){return {attempted:1,failed:1,code:error.code||'CRM_SYNC_FAILED'};}
}

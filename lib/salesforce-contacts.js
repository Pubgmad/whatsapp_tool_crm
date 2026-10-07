import crypto from 'node:crypto';
import {requireSession} from './auth.js';
import {AppError,query,transaction,id,json,errorJson} from './db.js';
import {encryptSecret,decryptSecret} from './meta.js';
import {readJsonBodyLimited,readTextBodyLimited} from './security.js';
import {assertWorkspaceFeature,workspaceFeatureFlags} from './feature-controls.js';
import {importCrmContactPage} from './hubspot-contacts.js';
import {archiveCrmObjectPage,clearCrmMappedAttributes,crmObjectCursor,crmObjectSettings,reconcileSalesforceAccountLinks,removeCrmFieldMapping,saveCrmFieldMapping,setCrmObjectSync,storeCrmObjectPage} from './crm-objects.js';
import {crmLeadDescription,tenantDisplayName} from './crm-outbound-context.js';

const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const configured=()=>Boolean(process.env.SALESFORCE_CLIENT_ID?.trim()&&process.env.SALESFORCE_CLIENT_SECRET?.trim()&&/^\d{2,3}\.0$/.test(process.env.SALESFORCE_API_VERSION||''));
const loginBase=()=>{
  const configured=process.env.SALESFORCE_LOGIN_URL?.trim()||'https://login.salesforce.com';
  if(!['https://login.salesforce.com','https://test.salesforce.com'].includes(configured))throw new AppError('Use an official Salesforce login endpoint.',503,'CRM_NOT_CONFIGURED');
  return configured;
};
const redirectUri=()=>{
  let url;try{url=new URL(process.env.APP_URL||'');}catch{throw new AppError('Configure APP_URL first.',503,'CRM_NOT_CONFIGURED');}
  if(url.protocol!=='https:')throw new AppError('Use a public HTTPS APP_URL for Salesforce OAuth.',503,'CRM_NOT_CONFIGURED');
  return new URL('/api/crm/salesforce/callback',url).href;
};

export function salesforceInstance(value){
  let url;try{url=new URL(value);}catch{throw new AppError('Salesforce returned an invalid instance.',409,'CRM_AUTH_FAILED');}
  if(url.protocol!=='https:'||url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.salesforce\.com$/i.test(url.hostname))throw new AppError('Salesforce returned an untrusted instance.',409,'CRM_AUTH_FAILED');
  return url.origin;
}

export function normalizeSalesforceContact(value){
  if(!/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(String(value?.Id||'')))return null;
  const phone=String(value.MobilePhone||value.Phone||'').trim();
  if(!/^\+[1-9]\d{7,14}$/.test(phone))return null;
  const at=new Date(value.LastModifiedDate);
  if(!Number.isFinite(at.getTime()))return null;
  const name=[value.FirstName,value.LastName].filter(part=>typeof part==='string'&&part.trim()).join(' ').trim().slice(0,120)||phone;
  return {externalId:value.Id,phone:phone.slice(1),name,updatedAt:at.toISOString(),...(/^001[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(value.AccountId||'')?{accountExternalId:value.AccountId}:{})};
}

export function normalizeSalesforceLead(value){
  if(value?.IsConverted!==false||!/^00Q[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(String(value?.Id||'')))return null;
  const contact=normalizeSalesforceContact(value);
  return contact?{...contact,objectType:'Lead'}:null;
}

function modifiedAfter(value){
  if(!value)return '';
  const at=new Date(value);
  if(!Number.isFinite(at.getTime()))throw new AppError('Invalid Salesforce sync watermark.',409,'CRM_INVALID_CURSOR');
  return ` AND LastModifiedDate >= ${at.toISOString().replace(/\.\d{3}Z$/,'Z')}`;
}

async function saveWatermark(connection,field,records){
  const valid=records.map(item=>new Date(item.LastModifiedDate)).filter(date=>Number.isFinite(date.getTime()));
  if(!valid.length)return;
  const latest=new Date(Math.max(...valid.map(date=>date.getTime())));
  await query(`UPDATE crm_connections SET ${field}=GREATEST(COALESCE(${field},'-infinity'::timestamptz),$1::timestamptz) WHERE id=$2 AND business_id=$3`,[latest.toISOString(),connection.id,connection.business_id]);
}

async function requestJson(url,{method='GET',token,body,headers={}}={}){
  let response;try{response=await fetch(url,{method,headers:{...(token?{authorization:`Bearer ${token}`} :{}),...headers,...(body?{'content-type':body instanceof URLSearchParams?'application/x-www-form-urlencoded':'application/json'}:{})},...(body?{body:body instanceof URLSearchParams?body:JSON.stringify(body)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});}catch{throw new AppError('Salesforce is temporarily unreachable.',503,'CRM_UNREACHABLE');}
  if(response.status===204)return {};
  let data;try{data=JSON.parse(await readTextBodyLimited(response,500000));}catch{throw new AppError('Salesforce response could not be verified.',502,'CRM_INVALID_RESPONSE');}
  if(!response.ok)throw new AppError(response.status===401||response.status===403?'Reconnect Salesforce.':'Salesforce rejected the request.',response.status===401||response.status===403?409:response.status===429?429:502,response.status===401||response.status===403?'CRM_REAUTHORIZE':response.status===429?'CRM_RATE_LIMIT':'CRM_PROVIDER_ERROR');
  return data;
}

export async function exportOutboundSalesforceLead(connection, contact) {
  const phone = String(contact.phone || '').replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(phone)) return null;
  const company = tenantDisplayName(contact);
  if (!company) return null;
  const token = await tokenFor(connection);
  const version = process.env.SALESFORCE_API_VERSION;
  const base = salesforceInstance(connection.instance_url);
  const parts = String(contact.name || '').trim().split(/\s+/);
  const first = parts.length > 1 ? parts.shift() : '';
  const last = parts.join(' ') || parts[0] || phone;
  const leadSource = String(contact.source || '').slice(0, 40);
  const description = crmLeadDescription(contact);
  const created = await requestJson(`${base}/services/data/v${version}/sobjects/Lead`, {
    method: 'POST',
    token,
    body: {
      FirstName: first.slice(0, 40),
      LastName: last.slice(0, 80),
      MobilePhone: `+${phone}`,
      Company: company.slice(0, 80),
      ...(leadSource ? { LeadSource: leadSource } : {}),
      ...(description ? { Description: description.slice(0, 32000) } : {})
    }
  });
  if (!/^00Q[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(String(created.id || ''))) return null;
  await query(
    `INSERT INTO crm_contact_links(business_id,connection_id,external_id,contact_id,phone_snapshot,external_updated_at,local_synced_at,external_object_type)
     VALUES($1,$2,$3,$4,$5,NOW(),NOW(),'Lead') ON CONFLICT DO NOTHING`,
    [connection.business_id, connection.id, String(created.id), contact.id, contact.phone]
  );
  return String(created.id);
}

async function tokenFor(connection){
  if(new Date(connection.expires_at).getTime()>Date.now()+60000)return decryptSecret(connection.access_encrypted);
  if(!configured())throw new AppError('Salesforce OAuth is not configured.',503,'CRM_NOT_CONFIGURED');
  const old=connection.refresh_encrypted;
  const result=await requestJson(loginBase()+'/services/oauth2/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:process.env.SALESFORCE_CLIENT_ID,client_secret:process.env.SALESFORCE_CLIENT_SECRET,refresh_token:decryptSecret(old)})});
  if(typeof result.access_token!=='string'||!result.access_token)throw new AppError('Reconnect Salesforce.',409,'CRM_REAUTHORIZE');
  const nextRefresh=typeof result.refresh_token==='string'&&result.refresh_token?encryptSecret(result.refresh_token):old;
  const expires=Number.isInteger(result.expires_in)&&result.expires_in>60?result.expires_in:0;
  const changed=await query("UPDATE crm_connections SET access_encrypted=$1,refresh_encrypted=$2,expires_at=NOW()+$3*INTERVAL '1 second',updated_at=NOW() WHERE id=$4 AND business_id=$5 AND refresh_encrypted=$6 RETURNING id",[encryptSecret(result.access_token),nextRefresh,expires,connection.id,connection.business_id,old]);
  if(!changed.rowCount){const current=(await query('SELECT access_encrypted FROM crm_connections WHERE id=$1 AND business_id=$2',[connection.id,connection.business_id])).rows[0];if(!current)throw new AppError('Salesforce connection was removed.',409,'CRM_REAUTHORIZE');return decryptSecret(current.access_encrypted);}
  return result.access_token;
}

export async function salesforceStart(request){
  try{
    const session=await requireSession(request);
    if(session.role!=='Owner')throw new AppError('Only the owner can connect Salesforce.',403,'FORBIDDEN');
    await assertWorkspaceFeature('crm_sync',session.businessId);
    if(!configured())throw new AppError('Salesforce OAuth is not configured.',503,'CRM_NOT_CONFIGURED');
    const state=crypto.randomBytes(32).toString('hex'),verifier=crypto.randomBytes(32).toString('base64url');
    await query("INSERT INTO crm_oauth_states(state_hash,business_id,user_id,code_verifier_encrypted,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '10 minutes')",[digest(state),session.businessId,session.userId,encryptSecret(verifier)]);
    const url=new URL(loginBase()+'/services/oauth2/authorize');
    url.search=new URLSearchParams({response_type:'code',client_id:process.env.SALESFORCE_CLIENT_ID,redirect_uri:redirectUri(),scope:'api refresh_token',state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
    return Response.redirect(url,303);
  }catch(error){return errorJson(error);}
}

export async function salesforceCallback(request){
  try{
    const session=await requireSession(request);
    if(session.role!=='Owner')throw new AppError('Only the owner can connect Salesforce.',403,'FORBIDDEN');
    const params=new URL(request.url).searchParams,state=params.get('state'),code=params.get('code');
    if(!/^[a-f0-9]{64}$/.test(state||'')||typeof code!=='string'||code.length<10||code.length>4096||params.has('error'))throw new AppError('Salesforce authorization was not completed.',400,'CRM_AUTH_FAILED');
    const used=await query('DELETE FROM crm_oauth_states WHERE state_hash=$1 AND business_id=$2 AND user_id=$3 AND expires_at>NOW() AND code_verifier_encrypted<>\'\' RETURNING code_verifier_encrypted',[digest(state),session.businessId,session.userId]);
    if(!used.rowCount)throw new AppError('Salesforce authorization expired.',409,'CRM_AUTH_EXPIRED');
    const result=await requestJson(loginBase()+'/services/oauth2/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',client_id:process.env.SALESFORCE_CLIENT_ID,client_secret:process.env.SALESFORCE_CLIENT_SECRET,redirect_uri:redirectUri(),code,code_verifier:decryptSecret(used.rows[0].code_verifier_encrypted)})});
    const instance=salesforceInstance(result.instance_url);
    let identity;try{identity=new URL(result.id||'');}catch{throw new AppError('Salesforce did not return a valid org identity.',409,'CRM_AUTH_FAILED');}
    const match=/^\/id\/(00D[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?)\/[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.exec(identity.pathname);
    if(!match||identity.protocol!=='https:'||!identity.hostname.endsWith('.salesforce.com')||!result.access_token||!result.refresh_token)throw new AppError('Salesforce did not grant the required API and refresh access.',409,'CRM_AUTH_FAILED');
    const expires=Number.isInteger(result.expires_in)&&result.expires_in>60?result.expires_in:0;
    await transaction(async client=>{
      const existing=(await client.query("SELECT id,external_account_id FROM crm_connections WHERE business_id=$1 AND provider='salesforce' FOR UPDATE",[session.businessId])).rows[0];
      if(existing&&existing.external_account_id!==match[1])throw new AppError('Disconnect the previous Salesforce org before connecting another.',409,'CRM_ACCOUNT_CHANGED');
      await client.query("INSERT INTO crm_connections(id,business_id,provider,external_account_id,instance_url,access_encrypted,refresh_encrypted,expires_at) VALUES($1,$2,'salesforce',$3,$4,$5,$6,NOW()+$7*INTERVAL '1 second') ON CONFLICT(business_id,provider) DO UPDATE SET instance_url=EXCLUDED.instance_url,access_encrypted=EXCLUDED.access_encrypted,refresh_encrypted=EXCLUDED.refresh_encrypted,expires_at=EXCLUDED.expires_at,updated_at=NOW()",[existing?.id||id('crmc'),session.businessId,match[1],instance,encryptSecret(result.access_token),encryptSecret(result.refresh_token),expires]);
      await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'salesforce_connected',JSON.stringify({orgId:match[1]})]);
    });
    return Response.redirect(new URL('/app/settings/whatsapp',process.env.APP_URL),303);
  }catch(error){return errorJson(error);}
}

export async function syncSalesforceContacts(businessId){
  const claim=await query("UPDATE crm_connections SET sync_claimed_at=NOW(),last_attempt_at=NOW() WHERE business_id=$1 AND provider='salesforce' AND enabled AND (sync_claimed_at IS NULL OR sync_claimed_at<NOW()-INTERVAL '2 minutes') RETURNING *",[businessId]);
  const connection=claim.rows[0];
  if(!connection)throw new AppError('Salesforce is disconnected or sync is in progress.',409,'CRM_SYNC_UNAVAILABLE');
  try{
    const token=await tokenFor(connection),base=salesforceInstance(connection.instance_url),version=process.env.SALESFORCE_API_VERSION;
    if(!/^\d{2,3}\.0$/.test(version||''))throw new AppError('Configure Salesforce API version.',503,'CRM_NOT_CONFIGURED');
    const root=`/services/data/v${version}/query`;
    const sql=`SELECT Id, FirstName, LastName, MobilePhone, Phone, AccountId, LastModifiedDate FROM Contact WHERE (MobilePhone != null OR Phone != null)${modifiedAfter(connection.contact_watermark)} ORDER BY LastModifiedDate ASC, Id ASC`;
    const path=connection.cursor||`${root}?q=${encodeURIComponent(sql)}`;
    if(!path.startsWith(root+'?q=')&&!new RegExp(`^${root.replaceAll('.','\\.')}/[a-zA-Z0-9-]+$`).test(path))throw new AppError('Invalid Salesforce cursor.',409,'CRM_INVALID_CURSOR');
    const page=await requestJson(base+path,{token,headers:{'Sforce-Query-Options':'batchSize=200'}});
    if(!Array.isArray(page.records)||page.records.length>200||typeof page.done!=='boolean')throw new AppError('Salesforce returned an invalid contacts page.',502,'CRM_INVALID_RESPONSE');
    const next=page.done?'':String(page.nextRecordsUrl||'');
    if(next&&(!next.startsWith(root+'/')||next.length>256))throw new AppError('Salesforce returned an invalid cursor.',502,'CRM_INVALID_RESPONSE');
    const counts=await importCrmContactPage(connection,page.records,next,normalizeSalesforceContact);
    if(page.done)await saveWatermark(connection,'contact_watermark',page.records);
    if(connection.sync_leads_enabled){
      const leadSql=`SELECT Id, FirstName, LastName, MobilePhone, Phone, LastModifiedDate, IsConverted FROM Lead WHERE IsConverted = false AND (MobilePhone != null OR Phone != null)${modifiedAfter(connection.lead_watermark)} ORDER BY LastModifiedDate ASC, Id ASC`;
      const leadPath=connection.lead_cursor||`${root}?q=${encodeURIComponent(leadSql)}`;
      if(!leadPath.startsWith(root+'?q=')&&!new RegExp(`^${root.replaceAll('.','\\.')}/[a-zA-Z0-9-]+$`).test(leadPath))throw new AppError('Invalid Salesforce Lead cursor.',409,'CRM_INVALID_CURSOR');
      const leadPage=await requestJson(base+leadPath,{token,headers:{'Sforce-Query-Options':'batchSize=200'}});
      if(!Array.isArray(leadPage.records)||leadPage.records.length>200||typeof leadPage.done!=='boolean')throw new AppError('Salesforce returned an invalid Leads page.',502,'CRM_INVALID_RESPONSE');
      const leadNext=leadPage.done?'':String(leadPage.nextRecordsUrl||'');
      if(leadNext&&(!leadNext.startsWith(root+'/')||leadNext.length>256))throw new AppError('Salesforce returned an invalid Lead cursor.',502,'CRM_INVALID_RESPONSE');
      const leadCounts=await importCrmContactPage(connection,leadPage.records,leadNext,normalizeSalesforceLead,'lead_cursor');
      if(leadPage.done)await saveWatermark(connection,'lead_watermark',leadPage.records);
      for(const key of ['imported','linked','conflicts','skipped'])counts[key]+=leadCounts[key];
      counts.hasMoreLeads=Boolean(leadNext);
    }
    const candidates=(await query(`SELECT l.external_id,l.external_object_type,l.phone_snapshot,l.external_updated_at,c.id,c.name,c.phone,c.xmin::text AS row_version FROM crm_contact_links l JOIN contacts c ON c.id=l.contact_id AND c.business_id=l.business_id
      WHERE l.business_id=$1 AND l.connection_id=$2 AND (l.external_object_type='Contact' OR $3::boolean)
        AND c.updated_at>l.local_synced_at AND c.phone=l.phone_snapshot ORDER BY c.updated_at,c.id LIMIT 5`,[businessId,connection.id,connection.sync_leads_enabled])).rows;
    let exported=0,conflicts=counts.conflicts;
    for(const contact of candidates){
      const objectType=contact.external_object_type==='Lead'?'Lead':'Contact';
      const path=`/services/data/v${version}/sobjects/${objectType}/${encodeURIComponent(contact.external_id)}`;
      const remote=await requestJson(base+path,{token});
      if(objectType==='Lead'&&remote.IsConverted!==false){conflicts++;continue;}
      const remoteChanged=new Date(remote.LastModifiedDate);
      if(!Number.isFinite(remoteChanged.getTime()))throw new AppError('Salesforce contact version could not be verified.',502,'CRM_INVALID_RESPONSE');
      if(remoteChanged.getTime()>new Date(contact.external_updated_at||0).getTime()){conflicts++;continue;}
      const parts=String(contact.name||'').trim().split(/\s+/),first=parts.length>1?parts.shift():'',last=parts.join(' ')||parts[0];
      await requestJson(base+path,{method:'PATCH',token,headers:{'if-unmodified-since':remoteChanged.toUTCString()},body:{FirstName:first.slice(0,40),LastName:last.slice(0,80)}});
      await query(`UPDATE crm_contact_links l SET local_synced_at=c.updated_at,external_updated_at=NOW() FROM contacts c
        WHERE l.connection_id=$1 AND l.business_id=$2 AND l.external_id=$3 AND c.id=l.contact_id AND c.business_id=l.business_id AND c.xmin::text=$4 AND c.phone=l.phone_snapshot`,[connection.id,businessId,contact.external_id,contact.row_version]);
      exported++;
    }
    const objects=connection.sync_objects_enabled?await syncSalesforceObjects(connection,token,base,version):null;
    if(objects)await reconcileSalesforceAccountLinks(connection);
    return {...counts,conflicts,exported,hasMore:Boolean(next)||Boolean(counts.hasMoreLeads),...(objects?{objects}:{})};
  }catch(error){await query('UPDATE crm_connections SET last_error=$1,updated_at=NOW() WHERE id=$2 AND business_id=$3',[error.code||'CRM_SYNC_FAILED',connection.id,businessId]);throw error;}
  finally{await query('UPDATE crm_connections SET sync_claimed_at=NULL WHERE id=$1 AND business_id=$2',[connection.id,businessId]);}
}

async function syncSalesforceObjects(connection,token,base,version){
  const result={},root=`/services/data/v${version}/query`,allRoot=`/services/data/v${version}/queryAll`;
  for(const [kind,objectName,fields] of [['company','Account','Id, Name, Website, Industry, LastModifiedDate, IsDeleted'],['deal','Opportunity','Id, Name, StageName, Amount, CloseDate, LastModifiedDate, IsDeleted']]){
    const previous=await crmObjectCursor(connection,kind);
    const sql=`SELECT ${fields} FROM ${objectName} WHERE LastModifiedDate != null${modifiedAfter(previous.watermark)} ORDER BY LastModifiedDate ASC, Id ASC`;
    const path=previous.cursor||`${allRoot}?q=${encodeURIComponent(sql)}`;
    if(!path.startsWith(allRoot+'?q=')&&!new RegExp(`^/services/data/v${version.replace('.','\\.')}/query(?:All)?/[a-zA-Z0-9-]+$`).test(path))throw new AppError('Invalid Salesforce object cursor.',409,'CRM_INVALID_CURSOR');
    const page=await requestJson(base+path,{token,headers:{'Sforce-Query-Options':'batchSize=200'}});
    if(!Array.isArray(page.records)||page.records.length>200||typeof page.done!=='boolean')throw new AppError('Salesforce returned an invalid object page.',502,'CRM_INVALID_RESPONSE');
    const next=page.done?'':String(page.nextRecordsUrl||'');
    if(next&&(!next.startsWith(root+'/')&&!next.startsWith(allRoot+'/')||next.length>256))throw new AppError('Salesforce returned an invalid object cursor.',502,'CRM_INVALID_RESPONSE');
    const deleted=page.records.filter(item=>item.IsDeleted===true),active=page.records.filter(item=>item.IsDeleted!==true);
    await archiveCrmObjectPage(connection,kind,deleted);
    const ids=active.map(item=>String(item.Id||'')).filter(value=>/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(value));
    const associations={};
    if(ids.length&&kind==='company'){
      const linked=(await query('SELECT external_id,account_external_id FROM crm_contact_links WHERE business_id=$1 AND connection_id=$2 AND account_external_id=ANY($3::text[]) AND external_object_type=\'Contact\'',[connection.business_id,connection.id,ids])).rows;
      for(const row of linked)(associations[row.account_external_id]??=[]).push(row.external_id);
    }
    if(ids.length&&kind==='deal'){
      const rolesSql=`SELECT OpportunityId, ContactId FROM OpportunityContactRole WHERE OpportunityId IN (${ids.map(value=>`'${value}'`).join(',')})`;
      let rolePath=root+'?q='+encodeURIComponent(rolesSql),pages=0;
      do{
        const roles=await requestJson(base+rolePath,{token,headers:{'Sforce-Query-Options':'batchSize=200'}});
        if(!Array.isArray(roles.records)||roles.records.length>200||typeof roles.done!=='boolean')throw new AppError('Salesforce returned invalid opportunity associations.',502,'CRM_INVALID_RESPONSE');
        for(const role of roles.records)if(ids.includes(role.OpportunityId)&&/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(role.ContactId||''))(associations[role.OpportunityId]??=[]).push(role.ContactId);
        rolePath=roles.done?'':String(roles.nextRecordsUrl||'');
        if(rolePath&&(!rolePath.startsWith(root+'/')||rolePath.length>256||++pages>50))throw new AppError('Salesforce association page could not be completed.',502,'CRM_INVALID_RESPONSE');
      }while(rolePath);
    }
    const latest=page.done&&page.records.length?new Date(Math.max(...page.records.map(item=>new Date(item.LastModifiedDate).getTime()))).toISOString():null;
    result[kind]=await storeCrmObjectPage(connection,kind,active,{cursor:next,watermark:latest,associatedContacts:associations});
  }
  return result;
}

export async function patchSalesforceCrmObject(connection, kind, externalId, fields) {
  if (!fields || !Object.keys(fields).length) return false;
  const token = await tokenFor(connection);
  const base = salesforceInstance(connection.instance_url);
  const version = process.env.SALESFORCE_API_VERSION;
  if (!/^\d{2,3}\.0$/.test(version || '')) throw new AppError('Configure Salesforce API version.', 503, 'CRM_NOT_CONFIGURED');
  const object = kind === 'company' ? 'Account' : 'Opportunity';
  await requestJson(`${base}/services/data/v${version}/sobjects/${object}/${externalId}`, { method: 'PATCH', token, body: fields });
  return true;
}

export async function salesforceSettings(request){
  try{
    const session=await requireSession(request);
    if(session.role!=='Owner')throw new AppError('Only the owner can manage Salesforce.',403,'FORBIDDEN');
    await assertWorkspaceFeature('crm_sync',session.businessId);
    if(request.method==='GET'){
      const connection=(await query("SELECT id,external_account_id,enabled,sync_outbound_enabled,sync_outbound_objects_enabled,sync_leads_enabled,sync_objects_enabled,last_sync_at,last_error,updated_at FROM crm_connections WHERE business_id=$1 AND provider='salesforce'",[session.businessId])).rows[0]||null;
      const stats=connection?(await query("SELECT COUNT(*)::int AS linked,COUNT(*) FILTER (WHERE external_object_type='Lead')::int AS linked_leads FROM crm_contact_links WHERE business_id=$1 AND connection_id=$2",[session.businessId,connection.id])).rows[0]:null;
      return json({connection,stats,configured:configured(),...(connection?await crmObjectSettings(session.businessId,connection.id):{})});
    }
    const body=await readJsonBodyLimited(request,4096);
    if(body.action==='toggle'){
      if(typeof body.enabled!=='boolean')throw new AppError('Choose a valid sync status.',400,'CRM_INVALID_ACTION');
      const changed=await query("UPDATE crm_connections SET enabled=$1,updated_at=NOW() WHERE business_id=$2 AND provider='salesforce' RETURNING id",[body.enabled,session.businessId]);
      if(!changed.rowCount)throw new AppError('Connect Salesforce first.',409,'CRM_NOT_CONNECTED');
      await query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'salesforce_sync_toggled',JSON.stringify({enabled:body.enabled})]);
      return json({ok:true});
    }
    if(body.action==='toggle_outbound'){
      if(typeof body.syncOutboundEnabled!=='boolean')throw new AppError('Choose a valid outbound sync status.',400,'CRM_INVALID_ACTION');
      const changed=await query("UPDATE crm_connections SET sync_outbound_enabled=$1,updated_at=NOW() WHERE business_id=$2 AND provider='salesforce' RETURNING id",[body.syncOutboundEnabled,session.businessId]);
      if(!changed.rowCount)throw new AppError('Connect Salesforce first.',409,'CRM_NOT_CONNECTED');
      return json({ok:true});
    }
    if(body.action==='toggle_outbound_objects'){
      if(typeof body.syncOutboundObjectsEnabled!=='boolean')throw new AppError('Choose a valid object push status.',400,'CRM_INVALID_ACTION');
      const changed=await query("UPDATE crm_connections SET sync_outbound_objects_enabled=$1,updated_at=NOW() WHERE business_id=$2 AND provider='salesforce' RETURNING id",[body.syncOutboundObjectsEnabled,session.businessId]);
      if(!changed.rowCount)throw new AppError('Connect Salesforce first.',409,'CRM_NOT_CONNECTED');
      return json({ok:true});
    }
    if(body.action==='sync_leads'){
      if(typeof body.enabled!=='boolean')throw new AppError('Choose a valid Lead sync status.',400,'CRM_INVALID_ACTION');
      const changed=await query("UPDATE crm_connections SET sync_leads_enabled=$1,lead_cursor=CASE WHEN $1 THEN lead_cursor ELSE '' END,updated_at=NOW() WHERE business_id=$2 AND provider='salesforce' RETURNING id",[body.enabled,session.businessId]);
      if(!changed.rowCount)throw new AppError('Connect Salesforce first.',409,'CRM_NOT_CONNECTED');
      await query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'salesforce_lead_sync_toggled',JSON.stringify({enabled:body.enabled})]);
      return json({ok:true});
    }
    if(body.action==='sync_objects'){
      await setCrmObjectSync(session,'salesforce',body.enabled);
      return json({ok:true});
    }
    if(body.action==='map_field'||body.action==='remove_field_mapping'){
      const connection=(await query("SELECT id,provider FROM crm_connections WHERE business_id=$1 AND provider='salesforce'",[session.businessId])).rows[0];
      if(!connection)throw new AppError('Connect Salesforce first.',409,'CRM_NOT_CONNECTED');
      if(body.action==='map_field')await saveCrmFieldMapping(session,connection,body);
      else await removeCrmFieldMapping(session,connection,body);
      return json({ok:true});
    }
    if(body.action==='sync')return json(await syncSalesforceContacts(session.businessId));
    if(body.action==='disconnect'){
      const removed=await transaction(async client=>{
        const connection=(await client.query("SELECT id,instance_url,refresh_encrypted FROM crm_connections WHERE business_id=$1 AND provider='salesforce' FOR UPDATE",[session.businessId])).rows[0];
        if(!connection)throw new AppError('Salesforce is not connected.',404,'CRM_NOT_CONNECTED');
        await clearCrmMappedAttributes(client,session.businessId,connection.id);
        await client.query('DELETE FROM crm_connections WHERE id=$1 AND business_id=$2',[connection.id,session.businessId]);
        await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'salesforce_disconnected',JSON.stringify({connectionId:connection.id})]);
        return connection;
      });
      let revoked=false;
      try{
        const response=await fetch(salesforceInstance(removed.instance_url)+'/services/oauth2/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:decryptSecret(removed.refresh_encrypted)}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
        revoked=response.ok;
      }catch{}
      return json({ok:true,revoked});
    }
    throw new AppError('Unsupported Salesforce action.',400,'CRM_INVALID_ACTION');
  }catch(error){return errorJson(error);}
}

export async function runDueSalesforceSync(){
  if(!(await workspaceFeatureFlags()).crm_sync)return {attempted:0,failed:0};
  const due=(await query("SELECT c.business_id FROM crm_connections c JOIN businesses b ON b.id=c.business_id WHERE c.provider='salesforce' AND c.enabled AND b.account_status<>'suspended' AND b.feature_overrides->>'crm_sync' IS DISTINCT FROM 'false' AND NOT EXISTS (SELECT 1 FROM workspace_deletion_requests d WHERE d.business_id=b.id AND d.status IN ('scheduled','pending_approval')) AND (c.last_attempt_at IS NULL OR c.last_attempt_at<NOW()-INTERVAL '5 minutes') AND (c.sync_claimed_at IS NULL OR c.sync_claimed_at<NOW()-INTERVAL '2 minutes') ORDER BY c.last_attempt_at NULLS FIRST,c.id LIMIT 1")).rows[0];
  if(!due)return {attempted:0,failed:0};
  try{await syncSalesforceContacts(due.business_id);return {attempted:1,failed:0};}catch(error){return {attempted:1,failed:1,code:error.code||'CRM_SYNC_FAILED'};}
}

import crypto from 'node:crypto';
import {isIP} from 'node:net';
import {AppError,query,transaction,id,json,errorJson,enterSystemContext} from './db.js';
import {encryptSecret,decryptSecret} from './meta.js';
import {requireSession} from './auth.js';
import {readJsonBodyLimited,enforceRequestRateLimit} from './security.js';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
export function trackingDestination(value) {
  let url;try{url=new URL(value);}catch{throw new AppError('Enter a valid destination.',400,'TRACKING_URL_INVALID');}
  if(url.protocol!=='https:'||url.username||url.password||url.href.length>2000||isIP(url.hostname)||!url.hostname.includes('.')||/\.?(localhost|local|internal)$/i.test(url.hostname))throw new AppError('Use a public HTTPS destination without credentials.',400,'TRACKING_URL_INVALID');
  return url.href;
}
function trackingOrigin(){
  const url=new URL(process.env.APP_URL||'');
  if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new AppError('Configure a public HTTPS APP_URL before issuing tracked links.',503,'TRACKING_ORIGIN_INVALID');
  return url.origin;
}
export function trackingMarker(value){
  const match=typeof value==='string'&&value.match(/^\{\{tracked_(link|token):([a-zA-Z0-9_-]{1,100})\}\}$/);
  if(!match&&typeof value==='string'&&value.includes('{{tracked_'))throw new AppError('Use one complete tracking reference per parameter.',400,'TRACKING_REFERENCE_INVALID');
  return match?{kind:match[1],id:match[2]}:null;
}
export async function trackedLinksRequest(request){
  try{
    const session=await requireSession(request);
    if(!['Owner','Manager'].includes(session.role))throw new AppError('Manager access required.',403,'FORBIDDEN');
    if(request.method==='POST'){
      if(session.role!=='Owner')throw new AppError('Only the Owner can change tracking destinations.',403,'FORBIDDEN');
      const body=await readJsonBodyLimited(request,8192);
      await transaction(async client=>{
        if(body.action==='create'){
          if(typeof body.name!=='string'||!body.name.trim()||body.name.length>120||!Number.isInteger(body.expiresDays)||body.expiresDays<1||body.expiresDays>365||typeof body.enabled!=='boolean')throw new AppError('Provide a name, expiration and enabled state.',400,'TRACKING_INVALID');
          const definitionId=id('link');
          await client.query('INSERT INTO tracked_link_definitions(id,business_id,name,destination,enabled,expires_days) VALUES($1,$2,$3,$4,$5,$6)',[definitionId,session.businessId,body.name.trim(),trackingDestination(body.destination),body.enabled,body.expiresDays]);
          await client.query("INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,'tracked_link_created',$4)",[id('a'),session.businessId,session.userId,JSON.stringify({definitionId})]);
        }else if(body.action==='toggle'&&typeof body.enabled==='boolean'){
          const updated=await client.query('UPDATE tracked_link_definitions SET enabled=$1 WHERE id=$2 AND business_id=$3 RETURNING id',[body.enabled,body.id,session.businessId]);
          if(!updated.rowCount)throw new AppError('Tracking link not found.',404,'NOT_FOUND');
          await client.query("INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,'tracked_link_toggled',$4)",[id('a'),session.businessId,session.userId,JSON.stringify({definitionId:body.id,enabled:body.enabled})]);
        }else throw new AppError('Invalid tracking operation.',400,'TRACKING_INVALID');
      });
    }
    const page=Number(new URL(request.url).searchParams.get('page')||1);
    if(!Number.isSafeInteger(page)||page<1||page>100000)throw new AppError('Invalid page.',400,'INVALID_PAGE');
    const links=await query(`SELECT d.*,COUNT(t.id) FILTER(WHERE t.confirmed_at IS NOT NULL)::int AS confirmed_clicks,COUNT(t.id)::int AS issued_links FROM tracked_link_definitions d LEFT JOIN tracked_link_tokens t ON t.definition_id=d.id AND t.business_id=d.business_id WHERE d.business_id=$1 GROUP BY d.id ORDER BY d.created_at DESC,d.id LIMIT 26 OFFSET $2`,[session.businessId,(page-1)*25]);
    return json({links:links.rows.slice(0,25).map(row=>({...row,marker:'{{tracked_link:'+row.id+'}}',tokenMarker:'{{tracked_token:'+row.id+'}}'})),page,hasMore:links.rows.length>25});
  }catch(error){return errorJson(error);}
}

export async function resolveTrackedParameters({businessId,contactId,recipientId=null,reference,variables,parameters,templateSchema={}}){
  const origin=variables.some(value=>trackingMarker(value))||(parameters.buttons||[]).some(button=>trackingMarker(button.value))?trackingOrigin():null;
  if(!origin)return {variables,parameters};
  const resolve=async(value,position)=>{
    const marker=trackingMarker(value);if(!marker)return value;
    if((marker.kind==='token'&&!position.startsWith('button:'))||(marker.kind==='link'&&position.startsWith('button:')))throw new AppError('Use a link reference in body parameters and a token reference in URL buttons.',400,'TRACKING_REFERENCE_INVALID');
    if(marker.kind==='token'){
      const buttons=templateSchema.buttons||templateSchema.components?.find(component=>String(component.type).toUpperCase()==='BUTTONS')?.buttons||[];
      const index=Number(position.split(':')[1]),definition=buttons[index],expected=origin+'/r/{{1}}';
      if(!definition||String(definition.type).toUpperCase()!=='URL'||(definition.url||definition.value)!==expected)throw new AppError('A tracked URL button must use the approved APP_URL/r/{{1}} URL.',400,'TRACKING_TEMPLATE_INVALID');
    }
    return transaction(async client=>{
      const definition=(await client.query('SELECT * FROM tracked_link_definitions WHERE id=$1 AND business_id=$2 AND enabled FOR SHARE',[marker.id,businessId])).rows[0];
      const contact=(await client.query('SELECT id FROM contacts WHERE id=$1 AND business_id=$2 AND unsubscribed=FALSE',[contactId,businessId])).rows[0];
      if(!definition||!contact)throw new AppError('Tracking link or contact is unavailable.',400,'TRACKING_UNAVAILABLE');
      if(recipientId&&!(await client.query('SELECT 1 FROM campaign_recipients cr JOIN campaigns c ON c.id=cr.campaign_id WHERE cr.id=$1 AND cr.contact_id=$2 AND c.business_id=$3',[recipientId,contactId,businessId])).rowCount)throw new AppError('Invalid campaign recipient.',400,'TRACKING_UNAVAILABLE');
      const ref=hash(JSON.stringify([reference,position,marker.id,contactId]));
      const token=crypto.randomBytes(32).toString('base64url');
      await client.query(`INSERT INTO tracked_link_tokens(id,business_id,definition_id,contact_id,campaign_recipient_id,reference,token_hash,token_encrypted,destination,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()+($10::int*INTERVAL '1 day')) ON CONFLICT(business_id,reference) DO NOTHING`,[id('click'),businessId,definition.id,contactId,recipientId,ref,hash(token),encryptSecret(token),definition.destination,definition.expires_days]);
      const saved=(await client.query('SELECT token_encrypted,destination,expires_at FROM tracked_link_tokens WHERE business_id=$1 AND reference=$2',[businessId,ref])).rows[0];
      if(new Date(saved.expires_at)<=new Date())throw new AppError('Tracked link expired before sending. Create a new campaign.',409,'TRACKING_EXPIRED');
      const code=decryptSecret(saved.token_encrypted);
      return marker.kind==='token'?code:origin+'/r/'+code;
    });
  };
  const resolved=[];
  for(const [index,value] of variables.entries())resolved.push(await resolve(value,'body:'+index));
  const buttons=[];
  for(const button of parameters.buttons||[])buttons.push({...button,value:await resolve(button.value,'button:'+button.index)});
  return {variables:resolved,parameters:{...parameters,...(parameters.buttons?{buttons}:{})}};
}

function escape(value){return String(value).replace(/[&<>"']/g,letter=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[letter]));}
export async function visitTrackedLink(request,context){
  try{
    enterSystemContext();
    const token=(await context.params).token;
    if(!/^[A-Za-z0-9_-]{43}$/.test(token||''))return new Response('Link unavailable.',{status:404});
    await enforceRequestRateLimit(request,hash(token),'api');
    const record=(await query(`SELECT t.*,d.enabled,b.account_status,c.unsubscribed FROM tracked_link_tokens t JOIN tracked_link_definitions d ON d.id=t.definition_id AND d.business_id=t.business_id JOIN businesses b ON b.id=t.business_id JOIN contacts c ON c.id=t.contact_id AND c.business_id=t.business_id WHERE t.token_hash=$1 AND t.expires_at>NOW()`,[hash(token)])).rows[0];
    if(!record||!record.enabled||record.account_status!=='active'||record.unsubscribed)return new Response('Link unavailable.',{status:404,headers:{'Cache-Control':'no-store'}});
    const destination=trackingDestination(record.destination),origin=trackingOrigin();
    if(request.method==='POST'){
      if(request.headers.get('origin')!==origin)throw new AppError('Invalid navigation origin.',403,'TRACKING_ORIGIN_DENIED');
      await query('UPDATE tracked_link_tokens SET confirmed_at=COALESCE(confirmed_at,NOW()) WHERE id=$1 AND business_id=$2',[record.id,record.business_id]);
      return new Response(null,{status:303,headers:{Location:destination,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
    }
    return new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Continue to website</title><body><main style="font-family:system-ui;max-width:520px;margin:12vh auto;padding:24px;overflow-wrap:anywhere"><h1>Continue to website</h1><p>'+escape(new URL(destination).hostname)+'</p><form method="post" action="'+escape(origin+'/r/'+token)+'"><button style="padding:12px 20px;font:inherit;cursor:pointer">Continue</button></form></main></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}});
  }catch(error){return errorJson(error);}
}

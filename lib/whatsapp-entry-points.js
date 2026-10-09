import {requireSession} from './auth.js';
import {AppError,query,transaction,json,errorJson,id} from './db.js';
import {decryptSecret} from './meta.js';
import {readJsonBodyLimited,readTextBodyLimited} from './security.js';
import {requireWorkspaceManager} from './workspace-permissions.js';
import {assertSubscriptionActive,subscriptionUsage} from './limits.js';
import {metaGraphApiVersion} from './operational-policy.js';

export function entryPointInput(body){
  if(typeof body.message!=='string'||!body.message.trim()||body.message.length>512)throw new AppError('Enter a prefilled message of up to 512 characters.',400,'ENTRY_MESSAGE_INVALID');
  if(!['create','update','delete'].includes(body.action))throw new AppError('Unsupported entry point action.',400,'ENTRY_ACTION_INVALID');
  if(body.action!=='create'&&!/^[a-zA-Z0-9_-]{1,100}$/.test(body.code||''))throw new AppError('Select an existing QR code.',400,'ENTRY_CODE_INVALID');
  if(!/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId||''))throw new AppError('A unique operation reference is required.',400,'ENTRY_REFERENCE_INVALID');
  return {prefilled_message:body.message.trim(),generate_qr_image:'PNG',...(body.action==='update'?{code:body.code}:{})};
}
async function phoneFor(businessId,phoneId){
  const phone=(await query("SELECT p.phone_number_id,a.access_token_encrypted FROM whatsapp_phone_numbers p JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id WHERE p.business_id=$1 AND p.id=$2 AND a.status='connected'",[businessId,phoneId])).rows[0];
  if(!phone?.access_token_encrypted)throw new AppError('Connected company phone number not found.',404,'NOT_FOUND');
  return phone;
}
async function graph(phone,suffix='',method='GET',body){
  let response,payload;
  try{
    response=await fetch('https://graph.facebook.com/'+metaGraphApiVersion()+'/'+phone.phone_number_id+'/message_qrdls'+suffix,{method,headers:{Authorization:'Bearer '+decryptSecret(phone.access_token_encrypted),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
    payload=JSON.parse(await readTextBodyLimited(response,2_000_000));
  }catch{throw new AppError('Meta did not confirm this operation. Refresh the list before taking further action.',409,'ENTRY_UNCONFIRMED');}
  if(!response.ok)throw new AppError('Meta rejected the QR request. Check account access.',response.status>=500?502:400,response.status>=500||[408,409].includes(response.status)?'ENTRY_UNCONFIRMED':'ENTRY_REJECTED');
  return payload;
}
export async function getEntryPoints(request){
  try{
    const session=await requireSession(request);requireWorkspaceManager(session);
    const url=new URL(request.url),phoneId=url.searchParams.get('phoneId');
    const phone=await phoneFor(session.businessId,phoneId);
    const after=url.searchParams.get('after')||'';
    if(after.length>2000)throw new AppError('Invalid page cursor.',400,'INVALID_CURSOR');
    const result=await graph(phone,'?fields=code,prefilled_message,deep_link_url,qr_image_url&limit=25'+(after?'&after='+encodeURIComponent(after):''));
    await query("UPDATE whatsapp_entry_operations SET status='unconfirmed' WHERE business_id=$1 AND status='processing' AND created_at<NOW()-INTERVAL '2 minutes'",[session.businessId]);
    const pending=(await query("SELECT id,phone_id,action,status,code,created_at FROM whatsapp_entry_operations WHERE business_id=$1 AND phone_id=$2 AND status IN ('processing','unconfirmed') ORDER BY created_at DESC LIMIT 25",[session.businessId,phoneId])).rows;
    const rules=(await query('SELECT id,code,source_name,workflow_id,cooldown_minutes,enabled FROM whatsapp_entry_rules WHERE business_id=$1 AND phone_id=$2',[session.businessId,phoneId])).rows;
    const workflows=(await query("SELECT id,name FROM automation_flows WHERE business_id=$1 AND status='active' AND trigger_mode='manual' ORDER BY name",[session.businessId])).rows;
    const attributions=(await query('SELECT a.id,a.source_name,a.workflow_status,a.matched_at,c.name AS contact_name FROM whatsapp_entry_attributions a JOIN whatsapp_entry_rules r ON r.id=a.rule_id AND r.business_id=a.business_id JOIN contacts c ON c.id=a.contact_id AND c.business_id=a.business_id WHERE a.business_id=$1 AND r.phone_id=$2 ORDER BY a.created_at DESC LIMIT 50',[session.businessId,phoneId])).rows;
    return json({entries:result.data||[],after:result.paging?.next?result.paging?.cursors?.after:null,pending,rules,workflows,attributions});
  }catch(error){return errorJson(error);}
}
export async function updateEntryPoints(request){
  try{
    const session=await requireSession(request);requireWorkspaceManager(session);
    const body=await readJsonBodyLimited(request,8192);
    await assertSubscriptionActive(await subscriptionUsage(session.businessId));
    const phone=await phoneFor(session.businessId,body.phoneId);
    if(body.action==='configure'){
      if(session.role!=='Owner')throw new AppError('Only the owner can configure welcome workflows.',403,'FORBIDDEN');
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(body.code||'')||typeof body.sourceName!=='string'||!body.sourceName.trim()||body.sourceName.length>120||!Number.isInteger(body.cooldownMinutes)||body.cooldownMinutes<1||body.cooldownMinutes>43200||typeof body.enabled!=='boolean')throw new AppError('Enter a source label, repeat interval and enabled setting.',400,'ENTRY_RULE_INVALID');
      const existing=await graph(phone,'/'+encodeURIComponent(body.code));
      if(existing.code!==body.code||typeof existing.prefilled_message!=='string'||!existing.prefilled_message.trim())throw new AppError('The QR code needs a unique nonempty prefilled message.',400,'ENTRY_RULE_INVALID');
      if(body.workflowId&&!(await query("SELECT 1 FROM automation_flows WHERE business_id=$1 AND id=$2 AND status='active' AND trigger_mode='manual'",[session.businessId,body.workflowId])).rowCount)throw new AppError('Select an active manual workflow from this workspace.',400,'ENTRY_RULE_INVALID');
      await transaction(async client=>{
        await client.query('INSERT INTO whatsapp_entry_rules (id,business_id,phone_id,code,source_name,prefilled_message,workflow_id,cooldown_minutes,enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (phone_id,code) DO UPDATE SET source_name=EXCLUDED.source_name,prefilled_message=EXCLUDED.prefilled_message,workflow_id=EXCLUDED.workflow_id,cooldown_minutes=EXCLUDED.cooldown_minutes,enabled=EXCLUDED.enabled,updated_at=NOW()',[id('er'),session.businessId,body.phoneId,body.code,body.sourceName.trim(),existing.prefilled_message.trim(),body.workflowId||null,body.cooldownMinutes,body.enabled]);
        await client.query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'entry_rule_configured',$4)",[id('a'),session.businessId,session.userId,JSON.stringify({phoneId:body.phoneId,code:body.code,workflowId:body.workflowId||null})]);
      });
      return json({ok:true});
    }
    const wire=entryPointInput(body);
    if(body.action!=='create'){
      const existing=await graph(phone,'/'+encodeURIComponent(body.code));
      if(existing.code!==body.code)throw new AppError('QR code not found on this number.',404,'NOT_FOUND');
    }
    const inserted=await query("INSERT INTO whatsapp_entry_operations (id,business_id,phone_id,action,code,status) VALUES ($1,$2,$3,$4,$5,'processing') ON CONFLICT DO NOTHING RETURNING id",[body.requestId,session.businessId,body.phoneId,body.action,body.code||'']);
    if(!inserted.rowCount)throw new AppError('This operation was already attempted. Refresh its status instead of repeating it.',409,'ENTRY_REFERENCE_EXISTS');
    let result;
    try{
      result=await graph(phone,body.action==='delete'?'/'+encodeURIComponent(body.code):'',body.action==='delete'?'DELETE':'POST',body.action==='delete'?undefined:wire);
      if(body.action==='delete'?result.success!==true:!result.code)throw new AppError('Meta did not confirm the result.',409,'ENTRY_UNCONFIRMED');
    }catch(error){await query('UPDATE whatsapp_entry_operations SET status=$1 WHERE id=$2 AND business_id=$3',[error.code==='ENTRY_REJECTED'?'failed':'unconfirmed',body.requestId,session.businessId]);throw error;}
    await query("UPDATE whatsapp_entry_operations SET status='confirmed',code=$1 WHERE id=$2 AND business_id=$3",[result.code||body.code,body.requestId,session.businessId]);
    if(body.action!=='create')await query('UPDATE whatsapp_entry_rules SET enabled=FALSE,updated_at=NOW() WHERE business_id=$1 AND phone_id=$2 AND code=$3',[session.businessId,body.phoneId,body.code]);
    await query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'whatsapp_entry_'+body.action,JSON.stringify({phoneId:body.phoneId,code:result.code||body.code,requestId:body.requestId})]);
    return json({ok:true,entry:result});
  }catch(error){return errorJson(error);}
}

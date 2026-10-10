import {requireSession} from './auth.js';
import {AppError,query,transaction,id,json,errorJson,enterSystemContext} from './db.js';
import {assertWorkspaceFeature,workspaceFeatureFlags} from './feature-controls.js';
import {readJsonBodyLimited} from './security.js';
import {sendHostedWebviewInChat,sendTransactionalWebview,resolveWebviewInvite} from './whatsapp-webview-transactions.js';
import {sendNativeFlowInvite} from './whatsapp-experiences.js';
import {isManagedRuntimeEndpoint} from './flow-runtime.js';
import {normalizeFormSchema} from './webview-form-submissions.js';

const webviewId = value => /^wv_[a-f0-9]{16}$/.test(value || '');
const clean = (value,max) => typeof value === 'string' && value.trim() === value && value.length >= 1 && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);

export function validateWebview(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !clean(input.title,120) || !clean(input.description,2000) || !clean(input.buttonLabel,50) || !clean(input.prefilledMessage,512) || typeof input.enabled !== 'boolean' || !/^wap_[a-f0-9]{16}$/.test(input.phoneId || '')) throw new AppError('Provide a title, description, button, message and registered phone.',400,'WEBVIEW_INVALID');
  if(input.flowId!==undefined&&(!/^waf_[a-f0-9]{16}$/.test(input.flowId||'')||!Number.isInteger(input.expiresHours)||input.expiresHours<1||input.expiresHours>24||input.buttonLabel.length>20))throw new AppError('Choose a published transactional Flow, a short CTA and an expiry of 1 to 24 hours.',400,'WEBVIEW_INVALID');
  const pageMode = ['cta', 'form', 'transactional'].includes(input.pageMode)
    ? input.pageMode
    : (input.flowId ? 'transactional' : 'cta');
  const formSchema = pageMode === 'form' ? normalizeFormSchema(input.formSchema || []) : [];
  if (pageMode === 'form' && !formSchema.length) throw new AppError('Form pages require at least one field.', 400, 'WEBVIEW_FORM_INVALID');
  const defaultSuccess = 'Thanks — we received your details.';
  const rawSuccess = typeof input.successMessage === 'string' && input.successMessage.length ? input.successMessage : defaultSuccess;
  if (!clean(rawSuccess, 500)) throw new AppError('Provide a valid success message.', 400, 'WEBVIEW_INVALID');
  const successMessage = rawSuccess;
  const automationFlowId = input.automationFlowId && /^[a-zA-Z0-9_-]{8,80}$/.test(input.automationFlowId) ? input.automationFlowId : null;
  return {
    title:input.title,
    description:input.description,
    buttonLabel:input.buttonLabel,
    prefilledMessage:input.prefilledMessage,
    enabled:input.enabled,
    phoneId:input.phoneId,
    pageMode,
    formSchema,
    successMessage,
    automationFlowId,
    ...(input.flowId!==undefined?{flowId:input.flowId,expiresHours:input.expiresHours}:{})
  };
}

export async function manageWebviews(request) {
  try {
    const session=await requireSession(request);
    if (session.role!=='Owner') throw new AppError('Only the workspace owner can manage hosted pages.',403,'FORBIDDEN');
    await assertWorkspaceFeature('webviews',session.businessId);
    if (request.method==='GET') {
      await query("UPDATE whatsapp_webview_invites SET status='unconfirmed' WHERE business_id=$1 AND status='processing' AND created_at<NOW()-INTERVAL '2 minutes'",[session.businessId]);
      const page=Number(new URL(request.url).searchParams.get('page')||1);
      if (!Number.isSafeInteger(page)||page<1||page>10000) throw new AppError('Invalid page.',400,'INVALID_PAGE');
      const search=(new URL(request.url).searchParams.get('search')||'').trim().slice(0,80);
      const [views,phones,flows,contacts,invites]=await Promise.all([
        query('SELECT id,phone_id,flow_id,expires_hours,title,description,button_label,prefilled_message,enabled,page_mode,form_schema,success_message,automation_flow_id,created_at,updated_at FROM whatsapp_webviews WHERE business_id=$1 ORDER BY created_at DESC,id LIMIT 26 OFFSET $2',[session.businessId,(page-1)*25]),
        query("SELECT p.id,p.display_phone_number,p.verified_name FROM whatsapp_phone_numbers p JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id WHERE p.business_id=$1 AND p.registration_state='registered' AND a.status='connected' ORDER BY p.created_at",[session.businessId]),
        query("SELECT f.id,f.name,f.endpoint_phone_id,r.config->>'mode' AS mode, (COALESCE(f.meta_flow_id,'')<>'' AND jsonb_typeof(f.flow_json->'screens')='array' AND jsonb_array_length(CASE WHEN jsonb_typeof(f.flow_json->'screens')='array' THEN f.flow_json->'screens' ELSE '[]'::jsonb END)>0) AS native_ready FROM whatsapp_native_flows f JOIN flow_runtime_configs r ON r.flow_id=f.id AND r.business_id=f.business_id WHERE f.business_id=$1 AND f.status='published' AND r.config->>'enabled'='true' ORDER BY f.name LIMIT 100",[session.businessId]),
        search?query("SELECT c.id,c.name,c.phone FROM contacts c WHERE c.business_id=$1 AND c.unsubscribed=FALSE AND (c.name ILIKE $2 OR c.phone ILIKE $2) ORDER BY c.name,c.id LIMIT 20",[session.businessId,'%'+search+'%']):Promise.resolve({rows:[]}),
        query("SELECT i.id,i.webview_id,i.status,i.created_at,i.expires_at,c.name AS contact_name FROM whatsapp_webview_invites i JOIN contacts c ON c.id=i.contact_id AND c.business_id=i.business_id WHERE i.business_id=$1 ORDER BY i.created_at DESC LIMIT 50",[session.businessId])
      ]);
      return json({views:views.rows.slice(0,25),phones:phones.rows,flows:flows.rows,contacts:contacts.rows,invites:invites.rows,page,hasMore:views.rows.length>25});
    }
    const body=await readJsonBodyLimited(request,8192);
    if(body.action==='send')return json(await sendTransactionalWebview({businessId:session.businessId,userId:session.userId,viewId:body.id,contactId:body.contactId,operationId:body.requestId}));
    if(body.action==='send_inchat')return json(await sendHostedWebviewInChat({businessId:session.businessId,userId:session.userId,viewId:body.id,contactId:body.contactId,operationId:body.requestId}));
    if(body.action==='send_flow'){
      if(!webviewId(body.id))throw new AppError('Select a transactional page.',400,'WEBVIEW_INVALID');
      const view=(await query(`SELECT v.flow_id,v.phone_id,v.button_label,v.prefilled_message,v.expires_hours,v.enabled,
        f.id AS native_flow_id,f.status AS flow_status,f.meta_flow_id,f.flow_json,f.response_mapping,f.whatsapp_account_id,f.endpoint_uri,f.endpoint_phone_id
        FROM whatsapp_webviews v JOIN whatsapp_native_flows f ON f.id=v.flow_id AND f.business_id=v.business_id
        JOIN flow_runtime_configs r ON r.flow_id=f.id AND r.business_id=f.business_id
        WHERE v.business_id=$1 AND v.id=$2 AND r.config->>'enabled'='true'`,[session.businessId,body.id])).rows[0];
      if(!view?.enabled||view.flow_status!=='published'||!view.native_flow_id||!view.meta_flow_id||view.endpoint_phone_id!==view.phone_id||!isManagedRuntimeEndpoint({id:view.native_flow_id,endpoint_uri:view.endpoint_uri}))throw new AppError('Publish the native Flow and enable its transactional runtime on this number first.',409,'WEBVIEW_FLOW_UNAVAILABLE');
      const flow={id:view.native_flow_id,status:view.flow_status,meta_flow_id:view.meta_flow_id,flow_json:view.flow_json,response_mapping:view.response_mapping,whatsapp_account_id:view.whatsapp_account_id,endpoint_uri:view.endpoint_uri};
      return json(await sendNativeFlowInvite(session,{requestId:body.requestId,contactId:body.contactId,phoneId:view.phone_id,text:view.prefilled_message,cta:view.button_label,expiresHours:view.expires_hours},flow));
    }
    if(body.action==='resolve'){await resolveWebviewInvite({businessId:session.businessId,userId:session.userId,inviteId:body.id,resolution:body.resolution});return json({ok:true});}
    if (!['save','toggle','delete'].includes(body.action)) throw new AppError('Invalid page action.',400,'WEBVIEW_INVALID');
    if ((body.action!=='save' && !webviewId(body.id)) || (body.action==='save' && body.id && !webviewId(body.id))) throw new AppError('Invalid page ID.',400,'WEBVIEW_INVALID');
    const values=body.action==='save'?validateWebview(body):null;
    await transaction(async client=>{
      let changed;
      if (body.action==='save') {
        if(body.id){
          const current=(await client.query('SELECT phone_id,flow_id FROM whatsapp_webviews WHERE business_id=$1 AND id=$2 FOR UPDATE',[session.businessId,body.id])).rows[0];
          if(!current)throw new AppError('Hosted page not found.',404,'NOT_FOUND');
          if((current.phone_id!==values.phoneId||current.flow_id!==(values.flowId||null))&&(await client.query("SELECT 1 FROM whatsapp_webview_invites WHERE business_id=$1 AND webview_id=$2 AND status IN ('processing','sent','unconfirmed') AND expires_at>NOW() LIMIT 1",[session.businessId,body.id])).rowCount)throw new AppError('Wait for active invitations to expire before changing this page’s number or Flow.',409,'WEBVIEW_INVITES_ACTIVE');
        }
        const phone=(await client.query("SELECT p.id FROM whatsapp_phone_numbers p JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id WHERE p.business_id=$1 AND p.id=$2 AND p.registration_state='registered' AND a.status='connected' FOR SHARE OF p,a",[session.businessId,values.phoneId])).rows[0];
        if (!phone) throw new AppError('Select a registered, connected WhatsApp number.',409,'WEBVIEW_PHONE_UNAVAILABLE');
        if(values.flowId){
          const flow=(await client.query("SELECT 1 FROM whatsapp_native_flows f JOIN flow_runtime_configs r ON r.flow_id=f.id AND r.business_id=f.business_id WHERE f.business_id=$1 AND f.id=$2 AND f.endpoint_phone_id=$3 AND f.status='published' AND r.config->>'enabled'='true' FOR SHARE OF f,r",[session.businessId,values.flowId,values.phoneId])).rows[0];
          if(!flow)throw new AppError('Choose a published Flow with an enabled runtime on this number.',409,'WEBVIEW_FLOW_UNAVAILABLE');
        }
        if (body.id) changed=await client.query('UPDATE whatsapp_webviews SET phone_id=$1,title=$2,description=$3,button_label=$4,prefilled_message=$5,enabled=$6,flow_id=$7,expires_hours=$8,page_mode=$9,form_schema=$10::jsonb,success_message=$11,automation_flow_id=$12,updated_at=NOW() WHERE business_id=$13 AND id=$14 RETURNING id',[values.phoneId,values.title,values.description,values.buttonLabel,values.prefilledMessage,values.enabled,values.flowId||null,values.expiresHours||1,values.pageMode,JSON.stringify(values.formSchema||[]),values.successMessage,values.automationFlowId,session.businessId,body.id]);
        else changed=await client.query('INSERT INTO whatsapp_webviews(id,business_id,phone_id,title,description,button_label,prefilled_message,enabled,flow_id,expires_hours,page_mode,form_schema,success_message,automation_flow_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14) RETURNING id',[id('wv'),session.businessId,values.phoneId,values.title,values.description,values.buttonLabel,values.prefilledMessage,values.enabled,values.flowId||null,values.expiresHours||1,values.pageMode,JSON.stringify(values.formSchema||[]),values.successMessage,values.automationFlowId]);
      } else if (body.action==='toggle') {
        if (typeof body.enabled!=='boolean') throw new AppError('Invalid status.',400,'WEBVIEW_INVALID');
        changed=await client.query('UPDATE whatsapp_webviews SET enabled=$1,updated_at=NOW() WHERE business_id=$2 AND id=$3 RETURNING id',[body.enabled,session.businessId,body.id]);
      } else changed=await client.query('DELETE FROM whatsapp_webviews WHERE business_id=$1 AND id=$2 RETURNING id',[session.businessId,body.id]);
      if (!changed.rowCount) throw new AppError('Hosted page not found.',404,'NOT_FOUND');
      await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'whatsapp_webview_'+body.action,JSON.stringify({id:changed.rows[0].id})]);
    });
    return json({ok:true});
  } catch(error) { return errorJson(error); }
}

export async function publicWebview(viewId) {
  if (!webviewId(viewId)) return null;
  enterSystemContext();
  const row=(await query(`SELECT v.id,v.business_id,v.title,v.description,v.button_label,v.prefilled_message,v.flow_id,v.page_mode,v.form_schema,v.success_message,b.name AS business_name,p.display_phone_number,f.status AS flow_status,r.config AS runtime_config
    FROM whatsapp_webviews v JOIN businesses b ON b.id=v.business_id JOIN whatsapp_phone_numbers p ON p.id=v.phone_id AND p.business_id=v.business_id
    JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id
    LEFT JOIN whatsapp_native_flows f ON f.id=v.flow_id AND f.business_id=v.business_id
    LEFT JOIN flow_runtime_configs r ON r.flow_id=f.id AND r.business_id=f.business_id
    WHERE v.id=$1 AND v.enabled AND b.account_status<>'suspended' AND p.registration_state='registered' AND a.status='connected'
    AND NOT EXISTS (SELECT 1 FROM workspace_deletion_requests d WHERE d.business_id=v.business_id AND d.status IN ('scheduled','pending_approval'))`,[viewId])).rows[0];
  if (!row || !(await workspaceFeatureFlags(row.business_id)).webviews) return null;
  if(row.flow_id || row.page_mode === 'transactional'){
    if(row.flow_status!=='published'||!row.runtime_config?.enabled)return null;
    return {...row,mode:row.runtime_config.mode};
  }
  if (row.page_mode === 'form') {
    return {
      ...row,
      mode: 'form',
      formSchema: Array.isArray(row.form_schema) ? row.form_schema : [],
      successMessage: row.success_message
    };
  }
  const number=String(row.display_phone_number||'').replace(/\D/g,'');
  if (!/^\d{5,20}$/.test(number)) return null;
  return {...row,url:'https://wa.me/'+number+'?text='+encodeURIComponent(row.prefilled_message)};
}

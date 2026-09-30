import { requireSession } from './auth.js';
import { AppError, enterTenantContext, enterSystemContext, query, json, errorJson } from './db.js';
import { requireWorkspaceManager } from './workspace-permissions.js';
import { readJsonBodyLimited, readTextBodyLimited } from './security.js';
import { decryptSecret } from './meta.js';
import { decryptFlowRequest, encryptFlowResponse, verifyFlowSignature } from './whatsapp-flow-crypto.js';
import { createRuntimeSession, getRuntimeSettings, handleRuntimeExchange, saveRuntimeConfig, saveRuntimeResource } from './flow-runtime.js';

export async function runtimeSettingsApi(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    enterTenantContext(session.businessId);
    if (request.method === 'GET') return json(await getRuntimeSettings(session.businessId,new URL(request.url).searchParams.get('flowId')));
    const body = await readJsonBodyLimited(request,16384);
    const allowed = {config:['action','flowId','config'],resource:['action','resource'],session:['action','flowId','contactId','phoneId','expiresMinutes']};
    if (!Object.hasOwn(allowed,body.action) || Object.keys(body).some(key => !allowed[body.action].includes(key))) throw new AppError('Invalid runtime management action.',400,'FLOW_RUNTIME_INVALID');
    if (body.action === 'config') return json({config:await saveRuntimeConfig(session.businessId,body.flowId,body.config)});
    if (body.action === 'resource') return json({resource:await saveRuntimeResource(session.businessId,body.resource)});
    return json(await createRuntimeSession({...body,businessId:session.businessId}));
  } catch (error) { return errorJson(error); }
}

export async function runtimeDataEndpoint(request, { params }) {
  let rawBody;
  try { rawBody = await readTextBodyLimited(request,350000); }
  catch (error) { return new Response(null,{status:error instanceof AppError ? error.status : 400}); }
  if (!verifyFlowSignature(rawBody,request.headers.get('x-hub-signature-256'),process.env.META_APP_SECRET)) return new Response(null,{status:432});
  let encryption;
  const headers = {'Content-Type':'text/plain','Cache-Control':'no-store'};
  try {
    const {flowId} = await params;
    if (typeof flowId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(flowId)) return new Response(null,{status:404});
    enterSystemContext();
    const flow = (await query(`SELECT f.business_id,f.endpoint_uri,p.flow_private_key_encrypted FROM whatsapp_native_flows f
      JOIN whatsapp_phone_numbers p ON p.id=f.endpoint_phone_id AND p.business_id=f.business_id AND p.whatsapp_account_id=f.whatsapp_account_id
      JOIN whatsapp_accounts a ON a.id=f.whatsapp_account_id AND a.business_id=f.business_id
      WHERE f.id=$1`,[flowId])).rows[0];
    if (!flow?.flow_private_key_encrypted || new URL(flow.endpoint_uri).pathname !== new URL(request.url).pathname) return new Response(null,{status:404});
    encryption = decryptFlowRequest(JSON.parse(rawBody),decryptSecret(flow.flow_private_key_encrypted));
    enterTenantContext(flow.business_id);
    const response = await handleRuntimeExchange({businessId:flow.business_id,flowId,payload:encryption.request});
    return new Response(encryptFlowResponse(response,encryption.aesKey,encryption.iv),{headers});
  } catch (error) {
    if (encryption && error instanceof AppError) return new Response(encryptFlowResponse({error_msg:error.message},encryption.aesKey,encryption.iv),{status:error.status,headers});
    return new Response(null,{status:error instanceof AppError ? error.status : 500,headers});
  }
}

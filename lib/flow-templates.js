import crypto from 'node:crypto';
import {AppError, id, query, transaction, json, errorJson} from './db.js';
import {requireSession} from './auth.js';
import {requireWorkspaceManager} from './workspace-permissions.js';
import {readJsonBodyLimited} from './security.js';
import {assertMessageCapacity} from './limits.js';
import {createWhatsAppTemplate, sendTemplateMessage} from './meta.js';
import {advancedTemplateComponents, variableCount} from './advanced-template-components.js';
import {validateTemplateParameters, templateSendComponents} from './template-send-components.js';
import {flowTemplateButton, validateFlowInvite} from './flow-template-components.js';
import {flowFieldNames, validateFlowMapping} from './whatsapp-experiences.js';
import {recordSupportResponse} from './support-policy.js';
import {provisionRuntimeInvite} from './flow-runtime.js';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const defaults = {query, transaction, createWhatsAppTemplate, sendTemplateMessage, assertMessageCapacity, recordSupportResponse};
const fail = (message, code, status = 400) => { throw new AppError(message, status, code); };
function publishedFlow(flow, businessId) {
  if (!flow || flow.business_id !== businessId) fail('Flow not found.', 'NOT_FOUND', 404);
  if (flow.status !== 'published' || !/^[0-9]{1,32}$/.test(flow.meta_flow_id || '') || !flow.whatsapp_account_id || !flow.flow_json?.screens?.length || flow.validation_errors?.length) fail('Select a published, validated Flow.', 'FLOW_NOT_PUBLISHED', 409);
}
export function bindFlowTemplateSchema(flow, businessId, input) {
  publishedFlow(flow, businessId);
  const action = input.flowAction || 'navigate';
  if (action === 'navigate' && !flow.flow_json.screens.some(screen => screen.id === input.flowScreen)) fail('Select an entry screen from this Flow.', 'FLOW_SCREEN_INVALID');
  if (action === 'data_exchange' && !flow.endpoint_uri) fail('This Flow has no data exchange endpoint.', 'FLOW_ENDPOINT_REQUIRED');
  return {kind: 'FLOW', headerFormat: 'NONE', flowId: flow.id, flowAccountId: flow.whatsapp_account_id, flowMetaId: flow.meta_flow_id, flowButtonText: input.flowButtonText, flowAction: action, flowScreen: input.flowScreen, bodyExamples: input.bodyExamples};
}
export function assertFlowTemplateBinding(template, flow, businessId, phone) {
  publishedFlow(flow, businessId);
  if (!template || template.business_id !== businessId || String(template.status).toUpperCase() !== 'APPROVED' || !template.meta_template_id || !template.meta_template_name || !['MARKETING', 'UTILITY'].includes(template.category)) fail('Select an approved Meta Flow template.', 'FLOW_TEMPLATE_NOT_APPROVED', 409);
  const schema = template.component_schema || {}, button = flowTemplateButton(template);
  if (!button || button.flow_id !== flow.meta_flow_id || (schema.flowId && schema.flowId !== flow.id) || (schema.flowAccountId && schema.flowAccountId !== flow.whatsapp_account_id)) fail('Template does not belong to this Flow.', 'FLOW_TEMPLATE_MISMATCH');
  if (!phone || phone.business_id !== businessId || phone.whatsapp_account_id !== flow.whatsapp_account_id || phone.status !== 'connected' || !phone.access_token_encrypted) fail('Use a connected number from the Flow account.', 'FLOW_PHONE_MISMATCH');
  // Synced templates can resolve ownership through their original Meta button;
  // locally submitted templates additionally retain the account binding.
  if (schema.flowAccountId ? schema.flowAccountId !== phone.whatsapp_account_id : template.waba_id !== phone.waba_id) fail('Verify this template belongs to the sending WABA.', 'FLOW_TEMPLATE_ACCOUNT_UNVERIFIED', 409);
  const action = button.flow_action || 'navigate';
  if (action === 'navigate' && !flow.flow_json.screens.some(screen => screen.id === button.navigate_screen)) fail('The approved entry screen is unavailable.', 'FLOW_SCREEN_INVALID');
  if (!['navigate', 'data_exchange'].includes(action) || (action === 'data_exchange' && !flow.endpoint_uri)) fail('The approved Flow action is unavailable.', 'FLOW_ENDPOINT_REQUIRED');
  return button;
}
export async function createFlowTemplate(session, input, dependencies = {}) {
  const deps = {...defaults, ...dependencies};
  requireWorkspaceManager(session);
  if (typeof input.name !== 'string' || !/^[a-z0-9_]{1,512}$/.test(input.name) || typeof input.language !== 'string' || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(input.language) || !['MARKETING', 'UTILITY'].includes(input.category)) fail('Provide a valid template name, language and category.', 'FLOW_TEMPLATE_INVALID');
  const flow = (await deps.query('SELECT * FROM whatsapp_native_flows WHERE business_id=$1 AND id=$2', [session.businessId, input.flowId])).rows[0];
  const schema = bindFlowTemplateSchema(flow, session.businessId, input);
  schema.components = advancedTemplateComponents(schema, input.body, input.category);
  schema.buttons = schema.components[1].buttons;
  const setup = (await deps.query("SELECT * FROM whatsapp_accounts WHERE business_id=$1 AND id=$2 AND status='connected'", [session.businessId, flow.whatsapp_account_id])).rows[0];
  if (!setup?.access_token_encrypted) fail('Connect this Flow account before submitting.', 'FLOW_ACCOUNT_UNAVAILABLE', 409);
  const result = await deps.createWhatsAppTemplate({setup, name: input.name, body: input.body.trim(), language: input.language, category: input.category, componentSchema: schema});
  const templateId = id('t');
  const status = String(result.status).toUpperCase() === 'APPROVED' ? 'Approved' : String(result.status).toUpperCase() === 'REJECTED' ? 'Rejected' : 'Pending';
  await deps.transaction(async client => {
    await client.query("INSERT INTO templates (id,business_id,name,category,language,body,buttons,component_schema,variables,status,meta_template_id,meta_template_name,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Meta submission')", [templateId, session.businessId, input.name, input.category, input.language, input.body.trim(), JSON.stringify(schema.buttons), JSON.stringify(schema), JSON.stringify(Array.from({length: variableCount(input.body)}, (_, index) => String(index + 1))), status, result.id, result.name]);
    await client.query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'flow_template_created',$4)", [id('a'), session.businessId, session.userId, JSON.stringify({flowId: flow.id, templateId})]);
  });
  return {ok: true, templateId, status};
}
export async function sendFlowTemplateInvite(session, input, dependencies = {}) {
  const deps = {...defaults, ...dependencies};
  const parameters = input.parameters || {}, {flowInvite, ...sendParameters} = parameters;
  validateFlowInvite(flowInvite);
  // Never accept caller tokens, even when they have the correct wire format.
  if (sendParameters.buttons?.some(button => String(button.type).toLowerCase() === 'flow')) fail('Flow tokens are generated per invitation.', 'FLOW_TOKEN_FORBIDDEN');
  const token = crypto.randomBytes(32).toString('hex'), inviteId = id('fi');
  const ready = await deps.transaction(async client => {
    const contact = (await client.query('SELECT ct.*,cv.id AS conversation_id,cv.assigned_user_id,cv.whatsapp_phone_number_id FROM contacts ct JOIN conversations cv ON cv.contact_id=ct.id AND cv.business_id=ct.business_id WHERE ct.business_id=$1 AND ct.id=$2 FOR UPDATE OF ct,cv', [session.businessId, input.contactId])).rows[0];
    if (!contact) fail('Contact conversation not found.', 'NOT_FOUND', 404);
    if (!['Owner', 'Manager'].includes(session.role) && contact.assigned_user_id && contact.assigned_user_id !== session.userId) fail('Only the assigned agent can send here.', 'CONVERSATION_FORBIDDEN', 403);
    if (contact.unsubscribed || contact.marketing_permission !== true || !contact.opt_in_at) fail('Recorded consent is required for a Flow template invitation.', 'FLOW_CONSENT_REQUIRED', 403);
    const template = (await client.query('SELECT * FROM templates WHERE business_id=$1 AND id=$2 FOR SHARE', [session.businessId, input.templateId])).rows[0];
    const button = flowTemplateButton(template);
    if (!button?.flow_id) fail('Select a Flow template with a verified Flow ID.', 'FLOW_TEMPLATE_MISMATCH');
    const flow = (await client.query('SELECT * FROM whatsapp_native_flows WHERE business_id=$1 AND meta_flow_id=$2 FOR SHARE', [session.businessId, button.flow_id])).rows[0];
    const phone = (await client.query("SELECT p.*,a.waba_id,a.access_token_encrypted,a.status AS status FROM whatsapp_phone_numbers p JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id WHERE p.business_id=$1 AND p.phone_number_id=$2 AND p.whatsapp_account_id=$3 AND a.status='connected' FOR SHARE OF p,a", [session.businessId, contact.whatsapp_phone_number_id, flow?.whatsapp_account_id])).rows[0];
    assertFlowTemplateBinding(template, flow, session.businessId, phone);
    const fields = flowFieldNames(flow.flow_json), mapping = validateFlowMapping(flow.response_mapping || [], fields);
    const variables = (template.variables || []).map(key => key === 'name' ? contact.name : input.variables?.[key] ?? '');
    if (variables.length !== variableCount(template.body) || variables.some(value => !String(value).trim())) fail('Provide every template body variable.', 'TEMPLATE_PARAMETERS_INVALID');
    const resolved = {...sendParameters, buttons: [...(sendParameters.buttons || []), {type: 'flow', index: button.index, flowToken: token, ...(flowInvite.actionData !== undefined ? {flowActionData: flowInvite.actionData} : {})}]};
    if (button.flow_action === 'data_exchange' && flowInvite.actionData !== undefined) fail('Initial data is only supported by navigate invitations.', 'FLOW_TEMPLATE_INVALID');
    validateTemplateParameters(template, resolved, {allowFlow: true});
    templateSendComponents(variables, resolved);
    const fingerprint = hash(JSON.stringify([flow.id, contact.id, phone.id, template.id, template.meta_template_name, template.language, variables, sendParameters, flowInvite.expiresHours, flowInvite.actionData]));
    const previous = (await client.query('SELECT status,fingerprint FROM whatsapp_flow_invites WHERE business_id=$1 AND request_id=$2', [session.businessId, flowInvite.requestId])).rows[0];
    if (previous) fail(previous.fingerprint === fingerprint ? 'This invitation was already attempted; check its status.' : 'Operation reference has different inputs.', 'FLOW_SEND_ALREADY_ATTEMPTED', 409);
    await deps.assertMessageCapacity(session.businessId, 1, client, contact.id);
    await client.query("INSERT INTO whatsapp_flow_invites (id,business_id,flow_id,contact_id,phone_id,token_hash,request_id,fingerprint,mapping,fields,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()+($11::int*INTERVAL '1 hour'))", [inviteId, session.businessId, flow.id, contact.id, phone.id, hash(token), flowInvite.requestId, fingerprint, JSON.stringify(mapping), JSON.stringify(fields), flowInvite.expiresHours]);
    const runtime=await provisionRuntimeInvite(client,{businessId:session.businessId,flow,contactId:contact.id,phoneId:phone.id,flowToken:token,expiresHours:flowInvite.expiresHours});
    if(runtime&&button.flow_action==='navigate'&&button.navigate_screen!==runtime.initialScreen)fail('The approved template entry screen differs from the live runtime screen.', 'FLOW_SCREEN_INVALID',409);
    return {contact, template, flow, phone, variables, resolved};
  });
  let result;
  try {
    result = await deps.sendTemplateMessage({setup: ready.phone, to: ready.contact.phone, templateName: ready.template.meta_template_name, language: ready.template.language, variables: ready.variables, parameters: ready.resolved});
    if (!result.metaMessageId || result.status !== 'sent') fail('Meta did not confirm this send.', 'FLOW_SEND_UNCONFIRMED', 502);
  } catch (error) {
    const failed = error.code === 'META_SEND_FAILED' && error.status >= 400 && error.status < 500 && ![408, 409, 429].includes(error.status);
    await deps.query("UPDATE whatsapp_flow_invites SET status=$1 WHERE business_id=$2 AND id=$3 AND status='processing'", [failed ? 'failed' : 'unconfirmed', session.businessId, inviteId]);
    if (failed) await deps.query('DELETE FROM flow_runtime_sessions WHERE business_id=$1 AND token_hash=$2',[session.businessId,hash(token)]);
    throw error;
  }
  await deps.transaction(async client => {
    await client.query("UPDATE whatsapp_flow_invites SET status=CASE WHEN status='completed' THEN status ELSE 'sent' END,meta_message_id=$1 WHERE business_id=$2 AND id=$3", [result.metaMessageId, session.businessId, inviteId]);
    const body = ready.template.body.replace(/{{\s*(\d+)\s*}}/g, (_, index) => String(ready.variables[Number(index) - 1] ?? ''));
    await client.query("INSERT INTO messages (id,conversation_id,direction,body,status,meta_message_id,message_type,metadata) VALUES ($1,$2,'outgoing',$3,'sent',$4,'template',$5)", [id('m'), ready.contact.conversation_id, body, result.metaMessageId, JSON.stringify({nativeFlowId: ready.flow.id, inviteId, templateId: ready.template.id})]);
    await client.query('UPDATE conversations SET updated_at=NOW(),version=version+1 WHERE business_id=$1 AND id=$2', [session.businessId, ready.contact.conversation_id]);
    await client.query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'flow_template_sent',$4)", [id('a'), session.businessId, session.userId, JSON.stringify({flowId: ready.flow.id, contactId: ready.contact.id, templateId: ready.template.id, inviteId})]);
    await deps.recordSupportResponse(session.businessId, ready.contact.conversation_id, new Date(), client);
  });
  return {ok: true, inviteId, status: 'sent'};
}
export async function flowTemplates(request) {
  try {
    const session = await requireSession(request);
    if (request.method === 'GET') {
      requireWorkspaceManager(session);
      const flows = (await query("SELECT f.* FROM whatsapp_native_flows f JOIN whatsapp_accounts a ON a.id=f.whatsapp_account_id AND a.business_id=f.business_id WHERE f.business_id=$1 AND f.status='published' AND a.status='connected' ORDER BY f.name,f.id", [session.businessId])).rows;
      return json({flows: flows.filter(flow => flow.meta_flow_id && flow.flow_json?.screens?.length && !flow.validation_errors?.length).map(flow => ({id: flow.id, name: flow.name, accountId: flow.whatsapp_account_id, hasEndpoint: Boolean(flow.endpoint_uri), screens: flow.flow_json.screens.map(screen => ({id: screen.id, title: screen.title}))}))});
    }
    const input = await readJsonBodyLimited(request, 65536);
    if (input.action === 'create') return json(await createFlowTemplate(session, input), 201);
    if (input.action === 'send') return json(await sendFlowTemplateInvite(session, input), 201);
    fail('Choose a Flow template operation.', 'FLOW_TEMPLATE_INVALID');
  } catch (error) { return errorJson(error); }
}

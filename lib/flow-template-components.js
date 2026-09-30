import {AppError} from './db.js';

const invalid = () => { throw new AppError('Invalid Flow template parameters.', 400, 'FLOW_TEMPLATE_INVALID'); };
const object = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export function templateButtons(template) {
  const schema = template?.component_schema || template?.componentSchema || {};
  // Meta sync retains the original definitions here, including Flow bindings.
  return schema.components?.find(component => String(component.type).toUpperCase() === 'BUTTONS')?.buttons || schema.buttons || template?.buttons || [];
}
export function flowTemplateButton(template) {
  const matches = templateButtons(template).map((button, index) => ({...button, index})).filter(button => String(button.type).toUpperCase() === 'FLOW');
  if (matches.length > 1) invalid();
  return matches[0] || null;
}
export function flowCreationButton(schema) {
  const {flowMetaId, flowButtonText, flowAction = 'navigate', flowScreen} = schema;
  if (typeof flowMetaId !== 'string' || !/^[0-9]{1,32}$/.test(flowMetaId) || typeof flowButtonText !== 'string' || !flowButtonText.trim() || flowButtonText.trim().length > 25 || !['navigate', 'data_exchange'].includes(flowAction)) invalid();
  if (flowAction === 'navigate' && (typeof flowScreen !== 'string' || !/^[A-Za-z0-9_]{1,80}$/.test(flowScreen))) invalid();
  if (flowAction === 'data_exchange' && flowScreen) invalid();
  return {type: 'FLOW', text: flowButtonText.trim(), flow_id: flowMetaId, flow_action: flowAction, ...(flowAction === 'navigate' ? {navigate_screen: flowScreen} : {})};
}
export function validateFlowActionData(data) {
  if (!object(data)) invalid();
  let count = 0;
  const walk = (value, depth) => {
    if (++count > 2000 || depth > 10) invalid();
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (Array.isArray(value)) { value.forEach(item => walk(item, depth + 1)); return; }
    if (!object(value)) invalid();
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype', 'flow_token'].includes(key)) invalid();
      walk(item, depth + 1);
    }
  };
  walk(data, 0);
  if (JSON.stringify(data).length > 16000) invalid();
  return data;
}
export function flowSendParameter(button) {
  if (!object(button) || Object.keys(button).some(key => !['index', 'type', 'flowToken', 'flowActionData'].includes(key)) || !Number.isInteger(button.index) || button.index < 0 || button.index > 9 || button.type !== 'flow' || typeof button.flowToken !== 'string' || !/^[a-f0-9]{64}$/.test(button.flowToken)) invalid();
  const action = {flow_token: button.flowToken};
  if (button.flowActionData !== undefined) action.flow_action_data = validateFlowActionData(button.flowActionData);
  return {type: 'action', action};
}
export function validateFlowInvite(input) {
  if (!object(input) || Object.keys(input).some(key => !['requestId', 'expiresHours', 'actionData'].includes(key)) || !/^[A-Za-z0-9_-]{16,100}$/.test(input.requestId || '') || !Number.isInteger(input.expiresHours) || input.expiresHours < 1 || input.expiresHours > 168) invalid();
  if (input.actionData !== undefined) validateFlowActionData(input.actionData);
  return input;
}

import { AppError } from './db.js';

function invalid() {
  throw new AppError('Template parameters are invalid or unsupported.', 400, 'TEMPLATE_PARAMETERS_INVALID');
}

export function validateTemplateParameters(template, input = {}) {
  templateSendComponents([], input);
  const format = String(template?.component_schema?.headerFormat || 'NONE').toLowerCase();
  if (['image', 'video', 'document'].includes(format) && input.header?.type !== format) {
    throw new AppError('This template requires a matching media header.', 400, 'TEMPLATE_HEADER_REQUIRED');
  }
  const buttons = template?.component_schema?.buttons || template?.buttons || [];
  for (const button of input.buttons || []) {
    const definition = buttons[button.index];
    if (!definition || String(definition.type).toLowerCase() !== button.type) invalid();
  }
  for (const [index, button] of buttons.entries()) {
    if (String(button.type).toUpperCase() === 'URL' && /{{\s*\d+\s*}}/.test(button.value || button.url || '') && !input.buttons?.some((item) => item.index === index && item.type === 'url')) {
      throw new AppError('Provide the dynamic URL button value.', 400, 'TEMPLATE_BUTTON_REQUIRED');
    }
  }
  return input;
}

export function templateSendComponents(variables = [], input = {}) {
  if (!Array.isArray(variables) || !input || typeof input !== 'object' || Array.isArray(input)) invalid();
  if (Object.keys(input).some((key) => !['header', 'buttons'].includes(key))) invalid();
  const components = [];
  if (input.header) {
    const header = input.header;
    if (!header || typeof header !== 'object' || Array.isArray(header)) invalid();
    const type = String(header.type || '').toLowerCase();
    let parameter;
    if (type === 'text') {
      if (typeof header.text !== 'string' || !header.text.trim() || header.text.length > 1024) invalid();
      parameter = { type, text: header.text };
    } else if (['image', 'video', 'document'].includes(type)) {
      if (Boolean(header.id) === Boolean(header.link)) invalid();
      const media = {};
      if (header.id) {
        if (!/^\d+$/.test(String(header.id))) invalid();
        media.id = String(header.id);
      } else {
        let url;
        try { url = new URL(header.link); } catch { invalid(); }
        if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2000) invalid();
        media.link = url.href;
      }
      if (type === 'document' && header.filename) {
        if (typeof header.filename !== 'string' || header.filename.length > 255 || /[\r\n]/.test(header.filename)) invalid();
        media.filename = header.filename;
      }
      parameter = { type, [type]: media };
    } else invalid();
    components.push({ type: 'header', parameters: [parameter] });
  }
  if (variables.length) {
    if (variables.length > 100 || variables.some((value) => !['string', 'number'].includes(typeof value) || String(value).length > 32768)) invalid();
    components.push({ type: 'body', parameters: variables.map((value) => ({ type: 'text', text: String(value) })) });
  }
  if (input.buttons !== undefined) {
    if (!Array.isArray(input.buttons) || input.buttons.length > 10) invalid();
    const indices = new Set();
    for (const button of input.buttons) {
      if (!button || typeof button !== 'object' || !Number.isInteger(button.index) || button.index < 0 || button.index > 9 || indices.has(button.index)) invalid();
      indices.add(button.index);
      const subtype = String(button.type || '').toLowerCase();
      if (!['url', 'quick_reply', 'copy_code'].includes(subtype) || typeof button.value !== 'string' || !button.value.trim() || button.value.length > 2000) invalid();
      const parameter = subtype === 'quick_reply' ? { type: 'payload', payload: button.value }
        : subtype === 'copy_code' ? { type: 'coupon_code', coupon_code: button.value }
          : { type: 'text', text: button.value };
      components.push({ type: 'button', sub_type: subtype, index: String(button.index), parameters: [parameter] });
    }
  }
  return components;
}

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export const ADVANCED_NODE_TYPES = ['attribute_condition', 'set_contact_attribute', 'api_request', 'order_lookup', 'set_order_status'];
export const CONDITION_OPERATORS = ['exists', 'not_exists', 'equals', 'not_equals', 'contains', 'gt', 'gte', 'lt', 'lte'];
export function nodeError(code, message = 'Advanced automation node failed.') {
  return Object.assign(new Error(message), { code, status: 400, noRetry: true });
}
const invalid = () => { throw nodeError('AUTOMATION_NODE_INVALID', 'Invalid advanced node configuration.'); };
export function attributeKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) || forbidden.has(value)) invalid();
  return value;
}
export function scalar(value) {
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 4096)) return value;
  invalid();
}
export function readPath(value, path) {
  if (typeof path !== 'string' || path.length > 256 || !path.split('.').every(key => /^[A-Za-z0-9_-]+$/.test(key) && !forbidden.has(key)) || path.split('.').length > 8) invalid();
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}
export function normalizeMapping(mapping = []) {
  if (!Array.isArray(mapping) || mapping.length > 20) invalid();
  const keys = new Set();
  return mapping.map(item => {
    const key = attributeKey(item.key);
    if (keys.has(key)) invalid();
    keys.add(key);
    readPath({}, item.path);
    return { key, path: item.path, required: item.required === true };
  });
}
export function mapResponse(value, mapping) {
  const result = {};
  for (const item of normalizeMapping(mapping)) {
    const found = readPath(value, item.path);
    if (found === undefined) {
      if (item.required) throw nodeError('AUTOMATION_MAPPING_MISSING');
      continue;
    }
    result[item.key] = scalar(found);
  }
  return result;
}
export function valueSource(source) {
  if (!source || !['literal', 'context', 'attribute'].includes(source.kind)) invalid();
  return source.kind === 'literal' ? { kind: 'literal', value: scalar(source.value) } : { kind: source.kind, key: attributeKey(source.key) };
}
export function resolveValue(source, context, attributes) {
  const normalized = valueSource(source);
  const values = normalized.kind === 'context' ? context : attributes;
  if (normalized.kind === 'literal') return normalized.value;
  if (!Object.hasOwn(values, normalized.key)) throw nodeError('AUTOMATION_VALUE_MISSING');
  return scalar(values[normalized.key]);
}
export function normalizeAdvancedNode(node) {
  if (!ADVANCED_NODE_TYPES.includes(node.type)) return {};
  if (typeof node.next !== 'string' || !node.next || typeof node.errorNext !== 'string' || !node.errorNext) invalid();
  const result = { inputKind: 'none', body: '', options: [], next: node.next, errorNext: node.errorNext };
  if (node.type === 'attribute_condition') {
    if (!CONDITION_OPERATORS.includes(node.operator) || !node.falseNext) invalid();
    Object.assign(result, { attribute: attributeKey(node.attribute), operator: node.operator, falseNext: node.falseNext });
    if (!['exists', 'not_exists'].includes(node.operator)) result.compareValue = scalar(node.compareValue);
  } else if (node.type === 'set_contact_attribute') {
    Object.assign(result, { attribute: attributeKey(node.attribute), valueSource: valueSource(node.valueSource) });
  } else if (node.type === 'api_request') {
    if (typeof node.connectionId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(node.connectionId)) invalid();
    if (node.url || node.headers || node.credentials || node.method) invalid();
    const requestFields = node.requestFields || [];
    if (!Array.isArray(requestFields) || requestFields.length > 20 || new Set(requestFields.map(item => item.key)).size !== requestFields.length) invalid();
    const timeoutNext = typeof node.timeoutNext === 'string' ? node.timeoutNext : '';
    if (!timeoutNext) invalid();
    const statusBranches = Array.isArray(node.statusBranches) ? node.statusBranches : [];
    if (statusBranches.length > 12) invalid();
    const seen = new Set();
    const normalizedStatuses = statusBranches.map(item => {
      const status = String(item.status || '').trim().toLowerCase();
      if (!/^(?:[1-5]\d\d|[1-5]xx)$/.test(status) || seen.has(status) || typeof item.next !== 'string' || !item.next) invalid();
      seen.add(status);
      return { status, next: item.next };
    });
    const unmatchedStatusNext = typeof node.unmatchedStatusNext === 'string' && node.unmatchedStatusNext ? node.unmatchedStatusNext : '';
    Object.assign(result, { connectionId: node.connectionId, timeoutNext, unmatchedStatusNext, statusBranches: normalizedStatuses, requestFields: requestFields.map(item => ({ key: attributeKey(item.key), source: valueSource(item.source) })), responseMapping: normalizeMapping(node.responseMapping) });
  } else {
    Object.assign(result, { orderIdSource: valueSource(node.orderIdSource) });
    if (node.type === 'order_lookup') result.responseMapping = normalizeMapping(node.responseMapping);
    else {
      if (!['pending', 'processing', 'shipped', 'completed', 'cancelled'].includes(node.orderStatus)) invalid();
      result.orderStatus = node.orderStatus;
    }
  }
  return result;
}
export function matchesAttribute(attributes, node) {
  const exists = Object.hasOwn(attributes, node.attribute) && attributes[node.attribute] !== null;
  const value = exists ? scalar(attributes[node.attribute]) : undefined;
  const expected = node.compareValue;
  switch (node.operator) {
    case 'exists': return exists;
    case 'not_exists': return !exists;
    case 'equals': return exists && value === expected;
    case 'not_equals': return exists && value !== expected;
    case 'contains': return typeof value === 'string' && typeof expected === 'string' && value.includes(expected);
    default:
      if (typeof value !== 'number' || typeof expected !== 'number') return false;
      return { gt: value > expected, gte: value >= expected, lt: value < expected, lte: value <= expected }[node.operator] === true;
  }
}
// Effects are injected so the interpreter cannot execute code or choose network URLs.
export async function executeAdvancedNode({ node, context, effects }) {
  node = { ...node, ...normalizeAdvancedNode(node) };
  try {
    await effects.guard();
    const attributes = await effects.attributes();
    let patch = {};
    let next = node.next;
    if (node.type === 'attribute_condition') next = matchesAttribute(attributes, node) ? node.next : node.falseNext;
    else if (node.type === 'set_contact_attribute') await effects.setAttribute(node.attribute, resolveValue(node.valueSource, context, attributes));
    else if (node.type === 'api_request') {
      const fields = Object.fromEntries(node.requestFields.map(item => [item.key, resolveValue(item.source, context, attributes)]));
      const response = await effects.request(node.connectionId, fields);
      const status = Number(response?.statusCode || 200);
      const data = Object.hasOwn(response || {}, 'data') ? response.data : response;
      const branch = node.statusBranches.find(item => item.status === String(status))
        || node.statusBranches.find(item => item.status === `${Math.floor(status / 100)}xx`);
      if (branch) next = branch.next;
      else if (status < 200 || status >= 300) {
        if (node.unmatchedStatusNext) next = node.unmatchedStatusNext;
        else {
          next = node.errorNext;
          return { next, context: { ...context, automationApiStatus: status, automationError: 'AUTOMATION_API_HTTP_ERROR' } };
        }
      }
      patch = mapResponse(data, node.responseMapping);
      patch.automationApiStatus = status;
    } else {
      const orderId = resolveValue(node.orderIdSource, context, attributes);
      if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(orderId)) throw nodeError('AUTOMATION_ORDER_INVALID');
      if (node.type === 'order_lookup') patch = mapResponse(await effects.order(orderId), node.responseMapping);
      else await effects.setOrderStatus(orderId, node.orderStatus);
    }
    return { next, context: { ...context, ...patch, automationError: '' } };
  } catch (error) {
    if (['AUTOMATION_OPTED_OUT', 'AUTOMATION_SUPERSEDED'].includes(error.code)) throw error;
    const timeout = ['AUTOMATION_API_TIMEOUT', 'AUTOMATION_API_DNS_TIMEOUT'].includes(error.code);
    return { next: timeout && node.timeoutNext ? node.timeoutNext : node.errorNext, context: { ...context, automationApiStatus: Number(error.httpStatus || 0), automationError: /^AUTOMATION_[A-Z_]+$/.test(error.code || '') ? error.code : 'AUTOMATION_ACTION_FAILED' } };
  }
}

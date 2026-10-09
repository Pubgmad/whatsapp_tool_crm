import { AppError } from './db.js';

export const AUDIENCE_RULE_VERSION = 2;
export const AUDIENCE_RULE_LIMITS = Object.freeze({ maxDepth: 4, maxChildren: 50, maxNodes: 100 });

const events = new Set(['sent', 'delivered', 'read', 'replied', 'failed', 'clicked', 'flow_abandoned']);
const attributeOperators = new Set(['equals', 'not_equals', 'contains', 'exists', 'missing']);
const leafTypes = new Set(['permission', 'tags', 'source', 'last_active', 'created', 'engagement', 'attribute', 'purchase']);
const identifier = /^[a-zA-Z0-9_-]{1,100}$/;

function invalid(message = 'Audience rules are invalid.') {
  throw new AppError(message, 400, 'SEGMENT_RULES_INVALID');
}

function days(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 3650) invalid();
  return number;
}

function list(value, { max = 100, lower = false } = {}) {
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  if (items.length > max || items.some(item => typeof item !== 'string' || item.length > 255)) invalid();
  const cleaned = items.map(item => item.trim()).filter(Boolean).map(item => lower ? item.toLowerCase() : item);
  return [...new Set(cleaned)];
}

function normalizeLeaf(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node) || !leafTypes.has(node.type)) invalid();
  if (node.type === 'permission') {
    if (!['all', 'marketable', 'blocked'].includes(node.value)) invalid();
    return { type: node.type, value: node.value };
  }
  if (node.type === 'tags') {
    const values = list(node.values, { lower: true });
    if (!values.length || !['any', 'all'].includes(node.mode)) invalid();
    return { type: node.type, mode: node.mode, values };
  }
  if (node.type === 'source') {
    const values = list(node.values);
    if (!values.length) invalid();
    return { type: node.type, values };
  }
  if (node.type === 'last_active' || node.type === 'created') {
    return { type: node.type, withinDays: days(node.withinDays) || invalid() };
  }
  if (node.type === 'engagement') {
    if (!identifier.test(node.campaignId || '') || !events.has(node.event) || !['matched', 'not_matched'].includes(node.match)) invalid();
    return { type: node.type, campaignId: node.campaignId, event: node.event, match: node.match, withinDays: days(node.withinDays) };
  }
  if (node.type === 'attribute') {
    if (!identifier.test(node.key || '') || !attributeOperators.has(node.operator)) invalid();
    if (!['exists', 'missing'].includes(node.operator) && (typeof node.value !== 'string' || node.value.length > 2000)) invalid();
    return { type: node.type, key: node.key, operator: node.operator, ...(!['exists', 'missing'].includes(node.operator) ? { value: node.value } : {}) };
  }
  if (!['purchased', 'not_purchased'].includes(node.value)) invalid();
  return { type: node.type, value: node.value, withinDays: days(node.withinDays) };
}

function normalizeNode(node, depth, state) {
  state.nodes += 1;
  if (state.nodes > AUDIENCE_RULE_LIMITS.maxNodes || (node?.type === 'group' && depth > AUDIENCE_RULE_LIMITS.maxDepth)) invalid('Audience rule tree is too large.');
  if (node?.type !== 'group') return normalizeLeaf(node);
  if (!['and', 'or'].includes(node.operator) || !Array.isArray(node.children) || node.children.length > AUDIENCE_RULE_LIMITS.maxChildren) invalid();
  return { type: 'group', operator: node.operator, children: node.children.map(child => normalizeNode(child, depth + 1, state)) };
}

function legacyTree(value) {
  if (value.permission && !['all', 'marketable', 'blocked'].includes(value.permission)) invalid();
  if (value.purchase && !['all', 'purchased', 'not_purchased'].includes(value.purchase)) invalid();
  if (value.engagementMode && !['any', 'all'].includes(value.engagementMode)) invalid();
  const engagement = value.engagement || [], attributes = value.attributes || [];
  if (!Array.isArray(engagement) || engagement.length > 10 || !Array.isArray(attributes) || attributes.length > 20) invalid();
  const children = [{ type: 'permission', value: value.permission || 'marketable' }];
  const tags = list(value.tags, { lower: true });
  const sources = list(value.sources);
  if (tags.length) children.push({ type: 'tags', mode: value.tagMode === 'all' ? 'all' : 'any', values: tags });
  if (sources.length) children.push({ type: 'source', values: sources });
  if (value.lastActiveDays !== undefined && value.lastActiveDays !== null && value.lastActiveDays !== '') children.push({ type: 'last_active', withinDays: value.lastActiveDays });
  if (value.createdWithinDays !== undefined && value.createdWithinDays !== null && value.createdWithinDays !== '') children.push({ type: 'created', withinDays: value.createdWithinDays });
  if (engagement.length) {
    children.push({
      type: 'group',
      operator: value.engagementMode === 'any' ? 'or' : 'and',
      children: engagement.map(rule => ({ type: 'engagement', ...rule }))
    });
  }
  children.push(...attributes.map(rule => ({ type: 'attribute', ...rule })));
  if (value.purchase && value.purchase !== 'all') children.push({ type: 'purchase', value: value.purchase, withinDays: value.purchaseWithinDays });
  else if (value.purchaseWithinDays !== undefined && value.purchaseWithinDays !== null && value.purchaseWithinDays !== '') days(value.purchaseWithinDays);
  return { type: 'group', operator: 'and', children };
}

export function normalizeAudienceRules(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  if (value.version !== undefined && value.version !== AUDIENCE_RULE_VERSION) invalid('Unsupported audience rule version.');
  if (value.version === undefined && value.root !== undefined) invalid('Audience rule version is required.');
  const root = value.version === AUDIENCE_RULE_VERSION ? value.root : legacyTree(value);
  if (!root || root.type !== 'group') invalid('Audience rules require a root group.');
  return { version: AUDIENCE_RULE_VERSION, root: normalizeNode(root, 1, { nodes: 0 }) };
}

export function audienceCampaignIds(input) {
  const rules = normalizeAudienceRules(input);
  const ids = new Set();
  const visit = node => {
    if (node.type === 'engagement') ids.add(node.campaignId);
    if (node.type === 'group') node.children.forEach(visit);
  };
  visit(rules.root);
  return [...ids];
}

function engagementSql(rule, bind) {
  const campaign = bind(rule.campaignId);
  let event;
  if (rule.event === 'clicked') {
    const tracked = `EXISTS(SELECT 1 FROM tracked_link_tokens tk WHERE tk.business_id=ct.business_id AND tk.contact_id=ct.id AND tk.campaign_recipient_id=cr.id AND tk.confirmed_at IS NOT NULL${rule.withinDays ? ` AND tk.confirmed_at>=NOW()-${bind(rule.withinDays)}*INTERVAL '1 day'` : ''})`;
    const buttons = `EXISTS(SELECT 1 FROM messages m WHERE m.campaign_recipient_id=cr.id AND m.direction='incoming' AND m.message_type IN ('button','interactive')${rule.withinDays ? ` AND m.at>=NOW()-${bind(rule.withinDays)}*INTERVAL '1 day'` : ''})`;
    const interactive = `EXISTS(SELECT 1 FROM events e WHERE e.business_id=ct.business_id AND e.contact_id=ct.id AND e.type='interactive_button_reply' AND (e.metadata->>'campaignRecipientId')=cr.id::text${rule.withinDays ? ` AND e.at>=NOW()-${bind(rule.withinDays)}*INTERVAL '1 day'` : ''})`;
    event = `(${tracked} OR ${buttons} OR ${interactive})`;
  } else if (rule.event === 'replied') {
    event = `EXISTS (SELECT 1 FROM messages m JOIN conversations cv ON cv.id=m.conversation_id
      WHERE cv.business_id=ct.business_id AND cv.contact_id=ct.id AND m.direction='incoming'
      AND m.campaign_recipient_id=cr.id${rule.withinDays ? ` AND m.at >= NOW() - ${bind(rule.withinDays)} * INTERVAL '1 day'` : ''})`;
  } else if (rule.event === 'flow_abandoned') {
    event = `EXISTS (SELECT 1 FROM whatsapp_flow_invites i WHERE i.business_id=ct.business_id AND i.contact_id=ct.id AND i.status='sent' AND i.expires_at <= NOW()${rule.withinDays ? ` AND i.expires_at >= NOW() - ${bind(rule.withinDays)} * INTERVAL '1 day'` : ''})`;
  } else {
    const statuses = rule.event === 'sent' ? ['sent', 'delivered', 'read'] : rule.event === 'delivered' ? ['delivered', 'read'] : [rule.event];
    event = `cr.status = ANY(${bind(statuses)}::text[])`;
    if (rule.withinDays) event += ` AND ${rule.event === 'failed' ? 'cr.updated_at' : 'cr.sent_at'} >= NOW() - ${bind(rule.withinDays)} * INTERVAL '1 day'`;
  }
  return `EXISTS (SELECT 1 FROM campaign_recipients cr JOIN campaigns k ON k.id=cr.campaign_id
    WHERE k.business_id=ct.business_id AND cr.contact_id=ct.id AND cr.campaign_id=${campaign}
    AND ${rule.match === 'not_matched' ? `NOT COALESCE((${event}), FALSE)` : `(${event})`})`;
}

function compileNode(node, bind) {
  if (node.type === 'group') {
    if (!node.children.length) return node.operator === 'and' ? 'TRUE' : 'FALSE';
    return `(${node.children.map(child => compileNode(child, bind)).join(node.operator === 'and' ? ' AND ' : ' OR ')})`;
  }
  if (node.type === 'permission') {
    if (node.value === 'all') return 'TRUE';
    return node.value === 'marketable'
      ? '(ct.marketing_permission = TRUE AND ct.unsubscribed = FALSE)'
      : '(ct.marketing_permission = FALSE OR ct.unsubscribed = TRUE)';
  }
  if (node.type === 'tags') return `ct.tags ${node.mode === 'all' ? '?&' : '?|'} ${bind(node.values)}::text[]`;
  if (node.type === 'source') return `ct.source = ANY(${bind(node.values)}::text[])`;
  if (node.type === 'last_active') return `ct.last_message_at >= NOW() - ${bind(node.withinDays)} * INTERVAL '1 day'`;
  if (node.type === 'created') return `ct.created_at >= NOW() - ${bind(node.withinDays)} * INTERVAL '1 day'`;
  if (node.type === 'engagement') return engagementSql(node, bind);
  if (node.type === 'attribute') {
    const key = bind(node.key), field = `(ct.custom_attributes ->> ${key})`;
    if (node.operator === 'exists') return `(ct.custom_attributes ? ${key} AND ${field} IS NOT NULL)`;
    if (node.operator === 'missing') return `(NOT (ct.custom_attributes ? ${key}) OR ${field} IS NULL)`;
    if (node.operator === 'contains') return `STRPOS(LOWER(${field}), LOWER(${bind(node.value)})) > 0`;
    return `${field} ${node.operator === 'equals' ? '=' : '<>'} ${bind(node.value)}`;
  }
  const purchase = `EXISTS (SELECT 1 FROM whatsapp_orders o WHERE o.business_id=ct.business_id
    AND o.customer_phone=ct.phone AND o.payment_status IN ('captured','partially_refunded')${node.withinDays ? ` AND o.payment_event_at >= NOW() - ${bind(node.withinDays)} * INTERVAL '1 day'` : ''})`;
  return (node.value === 'not_purchased' ? 'NOT ' : '') + purchase;
}

export function audienceContactQuery(businessId, input, { count = false } = {}) {
  const rules = normalizeAudienceRules(input);
  const params = [businessId];
  const bind = value => { params.push(value); return '$' + params.length; };
  const predicate = compileNode(rules.root, bind);
  return {
    text: `SELECT ${count ? 'COUNT(*)::int AS count' : 'ct.id'} FROM contacts ct WHERE ct.business_id = $1 AND ${predicate}${count ? '' : ' ORDER BY ct.created_at DESC, ct.id'}`,
    params
  };
}

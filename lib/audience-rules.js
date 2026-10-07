import { AppError } from './db.js';

const events = ['sent', 'delivered', 'read', 'replied', 'failed', 'clicked', 'flow_abandoned'];
const operators = ['equals', 'not_equals', 'contains', 'exists', 'missing'];
function invalid() { throw new AppError('Audience rules are invalid.', 400, 'SEGMENT_RULES_INVALID'); }
function days(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 3650) invalid();
  return number;
}
function list(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  if (items.length > 100 || items.some(item => typeof item !== 'string' || item.length > 255)) invalid();
  return [...new Set(items.map(item => item.trim()).filter(Boolean))];
}

export function normalizeAudienceRules(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  if (value.permission && !['all', 'marketable', 'blocked'].includes(value.permission)) invalid();
  if (value.purchase && !['all', 'purchased', 'not_purchased'].includes(value.purchase)) invalid();
  if (value.engagementMode && !['any', 'all'].includes(value.engagementMode)) invalid();
  const engagement = value.engagement || [], attributes = value.attributes || [];
  if (!Array.isArray(engagement) || engagement.length > 10 || !Array.isArray(attributes) || attributes.length > 20) invalid();
  return {
    permission: value.permission || 'marketable', tagMode: value.tagMode === 'all' ? 'all' : 'any',
    tags: list(value.tags).map(tag => tag.toLowerCase()), sources: list(value.sources),
    lastActiveDays: days(value.lastActiveDays), createdWithinDays: days(value.createdWithinDays),
    engagementMode: value.engagementMode === 'any' ? 'any' : 'all',
    engagement: engagement.map(rule => {
      if (!rule || !events.includes(rule.event) || !['matched', 'not_matched'].includes(rule.match) || typeof rule.campaignId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(rule.campaignId)) invalid();
      return { campaignId: rule.campaignId, event: rule.event, match: rule.match, withinDays: days(rule.withinDays) };
    }),
    attributes: attributes.map(rule => {
      if (!rule || typeof rule.key !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(rule.key) || !operators.includes(rule.operator)) invalid();
      if (!['exists', 'missing'].includes(rule.operator) && (typeof rule.value !== 'string' || rule.value.length > 2000)) invalid();
      return { key: rule.key, operator: rule.operator, ...(!['exists', 'missing'].includes(rule.operator) ? { value: rule.value } : {}) };
    }),
    purchase: value.purchase || 'all', purchaseWithinDays: days(value.purchaseWithinDays)
  };
}

export function audienceContactQuery(businessId, input, { count = false } = {}) {
  const rules = normalizeAudienceRules(input);
  const params = [businessId], clauses = ['ct.business_id = $1'];
  const bind = value => { params.push(value); return '$' + params.length; };
  if (rules.permission === 'marketable') clauses.push('ct.marketing_permission = TRUE AND ct.unsubscribed = FALSE');
  if (rules.permission === 'blocked') clauses.push('(ct.marketing_permission = FALSE OR ct.unsubscribed = TRUE)');
  if (rules.tags.length) clauses.push(`ct.tags ${rules.tagMode === 'all' ? '?&' : '?|'} ${bind(rules.tags)}::text[]`);
  if (rules.sources.length) clauses.push(`ct.source = ANY(${bind(rules.sources)}::text[])`);
  if (rules.lastActiveDays) clauses.push(`ct.last_message_at >= NOW() - ${bind(rules.lastActiveDays)} * INTERVAL '1 day'`);
  if (rules.createdWithinDays) clauses.push(`ct.created_at >= NOW() - ${bind(rules.createdWithinDays)} * INTERVAL '1 day'`);
  if (rules.engagement.length) {
    const conditions = rules.engagement.map(rule => {
      const campaign = bind(rule.campaignId);
      let event;
      if (rule.event === 'clicked') {
        const tracked = `EXISTS(SELECT 1 FROM tracked_link_tokens tk WHERE tk.business_id=ct.business_id AND tk.contact_id=ct.id AND tk.campaign_recipient_id=cr.id AND tk.confirmed_at IS NOT NULL${rule.withinDays ? ` AND tk.confirmed_at>=NOW()-${bind(rule.withinDays)}*INTERVAL '1 day'` : ''})`;
        const buttons = `EXISTS(SELECT 1 FROM messages m WHERE m.campaign_recipient_id=cr.id AND m.direction='incoming' AND m.message_type IN ('button','interactive')${rule.withinDays ? ` AND m.at>=NOW()-${bind(rule.withinDays)}*INTERVAL '1 day'` : ''})`;
        const interactiveEvents = `EXISTS(SELECT 1 FROM events e WHERE e.business_id=ct.business_id AND e.contact_id=ct.id AND e.type='interactive_button_reply' AND (e.metadata->>'campaignRecipientId')=cr.id::text${rule.withinDays ? ` AND e.created_at>=NOW()-${bind(rule.withinDays)}*INTERVAL '1 day'` : ''})`;
        event = `(${tracked} OR ${buttons} OR ${interactiveEvents})`;
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
      // Negative matches apply only to actual recipients, never unrelated contacts.
      return `EXISTS (SELECT 1 FROM campaign_recipients cr JOIN campaigns k ON k.id=cr.campaign_id
        WHERE k.business_id=ct.business_id AND cr.contact_id=ct.id AND cr.campaign_id=${campaign}
        AND ${rule.match === 'not_matched' ? 'NOT COALESCE((' + event + '), FALSE)' : '(' + event + ')'})`;
    });
    clauses.push('(' + conditions.join(rules.engagementMode === 'any' ? ' OR ' : ' AND ') + ')');
  }
  for (const rule of rules.attributes) {
    const key = bind(rule.key), field = `(ct.custom_attributes ->> ${key})`;
    if (rule.operator === 'exists') clauses.push(`ct.custom_attributes ? ${key} AND ${field} IS NOT NULL`);
    else if (rule.operator === 'missing') clauses.push(`(NOT (ct.custom_attributes ? ${key}) OR ${field} IS NULL)`);
    else if (rule.operator === 'contains') clauses.push(`STRPOS(LOWER(${field}), LOWER(${bind(rule.value)})) > 0`);
    else clauses.push(`${field} ${rule.operator === 'equals' ? '=' : '<>'} ${bind(rule.value)}`);
  }
  if (rules.purchase !== 'all') {
    const purchase = `EXISTS (SELECT 1 FROM whatsapp_orders o WHERE o.business_id=ct.business_id
      AND o.customer_phone=ct.phone AND o.payment_status IN ('captured','partially_refunded')${rules.purchaseWithinDays ? ` AND o.payment_event_at >= NOW() - ${bind(rules.purchaseWithinDays)} * INTERVAL '1 day'` : ''})`;
    clauses.push((rules.purchase === 'not_purchased' ? 'NOT ' : '') + purchase);
  }
  return { text: `SELECT ${count ? 'COUNT(*)::int AS count' : 'ct.id'} FROM contacts ct WHERE ${clauses.join(' AND ')}${count ? '' : ' ORDER BY ct.created_at DESC, ct.id'}`, params };
}

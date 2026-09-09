import { AppError, query } from "./db";

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function run(client, sql, params = []) {
  return client?.query ? client.query(sql, params) : query(sql, params);
}

export async function subscriptionUsage(businessId, client = null) {
  const subscription = (await run(client,
    `SELECT b.review_access, bs.status, bs.current_period_start, bs.current_period_end,
            sp.code, sp.name, sp.description, sp.currency, sp.monthly_price_cents, sp.yearly_price_cents, sp.features,
            sp.contact_limit, sp.campaign_limit, sp.user_limit,
            sp.automation_flow_limit, sp.monthly_message_limit, sp.whatsapp_conversation_limit
     FROM businesses b
     LEFT JOIN business_subscriptions bs ON bs.business_id = b.id
     LEFT JOIN subscription_plans sp ON sp.id = bs.plan_id
     WHERE b.id = $1
     LIMIT 1`,
    [businessId]
  )).rows[0] || {};

  const reviewAccess = Boolean(subscription.review_access);
  const periodStart = subscription.current_period_start || new Date(0);
  const [contacts, campaigns, users, flows, messages] = await Promise.all([
    run(client, "SELECT COUNT(*)::int AS total FROM contacts WHERE business_id = $1", [businessId]),
    run(client, "SELECT COUNT(*)::int AS total FROM campaigns WHERE business_id = $1 AND created_at >= $2", [businessId, periodStart]),
    run(client, "SELECT COUNT(*)::int AS total FROM memberships WHERE business_id = $1", [businessId]),
    run(client, "SELECT COUNT(*)::int AS total FROM automation_flows WHERE business_id = $1 AND status <> 'archived'", [businessId]),
    run(client,
      `SELECT (
         (SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.business_id = $1 AND m.direction = 'outgoing' AND m.at >= $2)
         +
         (SELECT COUNT(*) FROM campaign_recipients cr JOIN campaigns k ON k.id = cr.campaign_id WHERE k.business_id = $1 AND cr.status IN ('sent', 'delivered', 'read') AND COALESCE(cr.sent_at, k.created_at) >= $2)
       )::int AS total`,
      [businessId, periodStart]
    )
  ]);

  return {
    status: reviewAccess ? "review" : subscription.status || "pending",
    reviewAccess,
    periodStart: subscription.current_period_start || null,
    periodEnd: subscription.current_period_end || null,
    plan: {
      code: reviewAccess ? "review-access" : subscription.code || "",
      name: reviewAccess ? "App Review Access" : subscription.name || "Unassigned",
      description: reviewAccess ? "Permanent reviewer workspace with no billing subscription." : subscription.description || "",
      currency: subscription.currency || "INR",
      monthlyPriceCents: Number(subscription.monthly_price_cents || 0),
      yearlyPriceCents: Number(subscription.yearly_price_cents || 0),
      features: Array.isArray(subscription.features) ? subscription.features : []
    },
    limits: {
      contacts: reviewAccess ? null : numberOrNull(subscription.contact_limit),
      campaigns: reviewAccess ? null : numberOrNull(subscription.campaign_limit),
      users: reviewAccess ? null : numberOrNull(subscription.user_limit),
      automationFlows: reviewAccess ? null : numberOrNull(subscription.automation_flow_limit),
      messages: reviewAccess ? null : numberOrNull(subscription.monthly_message_limit),
      whatsappConversations: reviewAccess ? null : numberOrNull(subscription.whatsapp_conversation_limit)
    },
    usage: {
      contacts: contacts.rows[0]?.total || 0,
      campaigns: campaigns.rows[0]?.total || 0,
      users: users.rows[0]?.total || 0,
      automationFlows: flows.rows[0]?.total || 0,
      messages: messages.rows[0]?.total || 0
    }
  };
}

export function limitReached(label, limit, used, increment = 1) {
  return limit !== null && used + increment > limit
    ? new AppError(`${label} limit reached for the current subscription plan.`, 402, "SUBSCRIPTION_LIMIT_REACHED")
    : null;
}

export async function assertContactCapacity(businessId, increment = 1, client = null) {
  const plan = await subscriptionUsage(businessId, client);
  const error = limitReached("Contact", plan.limits.contacts, plan.usage.contacts, increment);
  if (error) throw error;
  return plan;
}

export async function assertCampaignCapacity(businessId, messageCount = 1, client = null) {
  const plan = await subscriptionUsage(businessId, client);
  const campaignError = limitReached("Campaign", plan.limits.campaigns, plan.usage.campaigns, 1);
  if (campaignError) throw campaignError;
  const messageError = limitReached("Message", plan.limits.messages, plan.usage.messages, messageCount);
  if (messageError) throw messageError;
  return plan;
}

export async function assertAutomationFlowCapacity(businessId, isUpdate = false, client = null) {
  if (isUpdate) return subscriptionUsage(businessId, client);
  const plan = await subscriptionUsage(businessId, client);
  const error = limitReached("Automation flow", plan.limits.automationFlows, plan.usage.automationFlows, 1);
  if (error) throw error;
  return plan;
}

export async function assertMessageCapacity(businessId, increment = 1, client = null) {
  const plan = await subscriptionUsage(businessId, client);
  const error = limitReached("Message", plan.limits.messages, plan.usage.messages, increment);
  if (error) throw error;
  return plan;
}

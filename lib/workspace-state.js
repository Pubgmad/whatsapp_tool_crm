import { query, toIso } from './db.js';
import { subscriptionUsage } from './limits.js';
import { getPublicPlatformConfig } from './platform.js';
import { workspaceFeatureFlags } from './feature-controls.js';
import { listAudienceSegments } from './segments.js';
import { getWhatsAppOperationsState } from './whatsapp-operations.js';
import { listAutomationFlows } from './automation.js';
import { campaignReportStatus } from './campaign-controls.js';
import { campaignSourceFilter } from './campaign-source.js';
import {
  mapCampaign,
  mapContact,
  mapConversation,
  mapMessage,
  mapRecipient,
  mapSetup,
  mapTemplate,
  campaignStats,
  clean
} from './workspace-mappers.js';
import { loadWorkspaceInbox } from './workspace-inbox-loader.js';
import { operationalPolicy } from './operational-policy.js';
export const WORKSPACE_VIEWS = new Set(["overview", "setup", "contacts", "team", "billing", "security", "templates", "automation", "campaigns", "results", "inbox", "unsubscribes", "commerce", "conversions", "calling", "ads"]);
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export function stateOptions(request) {
  const params = new URL(request.url).searchParams;
  const requestedView = clean(params.get("view"));
  const source = campaignSourceFilter(params);
  const positiveInteger = (name, fallback, maximum = Number.MAX_SAFE_INTEGER) =>
    Math.max(1, Math.min(Number.parseInt(params.get(name), 10) || fallback, maximum));
  return {
    view: WORKSPACE_VIEWS.has(requestedView) ? requestedView : "overview",
    page: positiveInteger("page", 1),
    pageSize: positiveInteger("pageSize", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
    messagePage: positiveInteger("messagePage", 1),
    notePage: positiveInteger("notePage", 1),
    conversationId: clean(params.get("conversationId")),
    q: clean(params.get("q")).slice(0, 120),
    contactMode: ["all", "marketable", "suppressed"].includes(clean(params.get("mode"))) ? clean(params.get("mode")) : "all",
    sourceKind: source.sourceKind,
    sourceId: source.sourceId,
    inboxFilter: ["all", "mine", "unassigned", "human", "intervened", "unread", "closed", "replyable", "active", "requesting"].includes(clean(params.get("inboxFilter")))
      ? clean(params.get("inboxFilter"))
      : ""
  };
}

function pageMeta(total, page, pageSize) {
  const pages = Math.max(1, Math.ceil(Number(total || 0) / pageSize));
  return { page: Math.min(page, pages), pageSize, total: Number(total || 0), pages };
}

async function pagedContacts(businessId, options, mode = "all") {
  const condition = mode === "marketable"
    ? "AND marketing_permission = TRUE AND unsubscribed = FALSE"
    : mode === "suppressed" ? "AND (unsubscribed = TRUE OR marketing_permission = FALSE)" : "";
  const q = clean(options.q);
  const searchArg = q ? `%${q}%` : null;
  const searchCount = searchArg
    ? `AND (name ILIKE $2 OR phone ILIKE $2 OR opt_in_source ILIKE $2 OR EXISTS (SELECT 1 FROM unnest(tags) t WHERE t ILIKE $2))`
    : "";
  const searchList = searchArg
    ? `AND (name ILIKE $4 OR phone ILIKE $4 OR opt_in_source ILIKE $4 OR EXISTS (SELECT 1 FROM unnest(tags) t WHERE t ILIKE $4))`
    : "";
  const countParams = searchArg ? [businessId, searchArg] : [businessId];
  const totalResult = await query(
    `SELECT COUNT(*)::int AS total FROM contacts WHERE business_id = $1 ${condition} ${searchCount}`,
    countParams
  );
  const pagination = pageMeta(totalResult.rows[0]?.total, options.page, options.pageSize);
  const listParams = searchArg
    ? [businessId, pagination.pageSize, (pagination.page - 1) * pagination.pageSize, searchArg]
    : [businessId, pagination.pageSize, (pagination.page - 1) * pagination.pageSize];
  const rows = await query(
    `SELECT * FROM contacts WHERE business_id = $1 ${condition} ${searchList} ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    listParams
  );
  return { contacts: rows.rows.map(mapContact), pagination };
}

async function loadCampaignResults(businessId, options) {
  const recipientPreviewLimit = options.recipientPreviewLimit ?? options.pageSize;
  const sourceKind = options.sourceKind || '';
  const sourceId = options.sourceId || '';
  const totalResult = await query(
    "SELECT COUNT(*)::int AS total FROM campaigns WHERE business_id=$1 AND ($2='' OR source_kind=$2) AND ($3='' OR source_id=$3)",
    [businessId, sourceKind, sourceId]
  );
  const pagination = pageMeta(totalResult.rows[0]?.total, options.page, options.pageSize);
  const campaigns = await query(
    "SELECT * FROM campaigns WHERE business_id=$1 AND ($2='' OR source_kind=$2) AND ($3='' OR source_id=$3) ORDER BY created_at DESC LIMIT $4 OFFSET $5",
    [businessId, sourceKind, sourceId, pagination.pageSize, (pagination.page - 1) * pagination.pageSize]
  );
  const campaignIds = campaigns.rows.map((campaign) => campaign.id);
  const skipRecipients = recipientPreviewLimit <= 0;
  const [recipients, statRows] = campaignIds.length ? await Promise.all([
    skipRecipients
      ? Promise.resolve({ rows: [] })
      : query(
          `WITH ranked AS (
         SELECT cr.*, ct.name AS contact_name, ct.phone AS contact_phone,
           j.status AS job_status,j.attempts AS job_attempts,j.max_attempts AS job_max_attempts,j.run_at AS job_run_at,j.error_message AS job_error_message,
           EXISTS (SELECT 1 FROM messages m WHERE m.campaign_recipient_id = cr.id AND m.direction = 'incoming') AS replied,
           ROW_NUMBER() OVER (PARTITION BY cr.campaign_id ORDER BY cr.sent_at DESC NULLS LAST, cr.id) AS recipient_rank
         FROM campaign_recipients cr JOIN contacts ct ON ct.id = cr.contact_id
         LEFT JOIN campaign_jobs j ON j.campaign_recipient_id=cr.id
         WHERE cr.campaign_id = ANY($1) AND ct.business_id=$3
       )
       SELECT * FROM ranked WHERE recipient_rank <= $2 ORDER BY campaign_id, recipient_rank`,
          [campaignIds, recipientPreviewLimit, businessId]
        ),
    query(
      `SELECT cr.campaign_id, COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE cr.status = 'queued')::int AS queued,
         COUNT(*) FILTER (WHERE cr.status = 'sent')::int AS sent,
         COUNT(*) FILTER (WHERE cr.status = 'delivered')::int AS delivered,
         COUNT(*) FILTER (WHERE cr.status = 'read')::int AS read,
         COUNT(*) FILTER (WHERE cr.status = 'failed')::int AS failed,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM messages m WHERE m.campaign_recipient_id = cr.id AND m.direction = 'incoming'
         ))::int AS replied
       FROM campaign_recipients cr JOIN campaigns camp ON camp.id=cr.campaign_id
       WHERE cr.campaign_id = ANY($1) AND camp.business_id=$2 GROUP BY cr.campaign_id`,
      [campaignIds, businessId]
    )
  ]) : [{ rows: [] }, { rows: [] }];
  return {
    campaigns: campaigns.rows.map((campaign) => {
      const campaignRecipients = recipients.rows
        .filter((recipient) => recipient.campaign_id === campaign.id)
        .map((recipient) => ({ ...mapRecipient(recipient), contactName: recipient.contact_name, contactPhone: recipient.contact_phone }));
      const aggregate = statRows.rows.find((row) => row.campaign_id === campaign.id);
      const stats = aggregate
        ? Object.fromEntries(["total", "queued", "sent", "delivered", "read", "failed", "replied"].map((key) => [key, Number(aggregate[key] || 0)]))
        : campaignStats(campaignRecipients);
      const mapped = mapCampaign(campaign);
      const status = campaignReportStatus(mapped,stats);
      return { ...mapped, status, recipients: campaignRecipients, recipientPreviewLimit, stats, statsOnly: skipRecipients };
    }),
    pagination
  };
}

async function loadOverview(businessId) {
  const [contacts, campaigns, conversations, templates, flows, delivery, latest] = await Promise.all([
    query("SELECT COUNT(*) FILTER (WHERE marketing_permission = TRUE AND unsubscribed = FALSE)::int AS marketable FROM contacts WHERE business_id = $1", [businessId]),
    query("SELECT COUNT(*)::int AS total FROM campaigns WHERE business_id = $1", [businessId]),
    query(`SELECT COUNT(*) FILTER (WHERE ct.last_message_at >= NOW() - INTERVAL '24 hours')::int AS open FROM conversations c JOIN contacts ct ON ct.id = c.contact_id WHERE c.business_id = $1`, [businessId]),
    query("SELECT COUNT(*) FILTER (WHERE status = 'Approved')::int AS approved FROM templates WHERE business_id = $1", [businessId]),
    query("SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active FROM automation_flows WHERE business_id = $1", [businessId]),
    query(`SELECT COUNT(*) FILTER (WHERE cr.status IN ('delivered','read'))::int AS delivered,
      COUNT(*) FILTER (WHERE cr.status = 'read')::int AS read,
      COUNT(*) FILTER (WHERE cr.status = 'failed')::int AS failed
      FROM campaign_recipients cr JOIN campaigns c ON c.id = cr.campaign_id WHERE c.business_id = $1`, [businessId]),
    query("SELECT * FROM campaigns WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1", [businessId])
  ]);
  let latestCampaign = null;
  if (latest.rows[0]) {
    const recipientStats = await query(
      `SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
         COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
         COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered,
         COUNT(*) FILTER (WHERE status = 'read')::int AS read,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM campaign_recipients WHERE campaign_id = $1`,
      [latest.rows[0].id]
    );
    const stats = { ...recipientStats.rows[0], replied: 0 };
    latestCampaign = { ...mapCampaign(latest.rows[0]), stats: Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, Number(value || 0)])), recipients: [] };
  }
  return {
    marketableContacts: Number(contacts.rows[0]?.marketable || 0),
    campaignCount: Number(campaigns.rows[0]?.total || 0),
    openConversations: Number(conversations.rows[0]?.open || 0),
    approvedTemplates: Number(templates.rows[0]?.approved || 0),
    activeFlows: Number(flows.rows[0]?.active || 0),
    delivered: Number(delivery.rows[0]?.delivered || 0),
    read: Number(delivery.rows[0]?.read || 0),
    failed: Number(delivery.rows[0]?.failed || 0),
    latestCampaign
  };
}

async function loadInbox(businessId, options, account = null) {
  return loadWorkspaceInbox(businessId, options, account);
}

export async function loadState(account, options = {}) {
  const businessId = account.business.id;
  const view = WORKSPACE_VIEWS.has(options.view) ? options.view : "overview";
  const paging = {
    page: options.page || 1,
    pageSize: options.pageSize || DEFAULT_PAGE_SIZE,
    messagePage: options.messagePage || 1,
    notePage: options.notePage || 1,
    conversationId: options.conversationId || "",
    q: options.q || "",
    sourceKind: options.sourceKind || "",
    sourceId: options.sourceId || "",
    contactMode: options.contactMode || "all",
    inboxFilter: options.inboxFilter || ""
  };
  const [business, subscription, platformConfig, featureFlags, metaHealthResult] = await Promise.all([
    query("SELECT * FROM businesses WHERE id = $1", [businessId]),
    subscriptionUsage(businessId),
    getPublicPlatformConfig(),
    workspaceFeatureFlags(businessId),
    query("SELECT health_status,health_reason,health_checked_at,last_webhook_at,last_message_webhook_at,last_webhook_field,created_at,updated_at FROM whatsapp_accounts WHERE business_id=$1 ORDER BY is_default DESC,created_at LIMIT 1", [businessId])
  ]);
  const setup = business.rows[0];
  const result = {
    scope: view,
    account,
    setup: mapSetup(setup, metaHealthResult.rows[0]),
    subscription,
    featureFlags,
    platform: platformConfig,
    meta: {
      storage: "PostgreSQL",
      liveMetaReady: Boolean(setup?.access_token_encrypted && setup?.waba_id && setup?.phone_number_id),
      webhookUrl: setup?.webhook_url || "",
      embeddedSignupAvailable: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_EMBEDDED_SIGNUP_CONFIG_ID)
    }
  };

  if (view === "overview") result.overview = await loadOverview(businessId);
  if (view === "setup") result.whatsappOperations = await getWhatsAppOperationsState(businessId);
  if (view === "contacts" || view === "unsubscribes") {
    const contactMode = view === "unsubscribes" ? "suppressed" : paging.contactMode === "marketable" ? "marketable" : paging.contactMode === "suppressed" ? "suppressed" : "all";
    const page = await pagedContacts(businessId, { ...paging, q: paging.q }, contactMode);
    result.contacts = page.contacts;
    result.pagination = { [view]: page.pagination };
    if (view === "contacts") result.audienceSegments = await listAudienceSegments(businessId);
  }
  if (view === "templates") {
    result.whatsappOperations = await getWhatsAppOperationsState(businessId);
    const totalResult = await query("SELECT COUNT(*)::int AS total FROM templates WHERE business_id = $1", [businessId]);
    const pagination = pageMeta(totalResult.rows[0]?.total, paging.page, paging.pageSize);
    const rows = await query("SELECT * FROM templates WHERE business_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3", [businessId, pagination.pageSize, (pagination.page - 1) * pagination.pageSize]);
    result.templates = rows.rows.map(mapTemplate);
    result.pagination = { templates: pagination };
  }
  if (view === "automation") {
    const [count, templates] = await Promise.all([
      query("SELECT COUNT(*)::int AS total FROM automation_flows WHERE business_id=$1 AND status<>'archived'",[businessId]),
      query("SELECT * FROM templates WHERE business_id = $1 AND status = 'Approved' ORDER BY created_at DESC,id DESC LIMIT 25", [businessId])
    ]);
    const pagination=pageMeta(count.rows[0]?.total,paging.page,paging.pageSize);
    result.automationFlows = await listAutomationFlows(businessId,pagination);
    result.pagination = { automation: pagination };
    result.templates = templates.rows.map(mapTemplate);
  }
  if (view === "campaigns") {
    result.whatsappOperations = await getWhatsAppOperationsState(businessId);
    const [contacts, segments, templates, flows, marketingAccount] = await Promise.all([
      pagedContacts(businessId, paging, "marketable"),
      listAudienceSegments(businessId),
      query("SELECT * FROM templates WHERE business_id = $1 AND status = 'Approved' ORDER BY created_at DESC,id DESC LIMIT 25", [businessId]),
      query("SELECT id,name,status FROM automation_flows WHERE business_id=$1 AND status='active' ORDER BY name,id LIMIT 25",[businessId]),
      query('SELECT capabilities FROM whatsapp_accounts WHERE business_id = $1 AND waba_id = $2', [businessId, setup?.waba_id || ''])
    ]);
    result.marketingMessagesStatus = marketingAccount.rows[0]?.capabilities?.marketing_messages_api?.status || 'UNKNOWN';
    result.contacts = contacts.contacts;
    result.pagination = { campaigns: contacts.pagination };
    result.audienceSegments = segments;
    result.templates = templates.rows.map(mapTemplate);
    result.automationFlows = flows.rows;
    result.operationsPolicy = { campaignMaxScheduleDays: operationalPolicy().campaignMaxScheduleDays };
  }
  if (view === "results") {
    const agentSummary = account.role === 'Agent';
    const page = await loadCampaignResults(businessId, {
      ...paging,
      recipientPreviewLimit: agentSummary ? 0 : paging.pageSize
    });
    result.campaigns = page.campaigns;
    result.contacts = [...new Map(page.campaigns.flatMap((campaign) => campaign.recipients).map((recipient) => [
      recipient.contactId,
      { id: recipient.contactId, name: recipient.contactName, phone: recipient.contactPhone }
    ])).values()];
    result.pagination = { results: page.pagination };
  }
  if (view === "inbox") {
    const inboxPaging = {
      ...paging,
      inboxFilter: paging.inboxFilter || (account.role === 'Agent' ? 'mine' : 'all'),
      q: paging.q
    };
    const [inbox, templates, teamMembers] = await Promise.all([
      loadInbox(businessId, inboxPaging, account),
      query("SELECT * FROM templates WHERE business_id = $1 AND status = 'Approved' ORDER BY created_at DESC,id DESC LIMIT 25", [businessId]),
      query(`SELECT u.id, u.name, u.email, m.role, m.availability FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.business_id = $1 ORDER BY m.created_at ASC`, [businessId])
    ]);
    Object.assign(result, inbox);
    result.templates = templates.rows.map(mapTemplate);
    result.teamMembers = teamMembers.rows.map((row) => ({ id: row.id, name: row.name, email: row.email, role: row.role, availability: row.availability || "offline" }));
  }
  if (view === "team") {
    const members = await query(`SELECT u.id, u.name, u.email, m.role, m.availability FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.business_id = $1 ORDER BY m.created_at ASC`, [businessId]);
    result.teamMembers = members.rows.map((row) => ({ id: row.id, name: row.name, email: row.email, role: row.role, availability: row.availability || "offline" }));
  }
  return result;
}

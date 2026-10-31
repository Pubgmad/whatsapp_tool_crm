import { requireSession } from './auth.js';
import { AppError, errorJson, id, json, query } from './db.js';
import { assertWorkspaceFeature, workspaceFeatureFlags } from './feature-controls.js';
import { readJsonBodyLimited } from './security.js';
import { getConciergeTopics, getOnboardingGoals } from './smb-platform-config.js';
import { requireSuperAdmin } from './super-admin.js';
import { requireWorkspaceManager } from './workspace-permissions.js';

async function onboardingSteps() {
  const row = (await query("SELECT value FROM platform_settings WHERE key='smb_onboarding_steps'")).rows[0];
  return Array.isArray(row?.value) ? row.value : [];
}

async function conciergeEnabled() {
  const row = (await query("SELECT value FROM platform_settings WHERE key='smb_concierge_enabled'")).rows[0];
  return row?.value !== false;
}

export async function getAssistedOnboarding(request) {
  try {
    const session = await requireSession(request);
    await assertWorkspaceFeature('assisted_onboarding', session.businessId);
    const business = (await query(
      'SELECT onboarding_state, experience_mode FROM businesses WHERE id=$1',
      [session.businessId]
    )).rows[0];
    const setup = (await query(
      `SELECT a.status AS account_status, a.webhook_subscribed, p.display_phone_number, p.phone_number_id
       FROM whatsapp_accounts a
       LEFT JOIN whatsapp_phone_numbers p ON p.whatsapp_account_id=a.id AND p.business_id=a.business_id
       WHERE a.business_id=$1
       ORDER BY a.is_default DESC, p.is_default DESC NULLS LAST
       LIMIT 1`,
      [session.businessId]
    )).rows[0];
    const flags = await workspaceFeatureFlags(session.businessId);
    const state = business?.onboarding_state && typeof business.onboarding_state === 'object' ? business.onboarding_state : {};
    const whatsappConnected = Boolean(setup?.phone_number_id && setup?.account_status === 'connected');
    const [botCount, sheetsCount, contactCount, campaignCount, storeCount] = await Promise.all([
      query("SELECT COUNT(*)::int AS n FROM reply_bots WHERE business_id=$1 AND status='published'", [session.businessId]),
      query("SELECT COUNT(*)::int AS n FROM sheets_bots WHERE business_id=$1 AND status='published'", [session.businessId]),
      query('SELECT COUNT(*)::int AS n FROM contacts WHERE business_id=$1', [session.businessId]),
      query("SELECT COUNT(*)::int AS n FROM campaigns WHERE business_id=$1 AND status IN ('draft','queued','sending','completed','scheduled')", [session.businessId]),
      query("SELECT COUNT(*)::int AS n FROM provider_connectors WHERE business_id=$1 AND enabled", [session.businessId])
    ]);
    const botReady = Boolean(state.botReady) || (botCount.rows[0]?.n || 0) > 0 || (sheetsCount.rows[0]?.n || 0) > 0;
    const contactsReady = Boolean(state.contactsReady) || (contactCount.rows[0]?.n || 0) > 0;
    const campaignReady = Boolean(state.campaignReady) || (campaignCount.rows[0]?.n || 0) > 0;
    const storeReady = Boolean(state.storeReady) || (storeCount.rows[0]?.n || 0) > 0;
    const checklist = [
      { id: 'connect', label: 'Connect WhatsApp', done: whatsappConnected, href: '/app/settings/whatsapp' },
      { id: 'verify', label: 'Webhook subscribed', done: Boolean(setup?.webhook_subscribed), href: '/app/settings/whatsapp' },
      { id: 'bot', label: 'Create a reply or Sheets bot', done: botReady, href: '/app/bots' },
      { id: 'contacts', label: 'Add or import contacts', done: contactsReady, href: '/app/contacts' },
      { id: 'campaign', label: 'Draft a campaign', done: campaignReady, href: '/app/campaigns' },
      { id: 'store', label: 'Connect a store (optional)', done: storeReady, href: '/app/settings/integrations' }
    ];
    const simpleNavRow = (await query("SELECT value FROM platform_settings WHERE key='smb_simple_nav'")).rows[0];
    const simpleNav = Array.isArray(simpleNavRow?.value) ? simpleNavRow.value : null;
    const [goals, conciergeTopics] = await Promise.all([getOnboardingGoals(), getConciergeTopics()]);
    return json({
      steps: await onboardingSteps(),
      goals,
      conciergeTopics,
      state,
      experienceMode: business?.experience_mode || 'advanced',
      whatsappConnected,
      phoneDisplay: setup?.display_phone_number || '',
      checklist,
      simpleNav,
      featureFlags: {
        sheets_bot: flags.sheets_bot,
        reply_bots: flags.reply_bots,
        ecommerce_playbooks: flags.ecommerce_playbooks,
        connectors: flags.connectors,
        checkout_recovery: flags.checkout_recovery
      },
      conciergeEnabled: await conciergeEnabled()
    });
  } catch (error) {
    return errorJson(error);
  }
}

export async function updateAssistedOnboarding(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    await assertWorkspaceFeature('assisted_onboarding', session.businessId);
    const body = await readJsonBodyLimited(request, 16384);
    const action = String(body.action || '');

    if (action === 'saveProgress') {
      const patch = body.state && typeof body.state === 'object' ? body.state : {};
      const current = (await query('SELECT onboarding_state FROM businesses WHERE id=$1', [session.businessId])).rows[0]?.onboarding_state || {};
      const next = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
        currentStep: String(body.currentStep || patch.currentStep || current.currentStep || 'business').slice(0, 64)
      };
      await query('UPDATE businesses SET onboarding_state=$2::jsonb, updated_at=NOW() WHERE id=$1', [session.businessId, JSON.stringify(next)]);
      return json({ ok: true, state: next });
    }

    if (action === 'setExperienceMode') {
      await assertWorkspaceFeature('simple_mode', session.businessId);
      if (!['simple', 'advanced'].includes(body.mode)) throw new AppError('Choose simple or advanced.', 400, 'VALIDATION_ERROR');
      await query('UPDATE businesses SET experience_mode=$2, updated_at=NOW() WHERE id=$1', [session.businessId, body.mode]);
      return json({ ok: true, experienceMode: body.mode });
    }

    if (action === 'requestHelp') {
      if (!(await conciergeEnabled())) throw new AppError('Assisted support is not available right now.', 409, 'CONCIERGE_DISABLED');
      const topics = await getConciergeTopics();
      const requestType = String(body.requestType || '').trim().slice(0, 80);
      const description = String(body.description || '').trim().slice(0, 4000);
      if (!topics.some((topic) => topic.id === requestType)) {
        throw new AppError('Choose a valid assistance topic.', 400, 'VALIDATION_ERROR');
      }
      if (!requestType || description.length < 10) throw new AppError('Describe what you need help with (at least 10 characters).', 400, 'VALIDATION_ERROR');
      const current = (await query('SELECT onboarding_state FROM businesses WHERE id=$1', [session.businessId])).rows[0]?.onboarding_state || {};
      const caseId = id('cr');
      await query(
        `INSERT INTO concierge_requests (id, business_id, user_id, request_type, stage, description, diagnostics, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'open')`,
        [
          caseId,
          session.businessId,
          session.userId,
          requestType,
          String(current.currentStep || ''),
          description,
          JSON.stringify({
            experienceMode: body.experienceMode || '',
            whatsappConnected: Boolean(body.whatsappConnected),
            at: new Date().toISOString()
          })
        ]
      );
      return json({ ok: true, requestId: caseId });
    }

    throw new AppError('Unsupported action.', 400, 'INVALID_ACTION');
  } catch (error) {
    return errorJson(error);
  }
}

export async function superAdminConcierge(request) {
  try {
    await requireSuperAdmin(request);
    if (request.method === 'GET') {
      const status = new URL(request.url).searchParams.get('status') || 'open';
      const rows = (await query(
        `SELECT r.*, b.name AS company_name
         FROM concierge_requests r
         JOIN businesses b ON b.id=r.business_id
         WHERE ($1='all' OR r.status=$1)
         ORDER BY r.created_at DESC LIMIT 100`,
        [status]
      )).rows;
      return json({ requests: rows });
    }
    const body = await readJsonBodyLimited(request, 16384);
    if (!['in_progress', 'resolved', 'closed', 'open'].includes(body.status)) throw new AppError('Invalid status.', 400, 'VALIDATION_ERROR');
    const result = await query(
      `UPDATE concierge_requests SET status=$2, assignee_note=$3, resolution_note=$4, updated_at=NOW()
       WHERE id=$1 RETURNING id`,
      [body.id, body.status, String(body.assigneeNote || '').slice(0, 2000), String(body.resolutionNote || '').slice(0, 4000)]
    );
    if (!result.rowCount) throw new AppError('Request not found.', 404, 'NOT_FOUND');
    return json({ ok: true });
  } catch (error) {
    return errorJson(error);
  }
}

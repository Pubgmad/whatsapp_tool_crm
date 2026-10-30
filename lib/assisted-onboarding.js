import { requireSession } from './auth.js';
import { AppError, errorJson, id, json, query } from './db.js';
import { assertWorkspaceFeature, workspaceFeatureFlags } from './feature-controls.js';
import { readJsonBodyLimited } from './security.js';
import { requireSuperAdmin } from './super-admin.js';
import { requireWorkspaceManager } from './workspace-permissions.js';

const DEFAULT_GOALS = [
  { id: 'answer_questions', label: 'Answer customer questions automatically', next: 'bots' },
  { id: 'leads', label: 'Capture leads', next: 'campaigns' },
  { id: 'campaigns', label: 'Send promotional campaigns', next: 'campaigns' },
  { id: 'support', label: 'Manage WhatsApp customer support', next: 'inbox' },
  { id: 'checkout_recovery', label: 'Recover abandoned checkouts', next: 'commerce' },
  { id: 'appointments', label: 'Send appointment reminders', next: 'automation' }
];

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
    const checklist = [
      { id: 'connect', label: 'Connect WhatsApp', done: whatsappConnected, href: '/app/settings/whatsapp' },
      { id: 'verify', label: 'Webhook subscribed', done: Boolean(setup?.webhook_subscribed), href: '/app/settings/whatsapp' },
      { id: 'bot', label: 'Create a reply or Sheets bot', done: Boolean(state.botReady), href: '/app/bots' },
      { id: 'contacts', label: 'Add or import contacts', done: Boolean(state.contactsReady), href: '/app/contacts' },
      { id: 'campaign', label: 'Draft a campaign', done: Boolean(state.campaignReady), href: '/app/campaigns' },
      { id: 'store', label: 'Connect a store (optional)', done: Boolean(state.storeReady), href: '/app/settings/integrations' }
    ];
    return json({
      steps: await onboardingSteps(),
      goals: DEFAULT_GOALS,
      state,
      experienceMode: business?.experience_mode || 'advanced',
      whatsappConnected,
      phoneDisplay: setup?.display_phone_number || '',
      checklist,
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
      const requestType = String(body.requestType || '').trim().slice(0, 80);
      const description = String(body.description || '').trim().slice(0, 4000);
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

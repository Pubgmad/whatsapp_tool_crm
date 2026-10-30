import { requireSession } from './auth.js';
import { AppError, errorJson, id, json, query } from './db.js';
import { assertWorkspaceFeature } from './feature-controls.js';
import { COMMERCE_AUTOMATION_PRESETS, commerceAutomationPreset } from './commerce-automation-presets.js';
import { readJsonBodyLimited } from './security.js';
import { requireWorkspaceManager } from './workspace-permissions.js';
import { getEcommercePlaybookDefs } from './smb-platform-config.js';

/** Fallback catalogue when Super Admin setting is empty — still merged with commerce presets. */
export const ECOMMERCE_PLAYBOOKS = Object.freeze([
  {
    id: 'abandoned_checkout_recovery',
    label: 'Abandoned checkout recovery',
    provider: 'shopify',
    description: 'Remind eligible shoppers who left checkout. Uses connectors + checkout recovery.',
    requires: ['connectors', 'checkout_recovery', 'automation'],
    kind: 'checkout_recovery',
    defaultDelayMinutes: 60
  },
  {
    id: 'woo_abandoned_checkout_recovery',
    label: 'WooCommerce checkout recovery',
    provider: 'woocommerce',
    description: 'Recover eligible abandoned WooCommerce checkouts via signed webhooks.',
    requires: ['connectors', 'checkout_recovery', 'automation'],
    kind: 'checkout_recovery',
    defaultDelayMinutes: 60
  },
  ...COMMERCE_AUTOMATION_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label,
    provider: 'shopify',
    description: preset.description,
    requires: ['commerce', 'automation'],
    kind: 'commerce_preset',
    presetId: preset.id,
    defaultDelayMinutes: preset.delayMinutes
  }))
]);

async function resolvePlaybooks() {
  const configured = await getEcommercePlaybookDefs();
  if (!configured.length) return ECOMMERCE_PLAYBOOKS;
  // Merge Super Admin defs with known commerce presets so presetId validation still works.
  const byId = new Map(ECOMMERCE_PLAYBOOKS.map((item) => [item.id, item]));
  for (const item of configured) {
    byId.set(item.id, { ...byId.get(item.id), ...item });
  }
  return [...byId.values()].filter((item) => item.enabled !== false);
}

export async function listEcommercePlaybooks(request) {
  try {
    const session = await requireSession(request);
    await assertWorkspaceFeature('ecommerce_playbooks', session.businessId);
    const playbooks = await resolvePlaybooks();
    const activations = (await query(
      'SELECT * FROM ecommerce_playbook_activations WHERE business_id=$1 ORDER BY updated_at DESC LIMIT 100',
      [session.businessId]
    )).rows;
    const connectors = (await query(
      "SELECT id, provider, enabled, name FROM provider_connectors WHERE business_id=$1 ORDER BY created_at DESC LIMIT 50",
      [session.businessId]
    )).rows;
    const flows = (await query(
      "SELECT id, name FROM automation_flows WHERE business_id=$1 AND status='active' AND trigger_mode='manual' ORDER BY name LIMIT 100",
      [session.businessId]
    )).rows;
    const templates = (await query(
      "SELECT id, name, language, category FROM templates WHERE business_id=$1 AND status='Approved' ORDER BY updated_at DESC LIMIT 100",
      [session.businessId]
    )).rows;
    return json({ playbooks, activations, connectors, flows, templates });
  } catch (error) {
    return errorJson(error);
  }
}

export async function manageEcommercePlaybook(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    await assertWorkspaceFeature('ecommerce_playbooks', session.businessId);
    const body = await readJsonBodyLimited(request, 16384);
    const action = String(body.action || '');
    const playbooks = await resolvePlaybooks();
    const playbook = playbooks.find((item) => item.id === body.playbookId);
    if (!playbook && action !== 'setStatus') throw new AppError('Unknown playbook.', 404, 'NOT_FOUND');

    if (action === 'activate') {
      if (session.role !== 'Owner') throw new AppError('Only the owner can activate ecommerce playbooks.', 403, 'FORBIDDEN');
      const delay = Number(body.delayMinutes);
      if (!Number.isSafeInteger(delay) || delay < 0 || delay > 43200) throw new AppError('Enter a valid delay in minutes.', 400, 'VALIDATION_ERROR');
      const activationId = body.activationId || id('epa');
      if (playbook.kind === 'commerce_preset') {
        const flowId = String(body.flowId || '').trim();
        if (!flowId) throw new AppError('Select a utility workflow for this playbook.', 400, 'VALIDATION_ERROR');
        const preset = commerceAutomationPreset(playbook.presetId);
        if (!preset) throw new AppError('Preset unavailable.', 400, 'VALIDATION_ERROR');
        // Reuse commerce automation rule creation semantics without changing that module's validation path.
        await query(
          `INSERT INTO commerce_automation_rules (id, business_id, name, flow_id, event_type, fulfillment_status, unpaid_only, delay_minutes, enabled)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)`,
          [id('car'), session.businessId, playbook.label.slice(0, 120), flowId, preset.eventType, preset.fulfillmentStatus, preset.unpaidOnly, delay]
        );
      }
      if (playbook.kind === 'checkout_recovery') {
        const connectorId = String(body.connectorId || '').trim();
        if (!connectorId) throw new AppError('Select a connected store.', 400, 'VALIDATION_ERROR');
        const connector = (await query(
          'SELECT id, provider FROM provider_connectors WHERE id=$1 AND business_id=$2',
          [connectorId, session.businessId]
        )).rows[0];
        if (!connector) throw new AppError('Store connector not found.', 404, 'NOT_FOUND');
        if (connector.provider !== playbook.provider) {
          throw new AppError(`Select a ${playbook.provider} store for this playbook.`, 400, 'PROVIDER_MISMATCH');
        }
        await query(
          `UPDATE provider_connectors SET recovery_enabled=TRUE, recovery_after_minutes=$3, recovery_flow_id=NULLIF($4,''), updated_at=NOW()
           WHERE id=$1 AND business_id=$2`,
          [connectorId, session.businessId, delay, String(body.flowId || '')]
        );
      }
      await query(
        `INSERT INTO ecommerce_playbook_activations (id, business_id, playbook_id, provider, connector_id, template_id, flow_id, delay_minutes, config, status, activated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'active',NOW())
         ON CONFLICT (id) DO UPDATE SET status='active', delay_minutes=$8, flow_id=$7, template_id=$6, connector_id=$5, config=$9::jsonb, activated_at=NOW(), updated_at=NOW()`,
        [
          activationId,
          session.businessId,
          playbook.id,
          playbook.provider,
          String(body.connectorId || ''),
          String(body.templateId || ''),
          String(body.flowId || ''),
          delay,
          JSON.stringify({ consentAcknowledged: Boolean(body.consentAcknowledged), activatedBy: session.userId })
        ]
      );
      // Mark onboarding store ready when applicable
      await query(
        `UPDATE businesses SET onboarding_state = COALESCE(onboarding_state,'{}'::jsonb) || '{"storeReady":true}'::jsonb WHERE id=$1`,
        [session.businessId]
      );
      return json({ ok: true, activationId });
    }

    if (action === 'setStatus') {
      if (!['active', 'paused', 'draft'].includes(body.status)) throw new AppError('Invalid status.', 400, 'VALIDATION_ERROR');
      const result = await query(
        `UPDATE ecommerce_playbook_activations SET status=$3, updated_at=NOW() WHERE id=$1 AND business_id=$2
         RETURNING id, playbook_id, connector_id, status`,
        [body.activationId, session.businessId, body.status]
      );
      if (!result.rowCount) throw new AppError('Activation not found.', 404, 'NOT_FOUND');
      const row = result.rows[0];
      // Recovery workers read provider_connectors.recovery_enabled — keep it aligned with playbook status.
      if (row.connector_id) {
        if (body.status === 'active') {
          await query(
            `UPDATE provider_connectors SET recovery_enabled=TRUE, updated_at=NOW()
             WHERE id=$1 AND business_id=$2`,
            [row.connector_id, session.businessId]
          );
        } else {
          await query(
            `UPDATE provider_connectors SET recovery_enabled=FALSE, updated_at=NOW()
             WHERE id=$1 AND business_id=$2`,
            [row.connector_id, session.businessId]
          );
        }
      }
      return json({ ok: true });
    }

    throw new AppError('Unsupported action.', 400, 'INVALID_ACTION');
  } catch (error) {
    return errorJson(error);
  }
}

import { AppError, id, query } from './db.js';
import { decryptSecret } from './meta.js';

const TEMPLATE_FIELDS = new Set(['message_template_quality_update', 'message_template_components_update']);

export function configurationEvent(field, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (TEMPLATE_FIELDS.has(field)) {
    const templateId = String(value.message_template_id || value.template_id || '');
    if (!/^\d+$/.test(templateId)) return null;
    return { kind: 'template', field, templateId, data: value };
  }
  if (field === 'account_update') return { kind: 'account', field, data: value };
  return null;
}

export async function applyMetaConfigurationEvent(businessId, wabaId, field, value, dependencies = {}) {
  const event = configurationEvent(field, value);
  if (!event) return;
  const execute = dependencies.query || query;
  const request = dependencies.fetch || fetch;
  const decrypt = dependencies.decrypt || decryptSecret;
  const account = (await execute(
    'SELECT id, access_token_encrypted FROM whatsapp_accounts WHERE business_id=$1 AND waba_id=$2',
    [businessId, String(wabaId)]
  )).rows[0];
  if (!account) return;
  if (event.kind === 'template') {
    await execute(
      `UPDATE templates SET component_schema=jsonb_set(COALESCE(component_schema,'{}'::jsonb), ARRAY[$1::text], $2::jsonb, true),
        content_revision = content_revision + 1, updated_at=NOW()
       WHERE business_id=$3 AND waba_id=$4 AND meta_template_id=$5`,
      [field, JSON.stringify(event.data), businessId, String(wabaId), event.templateId]
    );
  } else {
    // Fetch authoritative eligibility rather than inferring it from terms or account events.
    if (account.access_token_encrypted) {
      const url = new URL(`https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || 'v26.0'}/${encodeURIComponent(wabaId)}`);
      url.searchParams.set('fields', 'marketing_messages_onboarding_status');
      let payload;
      try {
        const response = await request(url, {
          headers: { Authorization: `Bearer ${decrypt(account.access_token_encrypted)}` },
          redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000)
        });
        payload = await response.json();
        if (!response.ok || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Meta refresh failed');
      } catch {
        await execute(
          `UPDATE whatsapp_accounts SET capabilities=jsonb_set(COALESCE(capabilities,'{}'::jsonb), '{marketing_messages_api}', '{"status":"UNKNOWN"}'::jsonb, true), updated_at=NOW() WHERE id=$1 AND business_id=$2`,
          [account.id, businessId]
        );
        throw new AppError('Unable to refresh Meta account configuration.', 503, 'META_CONFIGURATION_REFRESH_FAILED');
      }
      const status = String(payload.marketing_messages_onboarding_status || 'UNKNOWN');
      await execute(
        `UPDATE whatsapp_accounts SET capabilities=jsonb_set(COALESCE(capabilities,'{}'::jsonb), '{marketing_messages_api}', $1::jsonb, true), updated_at=NOW()
         WHERE id=$2 AND business_id=$3`,
        [JSON.stringify({ status }), account.id, businessId]
      );
    }
    await execute(
      `UPDATE whatsapp_accounts SET metadata=jsonb_set(COALESCE(metadata,'{}'::jsonb), '{account_update}', $1::jsonb, true), updated_at=NOW() WHERE id=$2 AND business_id=$3`,
      [JSON.stringify(event.data), account.id, businessId]
    );
  }
  await execute(
    `INSERT INTO events (id,business_id,type,metadata) VALUES ($1,$2,'meta_configuration_update',$3)`,
    [id('e'), businessId, JSON.stringify({ field, wabaId: String(wabaId), templateId: event.templateId || '', event: String(value.event || ''), quality: String(value.new_quality_score || '') })]
  );
}

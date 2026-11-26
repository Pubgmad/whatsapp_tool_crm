import { AppError, enterTenantContext, id, withTenant } from './db.js';
import { listWhatsAppTemplates } from './meta.js';

const clean = (value) => String(value || '').trim();

function templateVariables(body) {
  return [...new Set([...String(body || '').matchAll(/{{\s*([\w.-]+)\s*}}/g)].map((match) => match[1]))];
}

function normalizeTemplateStatus(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'approved') return 'Approved';
  if (value === 'rejected') return 'Rejected';
  if (value === 'draft') return 'Draft';
  return 'Pending';
}

function templateComponentsFromMeta(components = []) {
  const get = (type) => components.find((component) => String(component.type || '').toUpperCase() === type) || {};
  const header = get('HEADER');
  const body = get('BODY');
  const footer = get('FOOTER');
  const buttons = get('BUTTONS');
  const mappedButtons = (buttons.buttons || []).map((button) => ({
    type: clean(button.type || 'QUICK_REPLY').toUpperCase(),
    text: clean(button.text),
    value: clean(button.url || button.phone_number || '')
  }));
  return {
    headerText: String(header.format || '').toUpperCase() === 'TEXT' ? clean(header.text) : '',
    body: clean(body.text),
    footerText: clean(footer.text),
    buttons: mappedButtons,
    componentSchema: {
      // Do not persist the full Meta components blob — it is large and has broken syncs.
      headerFormat: clean(header.format || 'NONE').toUpperCase(),
      headerMediaHandle: clean(header.example?.header_handle?.[0]),
      buttons: mappedButtons,
      addSecurityRecommendation: body.add_security_recommendation,
      codeExpirationMinutes: footer.code_expiration_minutes,
      otpType: clean((buttons.buttons || []).find((button) => String(button.type).toUpperCase() === 'OTP')?.otp_type),
      otpButtonText: clean((buttons.buttons || []).find((button) => String(button.type).toUpperCase() === 'OTP')?.text)
    }
  };
}

function isUniqueViolation(error) {
  return error?.code === '23505' || /duplicate key|unique constraint/i.test(String(error?.message || ''));
}

export async function accountForTemplateSync(businessId, accountId = '') {
  const load = async () =>
    (
      await withTenant(businessId, (client) =>
        client.query(
          `SELECT a.id,a.waba_id,a.access_token_encrypted,a.token_expires_at,p.phone_number_id
    FROM whatsapp_accounts a
    LEFT JOIN LATERAL (SELECT phone_number_id FROM whatsapp_phone_numbers WHERE business_id=a.business_id AND whatsapp_account_id=a.id ORDER BY is_default DESC,created_at LIMIT 1) p ON TRUE
    WHERE a.business_id=$1 AND a.status='connected' AND ($2='' OR a.id=$2)
      AND COALESCE(a.access_token_encrypted,'')<>''
    ORDER BY a.is_default DESC,a.created_at LIMIT 1`,
          [businessId, accountId]
        )
      )
    ).rows[0];
  let account = await load();
  if (!account?.access_token_encrypted) {
    const { healAccountTokenFromBusiness } = await import('./meta-health.js');
    await healAccountTokenFromBusiness(businessId);
    enterTenantContext(businessId);
    account = await load();
  }
  return account || null;
}

async function upsertSyncedTemplate(client, {
  businessId,
  wabaId,
  apiName,
  category,
  language,
  components,
  status,
  metaTemplateId
}) {
  const variables = JSON.stringify(templateVariables(components.body));
  const buttons = JSON.stringify(components.buttons);
  const schema = JSON.stringify(components.componentSchema);
  const paramsUpdate = [
    businessId,
    wabaId,
    apiName,
    language,
    category,
    components.headerText,
    components.body,
    components.footerText,
    buttons,
    schema,
    variables,
    status,
    metaTemplateId
  ];

  // Match Meta API name, stored meta_template_name, or prettified local name.
  const updated = await client.query(
    `UPDATE templates
        SET category=$5,
            header_text=$6,
            body=$7,
            footer_text=$8,
            buttons=$9::jsonb,
            component_schema=$10::jsonb,
            variables=$11::jsonb,
            status=$12,
            meta_template_id=$13,
            meta_template_name=$3,
            waba_id=$2,
            source='Meta sync',
            content_revision=COALESCE(content_revision,1)+1,
            updated_at=NOW()
      WHERE business_id=$1
        AND language=$4
        AND (
          (waba_id=$2 OR waba_id='' OR waba_id IS NULL)
          AND (
            meta_template_name=$3
            OR name=$3
            OR lower(regexp_replace(name, '[^a-zA-Z0-9]+', '_', 'g')) = $3
          )
        )
      RETURNING id`,
    paramsUpdate
  );
  if (updated.rowCount) return { action: 'updated', ids: updated.rows.map((row) => row.id) };

  try {
    await client.query(
      `INSERT INTO templates (
         id, business_id, waba_id, name, category, language, header_text, body, footer_text,
         buttons, component_schema, variables, status, meta_template_id, meta_template_name, source
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,'Meta sync')`,
      [
        id('t'),
        businessId,
        wabaId,
        apiName,
        category,
        language,
        components.headerText,
        components.body,
        components.footerText,
        buttons,
        schema,
        variables,
        status,
        metaTemplateId,
        apiName
      ]
    );
    return { action: 'inserted' };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Race / identity index: force update by meta identity.
    const forced = await client.query(
      `UPDATE templates
          SET category=$5, header_text=$6, body=$7, footer_text=$8, buttons=$9::jsonb,
              component_schema=$10::jsonb, variables=$11::jsonb, status=$12, meta_template_id=$13,
              meta_template_name=$3, waba_id=$2, source='Meta sync',
              content_revision=COALESCE(content_revision,1)+1, updated_at=NOW()
        WHERE business_id=$1 AND language=$4
          AND (meta_template_name=$3 OR name=$3 OR lower(regexp_replace(name, '[^a-zA-Z0-9]+', '_', 'g')) = $3)
        RETURNING id`,
      paramsUpdate
    );
    if (!forced.rowCount) throw error;
    return { action: 'updated_after_conflict', ids: forced.rows.map((row) => row.id) };
  }
}

export async function syncTemplatesForBusiness(businessId, accountId = '') {
  enterTenantContext(businessId);
  const account = await accountForTemplateSync(businessId, accountId);
  if (!account?.waba_id || !account.access_token_encrypted) {
    return { synced: 0, skipped: true, reason: 'not_connected' };
  }
  if (account.token_expires_at && new Date(account.token_expires_at) <= new Date()) {
    return { synced: 0, skipped: true, reason: 'token_expired' };
  }

  let templates;
  try {
    templates = await listWhatsAppTemplates({ setup: account });
  } catch (error) {
    const message = String(error?.message || 'Meta template sync failed.');
    throw new AppError(message, Number(error?.status) || 502, error?.code || 'META_TEMPLATE_SYNC_FAILED', {
      metaCode: error?.metaCode,
      metaSubcode: error?.metaSubcode
    });
  }

  enterTenantContext(businessId);
  let synced = 0;
  const failures = [];

  // One transaction per template so a single bad Meta row cannot fail the whole sync.
  for (const item of templates) {
    const apiName = clean(item.name);
    if (!apiName) continue;
    const components = templateComponentsFromMeta(item.components);
    const status = normalizeTemplateStatus(item.status);
    const language = clean(item.language) || 'en_US';
    const category = clean(item.category) || 'MARKETING';
    try {
      await withTenant(businessId, async (client) => {
        await upsertSyncedTemplate(client, {
          businessId,
          wabaId: account.waba_id,
          apiName,
          category,
          language,
          components,
          status,
          metaTemplateId: clean(item.id)
        });
      });
      synced += 1;
    } catch (error) {
      console.error('Template sync row failed', {
        apiName,
        language,
        code: error?.code || null,
        message: String(error?.message || '').slice(0, 300)
      });
      failures.push({
        name: apiName,
        language,
        code: error?.code || 'TEMPLATE_SYNC_ROW_FAILED',
        message: String(error?.message || 'Sync failed').slice(0, 160)
      });
    }
  }

  if (!synced && failures.length) {
    throw new AppError(
      `Could not sync templates from Meta (${failures[0].name}: ${failures[0].message}).`,
      502,
      'META_TEMPLATE_SYNC_FAILED'
    );
  }

  return { synced, wabaId: account.waba_id, failed: failures.length, failures: failures.slice(0, 5) };
}

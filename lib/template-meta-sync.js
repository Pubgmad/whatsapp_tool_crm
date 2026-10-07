import { id, query } from './db.js';
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
      kind: get('LIMITED_TIME_OFFER').limited_time_offer ? 'LIMITED_TIME_OFFER' : (buttons.buttons || []).some((button) => String(button.type).toUpperCase() === 'COPY_CODE') ? 'COUPON' : get('CAROUSEL').cards ? (get('CAROUSEL').cards[0]?.components?.some((component) => component.type === 'HEADER' && component.format === 'PRODUCT') ? 'PRODUCT_CAROUSEL' : 'CAROUSEL') : (buttons.buttons || []).some((button) => String(button.type).toUpperCase() === 'CATALOG') ? 'CATALOG' : 'STANDARD',
      components,
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

export async function accountForTemplateSync(businessId, accountId = '') {
  const account = (await query(`SELECT a.id,a.waba_id,a.access_token_encrypted,a.token_expires_at,p.phone_number_id
    FROM whatsapp_accounts a
    LEFT JOIN LATERAL (SELECT phone_number_id FROM whatsapp_phone_numbers WHERE business_id=a.business_id AND whatsapp_account_id=a.id ORDER BY is_default DESC,created_at LIMIT 1) p ON TRUE
    WHERE a.business_id=$1 AND a.status='connected' AND ($2='' OR a.id=$2)
    ORDER BY a.is_default DESC,a.created_at LIMIT 1`, [businessId, accountId])).rows[0];
  return account;
}

export async function syncTemplatesForBusiness(businessId, accountId = '') {
  const account = await accountForTemplateSync(businessId, accountId);
  if (!account?.waba_id || !account.access_token_encrypted) {
    return { synced: 0, skipped: true, reason: 'not_connected' };
  }
  if (account.token_expires_at && new Date(account.token_expires_at) <= new Date()) {
    return { synced: 0, skipped: true, reason: 'token_expired' };
  }
  const templates = await listWhatsAppTemplates({ setup: account });
  let synced = 0;
  for (const item of templates) {
    const name = clean(item.name);
    if (!name) continue;
    const components = templateComponentsFromMeta(item.components);
    const status = normalizeTemplateStatus(item.status);
    await query(
      `INSERT INTO templates (id, business_id, waba_id, name, category, language, header_text, body, footer_text, buttons, component_schema, variables, status, meta_template_id, meta_template_name, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'Meta sync')
       ON CONFLICT (business_id, waba_id, name, language) DO UPDATE SET category = EXCLUDED.category,
         header_text = EXCLUDED.header_text, body = EXCLUDED.body, footer_text = EXCLUDED.footer_text, buttons = EXCLUDED.buttons,
         component_schema = EXCLUDED.component_schema,
         variables = EXCLUDED.variables, status = EXCLUDED.status, meta_template_id = EXCLUDED.meta_template_id,
         meta_template_name = EXCLUDED.meta_template_name, source = 'Meta sync', content_revision = templates.content_revision + 1, updated_at = NOW()`,
      [id('t'), businessId, account.waba_id, name, clean(item.category) || 'MARKETING', clean(item.language) || 'en_US', components.headerText, components.body, components.footerText, JSON.stringify(components.buttons), JSON.stringify(components.componentSchema), JSON.stringify(templateVariables(components.body)), status, clean(item.id), name]
    );
    synced += 1;
  }
  return { synced, wabaId: account.waba_id };
}

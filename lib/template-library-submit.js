import { AppError, id, query } from './db.js';
import { createWhatsAppTemplate, templateApiName } from './meta.js';
import { templateVariables, normalizeTemplateStatus } from './workspace-mappers.js';

const clean = (value) => String(value || '').trim();

async function templateAccountForBusiness(businessId, accountId = '') {
  if (accountId && (typeof accountId !== 'string' || accountId.length > 100)) {
    throw new AppError('Choose a WhatsApp account.', 400, 'META_ACCOUNT_INVALID');
  }
  const load = async () =>
    (
      await query(
        `SELECT a.id,a.waba_id,a.access_token_encrypted,a.token_expires_at,p.phone_number_id
           FROM whatsapp_accounts a
           LEFT JOIN LATERAL (
             SELECT phone_number_id FROM whatsapp_phone_numbers
              WHERE business_id=a.business_id AND whatsapp_account_id=a.id
              ORDER BY is_default DESC,created_at LIMIT 1
           ) p ON TRUE
          WHERE a.business_id=$1 AND a.status='connected' AND ($2='' OR a.id=$2)
            AND COALESCE(a.access_token_encrypted,'')<>''
          ORDER BY a.is_default DESC,a.created_at LIMIT 1`,
        [businessId, accountId]
      )
    ).rows[0];
  const account = await load();
  if (!account?.waba_id || !account.access_token_encrypted || (account.token_expires_at && new Date(account.token_expires_at) <= new Date())) {
    throw new AppError('Connect or reauthorize the selected WhatsApp account.', 409, 'META_RECONNECT_REQUIRED');
  }
  return account;
}

async function uniqueTemplateName(businessId, preferred) {
  const base = clean(preferred).slice(0, 200) || 'library_template';
  const existing = await query('SELECT 1 FROM templates WHERE business_id=$1 AND lower(name)=lower($2)', [businessId, base]);
  if (!existing.rowCount) return base;
  const suffix = Date.now().toString(36).slice(-5);
  return `${base}_${suffix}`.slice(0, 255);
}

/**
 * Materialize a curated library item into the workspace templates table
 * (and optionally submit to Meta) using the same path as manual creation.
 */
export async function createTemplateFromLibraryItem({
  session,
  item,
  submitToMeta = false,
  accountId = '',
  customName = ''
}) {
  const name = await uniqueTemplateName(session.businessId, clean(customName) || clean(item.name));
  const category = item.category;
  const language = clean(item.language) || 'en_US';
  const templateBody = clean(item.body);
  const headerText = clean(item.header_text).slice(0, 60);
  const footerText = clean(item.footer_text).slice(0, 60);
  const schema = item.component_schema && typeof item.component_schema === 'object' ? item.component_schema : {};
  const buttons = Array.isArray(schema.buttons) ? schema.buttons : [];
  const componentSchema = {
    headerFormat: clean(schema.headerFormat || (headerText ? 'TEXT' : 'NONE')).toUpperCase(),
    headerMediaHandle: clean(schema.headerMediaHandle),
    buttons,
    otpType: clean(schema.otpType || 'COPY_CODE').toUpperCase(),
    otpButtonText: clean(schema.otpButtonText || 'Copy code'),
    otpAutofillText: clean(schema.otpAutofillText || 'Autofill'),
    otpPackageName: clean(schema.otpPackageName),
    otpSignatureHash: clean(schema.otpSignatureHash),
    codeExpirationMinutes: Math.max(1, Math.min(Number(schema.codeExpirationMinutes) || 10, 90)),
    addSecurityRecommendation: schema.addSecurityRecommendation !== false
  };

  if (!name || !templateBody) {
    throw new AppError('Library template is missing name or body.', 500, 'LIBRARY_TEMPLATE_INVALID');
  }

  const account = submitToMeta || accountId ? await templateAccountForBusiness(session.businessId, accountId || '') : null;
  if (account) {
    const exists = await query(
      'SELECT 1 FROM templates WHERE business_id=$1 AND waba_id=$2 AND meta_template_name=$3 AND language=$4',
      [session.businessId, account.waba_id, templateApiName(name), language]
    );
    if (exists.rowCount) {
      throw new AppError('This template language already exists for the selected WhatsApp account.', 409, 'TEMPLATE_EXISTS');
    }
  }

  let metaTemplate = { id: '', name: templateApiName(name), status: 'DRAFT' };
  if (submitToMeta) {
    if (!account) throw new AppError('Connect a WhatsApp account before submitting to Meta.', 409, 'META_NOT_CONFIGURED');
    metaTemplate = await createWhatsAppTemplate({
      setup: account,
      name,
      body: templateBody,
      category,
      language,
      headerText,
      footerText,
      buttons,
      componentSchema
    });
  }

  const templateId = id('t');
  await query(
    `INSERT INTO templates (
       id, business_id, waba_id, name, category, language, header_text, body, footer_text,
       buttons, component_schema, variables, status, meta_template_id, meta_template_name, source
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16)`,
    [
      templateId,
      session.businessId,
      account?.waba_id || '',
      name,
      category,
      language,
      headerText,
      templateBody,
      footerText,
      JSON.stringify(buttons),
      JSON.stringify(componentSchema),
      JSON.stringify(templateVariables(templateBody)),
      submitToMeta ? normalizeTemplateStatus(metaTemplate.status) : 'Draft',
      metaTemplate.id || '',
      metaTemplate.name || templateApiName(name),
      submitToMeta ? 'Template library (Meta)' : 'Template library'
    ]
  );

  const template = (
    await query('SELECT id, name, body, category, language, status, waba_id FROM templates WHERE id=$1 AND business_id=$2', [
      templateId,
      session.businessId
    ])
  ).rows[0];

  return {
    templateId,
    template: {
      id: template.id,
      name: template.name,
      body: template.body,
      category: template.category,
      language: template.language,
      status: template.status,
      wabaId: template.waba_id || ''
    }
  };
}

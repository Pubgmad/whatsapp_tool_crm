import crypto from "crypto";
import {recordSupportInbound,recordSupportResponse} from './support-policy.js';
import {enqueueAiAutoReply,cancelPendingAiReply} from './ai-auto-replies.js';
import {messagingSetupForContact} from './messaging-setup.js';
import { workspaceFeatureFlags } from './feature-controls.js';
import {resolveTrackedParameters} from './click-tracking.js';
import {applyFlowReply,applyEntryAttribution,parseFlowReply} from './whatsapp-experiences.js';
import {ingestCallingWebhook} from './whatsapp-calling.js';
import {ingestNativePaymentWebhook} from './whatsapp-native-payments.js';
import {advancedTemplateComponents} from './advanced-template-components.js';
import { validateTemplateParameters } from './template-send-components';
import { ingestCatalogOrder } from './whatsapp-commerce';
import { ingestWorkspaceGroupMessage, updateWorkspaceGroupMessageStatus } from './workspace-groups-inbox.js';
import { applyMetaConfigurationEvent } from './meta-configuration-events';
import { ingestCoexistenceWebhook } from './coexistence';
import { currentAccount, requireSession } from "./auth";
import { enqueueAutomationForIncoming, listAutomationFlows, runAutomationQueue } from "./automation";
import { AppError, enterTenantContext, errorJson, id, json, query, toIso, transaction } from "./db";
import { assertCampaignCapacity, assertContactCapacity, assertMessageCapacity, subscriptionUsage } from "./limits";
import { createWhatsAppTemplate, decryptSecret, encryptSecret, fetchWhatsAppMedia, listWhatsAppTemplates, metaReady, sendInteractiveMessage, sendMarketingTemplateMessage, sendTemplateMessage, sendTextMessage, templateApiName } from "./meta";
import { getPublicPlatformConfig } from "./platform";
import { listAudienceSegments, resolveSegmentContactIds } from "./segments";
import { getWhatsAppOperationsState } from "./whatsapp-operations";
import { requireWorkspaceManager } from "./workspace-permissions";
import { verifyManualWhatsAppCredentials } from "./meta-onboarding";
import { readJsonBodyLimited, readOptionalJsonBodyLimited, readTextBodyLimited } from "./security";
import { normalizeWhatsAppReferral } from "./whatsapp-referral";
import { campaignDispatchState, updateCampaignCompletion } from "./campaign-queue-safety";
import {campaignControlAction, campaignFrequencyHours, campaignPolicyForBusiness, campaignReportStatus, reserveCampaignDelivery} from './campaign-controls.js';
import { campaignSourceForWorkspaceCreate } from './campaign-source.js';
import { okToReply } from './reply-window.js';
export { okToReply } from './reply-window.js';
import { publicMetaHealth, recordMetaWebhookActivity } from "./meta-health";
import { pushOutboundCrmContact } from './crm-contact-export.js';
import { loadState, stateOptions, WORKSPACE_VIEWS } from './workspace-state.js';
import { queueBatchSize, runCampaignQueue } from './campaign-queue-runner.js';
import {
  clean,
  cleanPhone,
  mapTemplate,
  mapContact,
  mapCampaign,
  mapRecipient,
  mapMessage,
  mapSetup,
  campaignStats,
  renderTemplate,
  templateVariables,
  normalizeTags,
  normalizeAttributes,
  parseCsvRows,
  csvCell,
  permissionFromCell,
  isHeaderRow,
  normalizeTemplateStatus,
  templateComponentsFromMeta,
  normalizeTemplateButtons
} from './workspace-mappers.js';


const MAX_CONTACT_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_CONTACT_IMPORT_ROWS = 5000;

export async function getState(request) {
  try {
    const account = await currentAccount(request);
    return json(await loadState(account, stateOptions(request)));
  } catch (error) {
    return errorJson(error);
  }
}

export async function getMe(request) {
  try {
    return json(await currentAccount(request));
  } catch (error) {
    return errorJson(error);
  }
}

export async function updateSetup(request) {
  try {
    const session = await requireSession(request);
    if (!["Owner", "Manager"].includes(session.role)) throw new AppError("Only workspace owners and managers can change the WhatsApp connection.", 403, "META_CONNECTION_FORBIDDEN");
    const body = await readJsonBodyLimited(request, 65536);
    const mode = "Live Meta";
    const phoneNumberId = clean(body.phoneNumberId);
    const wabaId = clean(body.wabaId);
    const accessToken = clean(body.accessToken);

    const current = await query("SELECT access_token_encrypted,name FROM businesses WHERE id = $1", [session.businessId]);
    const storedToken = current.rows[0]?.access_token_encrypted || "";
    const token = accessToken && accessToken !== "saved-token-hidden" ? accessToken : storedToken ? decryptSecret(storedToken) : "";
    const verified = await verifyManualWhatsAppCredentials({ wabaId, phoneNumberId, accessToken: token });
    const nextToken = encryptSecret(token);
    const whatsappNumber = clean(verified.phone.display_phone_number);
    const businessName = clean(body.businessName) || current.rows[0]?.name;
    const appUrl = clean(process.env.APP_URL);
    if (!appUrl || (process.env.NODE_ENV === "production" && !appUrl.startsWith("https://"))) {
      throw new AppError("Configure the public HTTPS APP_URL before connecting Meta.", 503, "META_HTTPS_REQUIRED");
    }
    const webhookUrl = `${appUrl.replace(/\/$/, "")}/api/webhooks/meta`;
    await transaction(async (client) => {
        await client.query(
          `UPDATE businesses
           SET name = $1, whatsapp_number = $2, waba_id = $3, phone_number_id = $4,
               access_token_encrypted = $5, webhook_url = $6, mode = $7, status = 'Connected',
               onboarding_method = 'manual', webhook_subscribed = TRUE, meta_token_expires_at = $8,
               meta_connected_at = NOW(), updated_at = NOW()
           WHERE id = $9`,
          [businessName, whatsappNumber, wabaId, phoneNumberId, nextToken, webhookUrl, mode, verified.expiresAt, session.businessId]
        );
        await client.query("UPDATE whatsapp_accounts SET is_default=FALSE WHERE business_id=$1", [session.businessId]);
        const account = await client.query(
          `INSERT INTO whatsapp_accounts (id,business_id,waba_id,onboarding_method,access_token_encrypted,is_default,status,webhook_subscribed,token_expires_at,last_synced_at)
           VALUES ($1,$2,$3,'manual',$4,TRUE,'connected',TRUE,$5,NOW())
           ON CONFLICT (business_id,waba_id) DO UPDATE SET access_token_encrypted=EXCLUDED.access_token_encrypted,is_default=TRUE,status='connected',webhook_subscribed=TRUE,token_expires_at=EXCLUDED.token_expires_at,health_status='unknown',health_reason='',health_checked_at=NULL,health_claimed_at=NULL,updated_at=NOW()
           RETURNING id`,
          [id("waa"), session.businessId, wabaId, nextToken, verified.expiresAt]
        );
        await client.query("UPDATE whatsapp_phone_numbers SET is_default=FALSE WHERE business_id=$1", [session.businessId]);
        await client.query(
          `INSERT INTO whatsapp_phone_numbers (id,business_id,whatsapp_account_id,phone_number_id,display_phone_number,is_default,status,registration_state,last_synced_at)
           VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7,NOW())
           ON CONFLICT (business_id,phone_number_id) DO UPDATE SET whatsapp_account_id=EXCLUDED.whatsapp_account_id,display_phone_number=EXCLUDED.display_phone_number,is_default=TRUE,status=EXCLUDED.status,registration_state=EXCLUDED.registration_state,updated_at=NOW()`,
          [id("wap"), session.businessId, account.rows[0].id, phoneNumberId, whatsappNumber, clean(verified.phone.status), ["CONNECTED", "READY"].includes(clean(verified.phone.status).toUpperCase()) ? "registered" : "unknown"]
        );
    });
    await audit(session, "setup_updated", { mode, status: "Connected" });
    return json({ ok: true });
  } catch (error) {
    return errorJson(error);
  }
}

function requireConsentEvidence(source, evidence) {
  if (!source || !evidence || evidence.length < 10 || source.length > 255 || evidence.length > 2000) {
    throw new AppError("Record the consent source and specific evidence before enabling marketing messages.", 400, "CONSENT_EVIDENCE_REQUIRED");
  }
}

async function recordConsent(client, session, contactId, source, evidence) {
  await client.query(
    "INSERT INTO contact_consent_events (id,business_id,contact_id,recorded_by,source,evidence,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())",
    [id("cce"), session.businessId, contactId, session.userId, source, evidence]
  );
}

export async function createContact(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    const body = await readJsonBodyLimited(request, 65536);
    const name = clean(body.name);
    const phone = cleanPhone(body.phone);
    const marketingPermission = body.marketingPermission === true;
    const tags = normalizeTags(body.tags);
    const optInSource = clean(body.optInSource);
    const consentEvidence = clean(body.consentEvidence);
    if (!name || !phone) throw new AppError("Name and phone are required.", 400, "VALIDATION_ERROR");
    if (marketingPermission) requireConsentEvidence(optInSource, consentEvidence);
    await transaction(async (client) => {
      await client.query("SELECT id FROM businesses WHERE id=$1 FOR UPDATE", [session.businessId]);
      const existing = (await client.query("SELECT id,unsubscribed FROM contacts WHERE business_id=$1 AND phone=$2 FOR UPDATE", [session.businessId, phone])).rows[0];
      if (existing?.unsubscribed && marketingPermission) throw new AppError("An opted-out contact needs a separately recorded new consent.", 409, "CONSENT_RECONFIRM_REQUIRED");
      if (!existing) await assertContactCapacity(session.businessId, 1, client);
      const saved = await client.query(
        `INSERT INTO contacts (id, business_id, name, phone, marketing_permission, unsubscribed, source, tags, opt_in_at, opt_in_source)
         VALUES ($1,$2,$3,$4,$5,$6,'Manual',$7,$8,$9)
         ON CONFLICT (business_id,phone) DO UPDATE SET name=EXCLUDED.name,
           marketing_permission=CASE WHEN contacts.unsubscribed THEN FALSE ELSE EXCLUDED.marketing_permission END,
           unsubscribed=contacts.unsubscribed OR EXCLUDED.unsubscribed,
           tags=EXCLUDED.tags, opt_in_at=CASE WHEN contacts.unsubscribed THEN contacts.opt_in_at ELSE EXCLUDED.opt_in_at END,
           opt_in_source=CASE WHEN contacts.unsubscribed THEN contacts.opt_in_source ELSE EXCLUDED.opt_in_source END,updated_at=NOW()
         RETURNING id,marketing_permission`,
        [id("c"), session.businessId, name, phone, marketingPermission, !marketingPermission, JSON.stringify(tags), marketingPermission ? new Date() : null, optInSource || "Manual"]
      );
      if (marketingPermission && saved.rows[0].marketing_permission) {
        await recordConsent(client, session, saved.rows[0].id, optInSource, consentEvidence);
      }
    });
    await audit(session, "contact_saved", { phone });
    return json({ ok: true }, 201);
  } catch (error) {
    return errorJson(error);
  }
}

export async function importContacts(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    const body = await readJsonBodyLimited(request, MAX_CONTACT_IMPORT_BYTES + 4096);
    if (typeof body?.csv !== 'string' || Buffer.byteLength(body.csv, 'utf8') > MAX_CONTACT_IMPORT_BYTES) {
      throw new AppError('CSV must be a text file no larger than 2 MB.', 413, 'UPLOAD_TOO_LARGE');
    }
    const rows = parseCsvRows(body.csv || "");
    if (rows.length > MAX_CONTACT_IMPORT_ROWS + 1) {
      throw new AppError('Import up to 5,000 contacts at a time.', 413, 'IMPORT_TOO_MANY_ROWS');
    }
    const validRows = [];
    let skipped = 0;

    for (const cells of rows) {
      const [first = "", second = "", third = "", fourth = "", fifth = "", sixth = ""] = cells.map((cell) => clean(cell));
      if (isHeaderRow(first, second, third)) continue;
      const rawName = first;
      const phone = cleanPhone(second);
      if (!rawName || !phone) {
        skipped += 1;
        continue;
      }
      const permissionProvided = Boolean(third);
      const allowed = permissionFromCell(third);
      if (allowed) requireConsentEvidence(fifth, sixth);
      validRows.push({ name: rawName, phone, allowed, permissionProvided, tags: normalizeTags(fourth), consentSource: fifth, consentEvidence: sixth });
    }

    if (validRows.length > MAX_CONTACT_IMPORT_ROWS) {
      throw new AppError('Import up to 5,000 contacts at a time.', 413, 'IMPORT_TOO_MANY_ROWS');
    }
    if (!validRows.length) throw new AppError("No valid contacts found. Use columns: name, phone, permission.", 400, "CSV_EMPTY");

    let suppressedPreserved = 0;
    await transaction(async (client) => {
      await client.query("SELECT id FROM businesses WHERE id=$1 FOR UPDATE", [session.businessId]);
      const existing = await client.query("SELECT phone,unsubscribed FROM contacts WHERE business_id=$1 AND phone=ANY($2) FOR UPDATE", [session.businessId, validRows.map((row) => row.phone)]);
      const existingByPhone = new Map(existing.rows.map((row) => [row.phone, row]));
      const newPhones = new Set(validRows.map((row) => row.phone).filter((phone) => !existingByPhone.has(phone)));
      await assertContactCapacity(session.businessId, newPhones.size, client);
      for (const row of validRows) {
        const wasExisting = existingByPhone.has(row.phone);
        const optedOut = Boolean(existingByPhone.get(row.phone)?.unsubscribed);
        if (optedOut && row.allowed) suppressedPreserved += 1;
        const saved = await client.query(
        `INSERT INTO contacts (id, business_id, name, phone, marketing_permission, unsubscribed, source, tags, opt_in_at, opt_in_source)
         VALUES ($1, $2, $3, $4, $5, $6, 'CSV import', $7, $8, $9)
         ON CONFLICT (business_id, phone) DO UPDATE
         SET name = EXCLUDED.name,
             marketing_permission = CASE WHEN NOT $10 OR contacts.unsubscribed THEN contacts.marketing_permission ELSE EXCLUDED.marketing_permission END,
             unsubscribed = CASE WHEN NOT $10 THEN contacts.unsubscribed ELSE contacts.unsubscribed OR EXCLUDED.unsubscribed END,
             source = 'CSV import', tags = EXCLUDED.tags,
             opt_in_at = CASE WHEN NOT $10 OR contacts.unsubscribed THEN contacts.opt_in_at ELSE EXCLUDED.opt_in_at END,
             opt_in_source = CASE WHEN NOT $10 OR contacts.unsubscribed THEN contacts.opt_in_source ELSE EXCLUDED.opt_in_source END, updated_at = NOW()
         RETURNING id,marketing_permission`,
        [id("c"), session.businessId, row.name, row.phone, row.allowed, !row.allowed, JSON.stringify(row.tags), row.allowed ? new Date() : null, row.consentSource || "CSV import", row.permissionProvided]
        );
        if (row.allowed && saved.rows[0].marketing_permission && !optedOut) {
          await recordConsent(client, session, saved.rows[0].id, row.consentSource, row.consentEvidence);
        }
        existingByPhone.set(row.phone, { unsubscribed: wasExisting ? optedOut || (row.permissionProvided && !row.allowed) : !row.allowed });
      }
    });

    await audit(session, "contacts_imported", { imported: validRows.length, skipped, suppressedPreserved });
    return json({ ok: true, importSummary: { imported: validRows.length, skipped, suppressedPreserved } }, 201);
  } catch (error) {
    return errorJson(error);
  }
}

export async function patchContact(request, context) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    const params = await context.params;
    const body = await readOptionalJsonBodyLimited(request, 65536);
    const name = body.name === undefined ? null : clean(body.name);
    const phone = body.phone === undefined ? null : cleanPhone(body.phone);
    if (name === "" || phone === "") throw new AppError("Name and phone cannot be empty.", 400, "VALIDATION_ERROR");
    const marketingPermission = typeof body.marketingPermission === "boolean" ? body.marketingPermission : null;
    const unsubscribed = typeof body.unsubscribed === "boolean" ? body.unsubscribed : null;
    const tags = body.tags === undefined ? null : JSON.stringify(normalizeTags(body.tags));
    const customAttributes = body.customAttributes === undefined ? null : JSON.stringify(normalizeAttributes(body.customAttributes));
    const optInSource = body.optInSource === undefined ? null : clean(body.optInSource);
    const consentEvidence = clean(body.consentEvidence);
    await transaction(async (client) => {
      const existing = (await client.query("SELECT id,marketing_permission,unsubscribed FROM contacts WHERE id=$1 AND business_id=$2 FOR UPDATE", [params.id, session.businessId])).rows[0];
      if (!existing) throw new AppError("Contact not found.", 404, "NOT_FOUND");
      const grantsConsent = marketingPermission === true && (!existing.marketing_permission || existing.unsubscribed);
      if (existing.unsubscribed && unsubscribed === false && marketingPermission !== true) {
        throw new AppError("New consent must be recorded before clearing an opt-out.", 400, "CONSENT_EVIDENCE_REQUIRED");
      }
      if (existing.unsubscribed && marketingPermission === true && unsubscribed !== false) {
        throw new AppError("Explicitly clear the opt-out with new consent evidence.", 400, "CONSENT_EVIDENCE_REQUIRED");
      }
      if (grantsConsent) requireConsentEvidence(optInSource, consentEvidence);
      await client.query(
      `UPDATE contacts
       SET name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           marketing_permission = COALESCE($3, marketing_permission),
           unsubscribed = COALESCE($4, unsubscribed),
           tags = COALESCE($5::jsonb, tags),
           custom_attributes = COALESCE($6::jsonb, custom_attributes),
           opt_in_source = COALESCE(NULLIF($7, ''), opt_in_source),
           opt_in_at = CASE WHEN $3 IS TRUE AND $10 THEN NOW() WHEN $3 IS FALSE THEN NULL ELSE opt_in_at END,
           updated_at = NOW()
       WHERE id = $8 AND business_id = $9`,
      [name, phone, marketingPermission, unsubscribed, tags, customAttributes, optInSource, params.id, session.businessId, grantsConsent]
      );
      if (grantsConsent) await recordConsent(client, session, params.id, optInSource, consentEvidence);
      if (customAttributes !== null) {
        const { enqueueCrmObjectPush } = await import('./crm-object-outbound.js');
        await enqueueCrmObjectPush(session.businessId, params.id, client);
      }
    });
    await audit(session, "contact_updated", { contactId: params.id });
    return json({ ok: true });
  } catch (error) {
    return errorJson(error);
  }
}

export async function getWorkspaceSection(request, context) {
  try {
    const params = await context.params;
    const view = clean(params.section);
    if (!WORKSPACE_VIEWS.has(view)) throw new AppError("Workspace section not found.", 404, "SECTION_NOT_FOUND");
    const account = await currentAccount(request);
    return json(await loadState(account, { ...stateOptions(request), view }));
  } catch (error) {
    return errorJson(error);
  }
}

export async function exportContacts(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    const header = ["name", "phone", "marketing_permission", "unsubscribed", "tags", "custom_attributes", "source", "opt_in_source", "opt_in_at", "created_at"]
      .map(csvCell).join(",");
    const encoder = new TextEncoder();
    let cursorTime = null;
    let cursorId = null;
    let finished = false;
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(encoder.encode(`${header}\r\n`)); },
      async pull(controller) {
        if (finished) { controller.close(); return; }
        try {
          enterTenantContext(session.businessId);
          const result = await query(
            `SELECT id,name,phone,marketing_permission,unsubscribed,tags,custom_attributes,source,opt_in_source,opt_in_at,created_at
               FROM contacts
              WHERE business_id=$1 AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::text))
              ORDER BY created_at DESC,id DESC LIMIT 500`,
            [session.businessId, cursorTime, cursorId]
          );
          if (!result.rows.length) { finished = true; controller.close(); return; }
          const rows = result.rows.map((row) => [
            row.name, row.phone, row.marketing_permission, row.unsubscribed,
            (row.tags || []).join("|"), JSON.stringify(row.custom_attributes || {}), row.source, row.opt_in_source,
            toIso(row.opt_in_at), toIso(row.created_at)
          ].map(csvCell).join(","));
          const last = result.rows.at(-1);
          cursorTime = last.created_at;
          cursorId = last.id;
          controller.enqueue(encoder.encode(`${rows.join("\r\n")}\r\n`));
          if (result.rows.length < 500) finished = true;
        } catch (error) { finished = true; controller.error(error); }
      },
      cancel() { finished = true; }
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return errorJson(error);
  }
}

export async function deleteContact(request, context) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    const params = await context.params;
    await query("DELETE FROM contacts WHERE id = $1 AND business_id = $2", [params.id, session.businessId]);
    await audit(session, "contact_deleted", { contactId: params.id });
    return json({ ok: true });
  } catch (error) {
    return errorJson(error);
  }
}

async function templateAccountForBusiness(businessId, accountId = '') {
  if (accountId && (typeof accountId !== 'string' || accountId.length > 100)) throw new AppError('Choose a WhatsApp account.', 400, 'META_ACCOUNT_INVALID');
  const account = (await query(`SELECT a.id,a.waba_id,a.access_token_encrypted,a.token_expires_at,p.phone_number_id
    FROM whatsapp_accounts a
    LEFT JOIN LATERAL (SELECT phone_number_id FROM whatsapp_phone_numbers WHERE business_id=a.business_id AND whatsapp_account_id=a.id ORDER BY is_default DESC,created_at LIMIT 1) p ON TRUE
    WHERE a.business_id=$1 AND a.status='connected' AND ($2='' OR a.id=$2)
    ORDER BY a.is_default DESC,a.created_at LIMIT 1`, [businessId,accountId])).rows[0];
  if (!account?.waba_id || !account.access_token_encrypted || (account.token_expires_at && new Date(account.token_expires_at) <= new Date())) {
    throw new AppError('Connect or reauthorize the selected WhatsApp account.', 409, 'META_RECONNECT_REQUIRED');
  }
  return account;
}

export async function createTemplate(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    const body = await readJsonBodyLimited(request, 262144);
    const name = clean(body.name);
    const category = ["MARKETING", "UTILITY", "AUTHENTICATION"].includes(clean(body.category).toUpperCase()) ? clean(body.category).toUpperCase() : "MARKETING";
    const templateBody = clean(body.body) || (category === "AUTHENTICATION" ? "Your verification code" : "");
    const headerText = clean(body.headerText).slice(0, 60);
    const footerText = clean(body.footerText).slice(0, 60);
    const advancedButtons = clean(body.advancedButtons).split(/\r?\n/).map((row) => {
      const [type, text, value] = row.split("|").map(clean);
      return { type: ["URL", "PHONE_NUMBER"].includes(type?.toUpperCase()) ? type.toUpperCase() : "QUICK_REPLY", text, value };
    }).filter((button) => button.text);
    const buttons = advancedButtons.length ? advancedButtons.slice(0, 10) : normalizeTemplateButtons(body.buttons);
    const componentSchema = {
      headerFormat: clean(body.headerFormat || (headerText ? "TEXT" : "NONE")).toUpperCase(),
      headerMediaHandle: clean(body.headerMediaHandle),
      buttons,
      otpType: clean(body.otpType || "COPY_CODE").toUpperCase(),
      otpButtonText: clean(body.otpButtonText || "Copy code"),
      otpAutofillText: clean(body.otpAutofillText || "Autofill"),
      otpPackageName: clean(body.otpPackageName),
      otpSignatureHash: clean(body.otpSignatureHash),
      codeExpirationMinutes: Math.max(1, Math.min(Number(body.codeExpirationMinutes) || 10, 90)),
      addSecurityRecommendation: body.addSecurityRecommendation !== false
    };
    const language = clean(body.language) || "en_US";
    if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language)) throw new AppError("Enter a valid Meta template language code.", 400, "TEMPLATE_LANGUAGE_INVALID");
    if(body.kind&&body.kind!=='STANDARD'){
      Object.assign(componentSchema,{kind:body.kind,cards:body.cards,bodyExamples:body.bodyExamples,catalogButtonText:body.catalogButtonText,couponExample:body.couponExample,offerUrl:body.offerUrl,offerButtonText:body.offerButtonText,offerUrlExample:body.offerUrlExample,offerText:body.offerText,hasExpiration:body.hasExpiration});
      componentSchema.components=advancedTemplateComponents(componentSchema,templateBody,category);
      componentSchema.buttons=componentSchema.components.find(component=>component.type==='BUTTONS')?.buttons||[];
    }
    if (!name || !templateBody) throw new AppError("Template name and body are required.", 400, "VALIDATION_ERROR");
    if (/{{/.test(headerText)) throw new AppError("Dynamic variables are supported in the template body, not the text header.", 400, "VALIDATION_ERROR");
    const submitToMeta = Boolean(body.submitToMeta);
    const account = submitToMeta || body.accountId ? await templateAccountForBusiness(session.businessId, body.accountId || '') : null;
    if (account && (await query('SELECT 1 FROM templates WHERE business_id=$1 AND waba_id=$2 AND meta_template_name=$3 AND language=$4',
      [session.businessId,account.waba_id,templateApiName(name),language])).rowCount) throw new AppError('This template language already exists for the selected WABA.',409,'TEMPLATE_EXISTS');
    const metaTemplate = submitToMeta
      ? await createWhatsAppTemplate({ setup: account, name, body: templateBody, category, language, headerText, footerText, buttons, componentSchema })
      : { id: "", name: templateApiName(name), status: "DRAFT" };
    await query(
      `INSERT INTO templates (id, business_id, waba_id, name, category, language, header_text, body, footer_text, buttons, component_schema, variables, status, meta_template_id, meta_template_name, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [id("t"), session.businessId, account?.waba_id || '', name, category, language, headerText, templateBody, footerText, JSON.stringify(buttons), JSON.stringify(componentSchema), JSON.stringify(templateVariables(templateBody)), submitToMeta ? normalizeTemplateStatus(metaTemplate.status) : "Draft", metaTemplate.id, metaTemplate.name, submitToMeta ? "Meta submission" : "Manual draft"]
    );
    await audit(session, "template_created", { name, submitToMeta, wabaId: account?.waba_id || '' });
    return json({ ok: true }, 201);
  } catch (error) { return errorJson(error); }
}

export async function syncTemplatesFromMeta(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    const body = await readJsonBodyLimited(request, 2048);
    const result = await (await import('./template-meta-sync.js')).syncTemplatesForBusiness(session.businessId, body.accountId || '');
    if (result.skipped) throw new AppError('Connect or reauthorize the selected WhatsApp account.', 409, 'META_RECONNECT_REQUIRED');
    await audit(session, 'templates_synced', { synced: result.synced, wabaId: result.wabaId });
    return json({ ok: true, synced: result.synced }, 201);
  } catch (error) { return errorJson(error); }
}
export async function createCampaign(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    const body = await readJsonBodyLimited(request, 2_000_000);
    const variables = body.variables || {};
    let frequencyHours = campaignFrequencyHours(body.frequencyHours);
    let approvalStatus = body.requireApproval === true ? 'pending' : 'not_required';
    const name = clean(body.name);
    if (!name || name.length > 255) throw new AppError('Enter a campaign name of up to 255 characters.',400,'CAMPAIGN_NAME_REQUIRED');
    const requestedContactIds = Array.isArray(body.contactIds) ? body.contactIds.map(clean).filter(Boolean) : [];
    const segmentId = clean(body.segmentId);
    const retargetSourceCampaignId = clean(body.retargetSourceCampaignId);
    const dynamicAudience = body.dynamicAudience !== false && Boolean(segmentId);
    let segmentContactIds = [];
    if (segmentId) {
      const segment = (await query("SELECT rules FROM audience_segments WHERE id = $1 AND business_id = $2 AND is_active = TRUE", [segmentId, session.businessId])).rows[0];
      if (!segment) throw new AppError("Select an active audience segment.", 400, "SEGMENT_NOT_FOUND");
      segmentContactIds = await resolveSegmentContactIds(session.businessId, segment.rules);
    }
    if (retargetSourceCampaignId && !(await query('SELECT 1 FROM campaigns WHERE id=$1 AND business_id=$2', [retargetSourceCampaignId, session.businessId])).rowCount) {
      throw new AppError('Source campaign for retargeting was not found.', 400, 'RETARGET_SOURCE_INVALID');
    }
    const contactIds = [...new Set([...requestedContactIds, ...segmentContactIds])];
    const automationFlowId = clean(body.automationFlowId);
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) throw new AppError("Choose a valid campaign schedule.", 400, "VALIDATION_ERROR");
    const runAt = scheduledAt && scheduledAt.getTime() > Date.now() ? scheduledAt : new Date();
    let campaignStatus = approvalStatus === 'pending' ? 'pending_approval' : runAt.getTime() > Date.now() ? "scheduled" : "queued";
    const { validateCampaignTimezone } = await import('./campaign-operations.js');
    const timezone = validateCampaignTimezone(clean(body.timezone) || 'UTC');
    const recurringIntervalDays = Number(body.recurringIntervalDays ?? 0);
    if (!Number.isInteger(recurringIntervalDays) || recurringIntervalDays < 0 || recurringIntervalDays > 365) {
      throw new AppError('Recurring interval must be between 0 and 365 days.', 400, 'CAMPAIGN_RECURRENCE_INVALID');
    }
    const templateResult = await query("SELECT * FROM templates WHERE id = $1 AND business_id = $2", [body.templateId, session.businessId]);
    const template = templateResult.rows[0];
    const deliveryMethod = clean(body.deliveryMethod) || 'cloud_api';
    if (!['cloud_api', 'marketing_messages_api'].includes(deliveryMethod)) {
      throw new AppError('Choose a supported campaign delivery method.', 400, 'CAMPAIGN_DELIVERY_INVALID');
    }
    if (deliveryMethod === 'marketing_messages_api' && template?.category !== 'MARKETING') {
      throw new AppError('Marketing Messages API accepts only approved marketing templates.', 400, 'MARKETING_TEMPLATE_REQUIRED');
    }
    if (!template || template.status !== "Approved") throw new AppError("Select an approved template.", 400, "VALIDATION_ERROR");
    const templateParameters = validateTemplateParameters(template, body.parameters || {});

    const contactResult = await query(
      `SELECT * FROM contacts
       WHERE business_id = $1 AND id = ANY($2) AND marketing_permission = TRUE AND unsubscribed = FALSE`,
      [session.businessId, contactIds]
    );
    if (!contactResult.rows.length) throw new AppError("No opted-in contacts selected.", 400, "VALIDATION_ERROR");
    await assertCampaignCapacity(session.businessId, contactResult.rows.length);

    let linkedFlow = null;
    if (automationFlowId) {
      linkedFlow = (await query("SELECT * FROM automation_flows WHERE id = $1 AND business_id = $2 AND status = 'active'", [automationFlowId, session.businessId])).rows[0];
      if (!linkedFlow) throw new AppError("Select an active automation flow or leave follow-up automation empty.", 400, "FLOW_NOT_FOUND");
    }

    const business = (await query("SELECT * FROM businesses WHERE id = $1", [session.businessId])).rows[0];
    const requestedPhone = clean(body.phoneNumberId);
    const sender = (await query(`SELECT p.phone_number_id,a.waba_id,a.capabilities,a.access_token_encrypted,a.token_expires_at
      FROM whatsapp_phone_numbers p JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id
      WHERE p.business_id=$1 AND a.status='connected' AND ($2<>'' AND p.phone_number_id=$2 OR $2='' AND p.is_default)
      ORDER BY p.is_default DESC,p.created_at LIMIT 1`,[session.businessId,requestedPhone])).rows[0];
    if (!sender || !metaReady(sender) || (sender.token_expires_at && new Date(sender.token_expires_at)<=new Date())) {
      throw new AppError('Choose a connected WhatsApp number with valid authorization.',409,'META_RECONNECT_REQUIRED');
    }
    if (template.waba_id && template.waba_id!==sender.waba_id || !template.waba_id && sender.waba_id!==business.waba_id) {
      throw new AppError('The template is not assigned to this number\'s WABA. Sync it from the correct account first.',409,'TEMPLATE_WABA_MISMATCH');
    }
    if (deliveryMethod === 'marketing_messages_api') {
      await assertWorkspaceFeature('marketing_messages', session.businessId);
      if (sender.capabilities?.marketing_messages_api?.status !== 'ONBOARDED') {
        throw new AppError('Marketing Messages is not onboarded for this WABA. Complete Meta setup, then sync the WhatsApp account.', 409, 'MARKETING_MESSAGES_NOT_ONBOARDED');
      }
    }

    await transaction(async (client) => {
      const campaignId = id("k");
      const source = campaignSourceForWorkspaceCreate({ campaignId, retargetSourceCampaignId });
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[session.businessId]);
      const policy=await campaignPolicyForBusiness(session.businessId,client);
      if (policy.approvalRequired) {approvalStatus='pending';campaignStatus='pending_approval';}
      if (template.category==='MARKETING') frequencyHours=Math.max(frequencyHours,policy.minMarketingIntervalHours);
      await assertCampaignCapacity(session.businessId,contactResult.rows.length,client);
      await client.query(
        `INSERT INTO campaigns (id, business_id, name, template_id, automation_flow_id, variables, mode, status, scheduled_at, timezone, delivery_method, template_parameters, approval_status, created_by, frequency_hours, whatsapp_phone_number_id, recurring_interval_days, audience_segment_id, retarget_source_campaign_id, dynamic_audience, source_kind, source_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
        [campaignId, session.businessId, name, template.id, linkedFlow?.id || null, JSON.stringify(variables), business.mode, campaignStatus, scheduledAt, timezone, deliveryMethod, JSON.stringify(templateParameters), approvalStatus, session.userId, frequencyHours, sender.phone_number_id, recurringIntervalDays, segmentId || null, retargetSourceCampaignId || null, dynamicAudience, source.sourceKind, source.sourceId]
      );
      for (const contact of contactResult.rows) {
        const recipientId = id("r");
        const message = renderTemplate(template.body, mapContact(contact), variables);
        await client.query(
          `INSERT INTO campaign_recipients (id, campaign_id, contact_id, message, status)
           VALUES ($1, $2, $3, $4, 'queued')`,
          [recipientId, campaignId, contact.id, message]
        );
        if (approvalStatus !== 'pending') await client.query(
          `INSERT INTO campaign_jobs (id, campaign_recipient_id, status, run_at)
           VALUES ($1, $2, 'queued', $3)`,
          [id("j"), recipientId, runAt]
        );
      }
      await client.query('INSERT INTO events (id,business_id,type,metadata) VALUES ($1,$2,$3,$4)',[id('e'),session.businessId,approvalStatus==='pending'?'campaign_pending_review':'campaign_queued',JSON.stringify({recipients:contactResult.rows.length,automationFlowId:linkedFlow?.id||'',frequencyHours})]);
    });
    await audit(session, approvalStatus==='pending'?'campaign_pending_review':'campaign_queued', { contacts: contactResult.rows.length, automationFlowId: linkedFlow?.id || "",frequencyHours });
    return json({ ok: true, approvalStatus }, 201);
  } catch (error) {
    return errorJson(error);
  }
}

export async function updateCampaignLifecycle(request, context) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    const params = await context.params;
    const body = await readOptionalJsonBodyLimited(request, 65536);
    const action = clean(body.action).toLowerCase();
    if (['duplicate','submit','approve','reject'].includes(action)) return json(await campaignControlAction(session,params.id,{...body,action}));
    if (action === 'retry_failed') {
      const { assertWorkspaceFeature } = await import('./feature-controls.js');
      const { retryFailedCampaignRecipients } = await import('./campaign-controls.js');
      await assertWorkspaceFeature('campaigns', session.businessId);
      return json(await retryFailedCampaignRecipients(session, params.id));
    }
    if (!["pause", "resume", "cancel"].includes(action)) throw new AppError("Unsupported campaign action.", 400, "VALIDATION_ERROR");

    const campaign = (await query("SELECT * FROM campaigns WHERE id = $1 AND business_id = $2", [params.id, session.businessId])).rows[0];
    if (!campaign) throw new AppError("Campaign not found.", 404, "CAMPAIGN_NOT_FOUND");
    if (action === "cancel" && ["completed", "cancelled"].includes(campaign.status)) throw new AppError("This campaign can no longer be cancelled.", 409, "CAMPAIGN_FINALIZED");
    if (action === "pause" && !["queued", "scheduled", "processing"].includes(campaign.status)) throw new AppError("Only queued, scheduled, or processing campaigns can be paused.", 409, "CAMPAIGN_NOT_ACTIVE");
    if (action === "resume" && campaign.status !== "paused") throw new AppError("Only paused campaigns can be resumed.", 409, "CAMPAIGN_NOT_PAUSED");

    await transaction(async (client) => {
      if (action === "pause") {
        await client.query("UPDATE campaigns SET status = 'paused' WHERE id = $1 AND business_id = $2", [params.id, session.businessId]);
      } else if (action === "resume") {
        await client.query("UPDATE campaigns SET status = CASE WHEN scheduled_at > NOW() THEN 'scheduled' ELSE 'queued' END WHERE id = $1 AND business_id = $2", [params.id, session.businessId]);
      } else {
        await client.query("UPDATE campaigns SET status = 'cancelled' WHERE id = $1 AND business_id = $2", [params.id, session.businessId]);
        await client.query(
          `UPDATE campaign_jobs j SET status = 'failed', completed_at = NOW(), error_message = 'Campaign cancelled', updated_at = NOW()
           FROM campaign_recipients cr WHERE j.campaign_recipient_id = cr.id AND cr.campaign_id = $1 AND j.status IN ('queued', 'retry')`,
          [params.id]
        );
        await client.query("UPDATE campaign_recipients SET status = 'failed', error_message = 'Campaign cancelled', updated_at = NOW() WHERE campaign_id = $1 AND status = 'queued'", [params.id]);
      }
    });
    await audit(session, `campaign_${action}`, { campaignId: params.id });
    return json({ ok: true });
  } catch (error) {
    return errorJson(error);
  }
}

export async function processCampaignQueue(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    const body = await readOptionalJsonBodyLimited(request, 16384);
    const summary = await runCampaignQueue({ businessId: session.businessId, limit: Number(body.limit) || queueBatchSize() });
    await audit(session, "campaign_queue_processed", summary);
    return json({ ok: true, queueSummary: summary });
  } catch (error) {
    return errorJson(error);
  }
}

export async function processCampaignQueueJob(request) {
  try {
    const { enterSystemContext } = await import('./db');
    enterSystemContext();
    const expected = clean(process.env.JOB_RUNNER_SECRET);
    const header = clean(request.headers.get("authorization")).replace(/^Bearer\s+/i, "");
    if (!expected || expected.startsWith("replace-with")) throw new AppError("JOB_RUNNER_SECRET is not configured.", 503, "JOB_SECRET_NOT_CONFIGURED");
    if (header !== expected) throw new AppError("Invalid job runner secret.", 401, "JOB_UNAUTHORIZED");
    const body = await readOptionalJsonBodyLimited(request, 16384);
    const summary = await runCampaignQueue({ businessId: clean(body.businessId), limit: Number(body.limit) || queueBatchSize() });
    return json({ ok: true, queueSummary: summary });
  } catch (error) {
    return errorJson(error);
  }
}


export async function getMessageMedia(request, context) {
  try {
    const session = await requireSession(request);
    const params = await context.params;
    const message = (await query(
      `SELECT m.media_id, m.mime_type, m.metadata, b.*,
              p.phone_number_id AS source_phone_number_id,
              a.waba_id AS source_waba_id,
              a.access_token_encrypted AS source_access_token_encrypted
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN businesses b ON b.id = c.business_id
       LEFT JOIN whatsapp_phone_numbers p ON p.business_id = b.id AND p.phone_number_id = c.whatsapp_phone_number_id
       LEFT JOIN whatsapp_accounts a ON a.business_id = b.id AND a.id = p.whatsapp_account_id
       WHERE m.id = $1 AND c.business_id = $2 AND m.media_id <> ''`,
      [params.id, session.businessId]
    )).rows[0];
    if (!message) throw new AppError("Media message not found.", 404, "MEDIA_NOT_FOUND");
    if (message.source_phone_number_id && message.source_phone_number_id !== message.phone_number_id && !message.source_access_token_encrypted) {
      throw new AppError("The WhatsApp number for this media is no longer connected.", 409, "META_SOURCE_DISCONNECTED");
    }
    const setup = message.source_phone_number_id && message.source_access_token_encrypted
      ? { ...message, phone_number_id: message.source_phone_number_id, waba_id: message.source_waba_id, access_token_encrypted: message.source_access_token_encrypted }
      : message;
    const media = await fetchWhatsAppMedia({ setup, mediaId: message.media_id });
    const filename = clean(message.metadata?.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
    return new Response(media.bytes, {
      status: 200,
      headers: {
        "Content-Type": media.contentType || message.mime_type || "application/octet-stream",
        "Content-Disposition": `${filename ? "attachment" : "inline"}; filename="${filename || `whatsapp-media-${params.id}`}"`,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    return errorJson(error);
  }
}

export async function sendReply(request) {
  try {
    const session = await requireSession(request);
    const body = await readJsonBodyLimited(request, 65536);
    const contact = await findContact(session.businessId, body.contactId);
    if (!contact) throw new AppError("Contact not found.", 404, "NOT_FOUND");
    await assertConversationOwnership(session, contact.id);
    if (!okToReply(contact)) throw new AppError("Normal reply period expired. Select an approved template to contact this customer.", 403, "REPLY_WINDOW_CLOSED");
    await assertMessageCapacity(session.businessId, 1, null, contact.id);
    const business = await messagingSetupForContact(session.businessId, contact.id);
    const messageBody = clean(body.body);
    if (!messageBody) throw new AppError("Message text is required.", 400, "VALIDATION_ERROR");
    const existingConversation=await query('SELECT id FROM conversations WHERE business_id=$1 AND contact_id=$2',[session.businessId,contact.id]);
    if(existingConversation.rows[0])await cancelPendingAiReply(session.businessId,existingConversation.rows[0].id);
    const interactiveOptions = Array.isArray(body.options)
      ? body.options.map((option, index) => ({ id: clean(option.id) || `option_${index + 1}`, label: clean(option.label), description: clean(option.description) })).filter((option) => option.label)
      : [];
    const meta = interactiveOptions.length
      ? await sendInteractiveMessage({ setup: business, to: contact.phone, body: messageBody, options: interactiveOptions, mode: body.mode === "list" ? "list" : "buttons", buttonText: clean(body.buttonText) || "Choose", sectionTitle: clean(body.sectionTitle) || "Options" })
      : await sendTextMessage({ setup: business, to: contact.phone, body: messageBody });
    const conversationId = await findOrCreateConversation(session.businessId, contact.id);
    await query("UPDATE conversations SET updated_at = NOW(), version = version + 1 WHERE id = $1", [conversationId]);
    await query("INSERT INTO messages (id, conversation_id, direction, body, status, meta_message_id, message_type, metadata) VALUES ($1, $2, 'outgoing', $3, $4, $5, $6, $7)", [id("m"), conversationId, messageBody, meta.status, meta.metaMessageId, interactiveOptions.length ? "interactive" : "text", JSON.stringify(interactiveOptions.length ? { mode: body.mode === "list" ? "list" : "buttons", options: interactiveOptions } : {})]);
    await audit(session, "message_sent", { contactId: contact.id, type: interactiveOptions.length ? "interactive" : "text" });
    await recordSupportResponse(session.businessId,conversationId);
    return json({ ok: true }, 201);
  } catch (error) {
    return errorJson(error);
  }
}

export async function sendTemplateReply(request) {
  try {
    const session = await requireSession(request);
    const body = await readJsonBodyLimited(request, 65536);
    const contact = await findContact(session.businessId, body.contactId);
    if (!contact) throw new AppError("Contact not found.", 404, "NOT_FOUND");
    await assertConversationOwnership(session, contact.id);
    const template = (await query("SELECT * FROM templates WHERE id = $1 AND business_id = $2 AND status = 'Approved'", [body.templateId, session.businessId])).rows[0];
    if (!template) throw new AppError("Select an approved template.", 400, "VALIDATION_ERROR");
    validateTemplateParameters(template, body.parameters || {});
    await assertMessageCapacity(session.businessId, 1, null, contact.id);
    const business = await messagingSetupForContact(session.businessId, contact.id);
    if ((template.waba_id && template.waba_id !== business.waba_id) || (!template.waba_id && business.waba_id !== business.default_waba_id)) {
      throw new AppError("This template belongs to another WhatsApp account.", 409, "TEMPLATE_WABA_MISMATCH");
    }
    const message = renderTemplate(template.body, mapContact(contact), body.variables || {});
    const existingConversation=await query('SELECT id FROM conversations WHERE business_id=$1 AND contact_id=$2',[session.businessId,contact.id]);
    if(existingConversation.rows[0])await cancelPendingAiReply(session.businessId,existingConversation.rows[0].id);
    const meta = await sendTemplateMessage({
      setup: business,
      to: contact.phone,
      templateName: template.meta_template_name || templateApiName(template.name),
      language: template.language,
      parameters: body.parameters || {},
      variables: (template.variables || []).map((key) => key === "name" ? contact.name : (body.variables || {})[key] || "")
    });
    const conversationId = await findOrCreateConversation(session.businessId, contact.id);
    await query("UPDATE conversations SET updated_at = NOW(), version = version + 1 WHERE id = $1", [conversationId]);
    await query("INSERT INTO messages (id, conversation_id, direction, body, status, meta_message_id) VALUES ($1, $2, 'outgoing', $3, $4, $5)", [id("m"), conversationId, message, meta.status, meta.metaMessageId]);
    await audit(session, "template_reply_sent", { contactId: contact.id, templateId: template.id });
    await recordSupportResponse(session.businessId,conversationId);
    return json({ ok: true }, 201);
  } catch (error) {
    return errorJson(error);
  }
}

export async function updateConversationWorkflow(request, context) {
  try {
    const session = await requireSession(request);
    const params = await context.params;
    const body = await readOptionalJsonBodyLimited(request, 16384);
    const action = clean(body.action).toLowerCase();
    const conversation = (await query("SELECT * FROM conversations WHERE id = $1 AND business_id = $2", [params.id, session.businessId])).rows[0];
    if (!conversation) throw new AppError("Conversation not found.", 404, "CONVERSATION_NOT_FOUND");

    const manager = ["Owner", "Manager"].includes(session.role);
    const assignedUserId = clean(body.assignedUserId);
    if (assignedUserId) {
      const member = (await query("SELECT user_id FROM memberships WHERE user_id = $1 AND business_id = $2", [assignedUserId, session.businessId])).rows[0];
      if (!member) throw new AppError("Assigned user must belong to this company.", 400, "INVALID_ASSIGNEE");
    }

    if (action === "assign") {
      if (!manager && assignedUserId !== session.userId) throw new AppError("Only workspace owners and managers can assign other agents.", 403, "ASSIGNMENT_FORBIDDEN");
      if(assignedUserId)await cancelPendingAiReply(session.businessId,params.id);
      await query("UPDATE conversations SET assigned_user_id = $1, updated_at = NOW(), version = version + 1 WHERE id = $2 AND business_id = $3", [assignedUserId || null, params.id, session.businessId]);
      await audit(session, "conversation_assigned", { conversationId: params.id, assignedUserId });
    } else if (action === "takeover") {
      const targetUserId = assignedUserId || session.userId;
      await cancelPendingAiReply(session.businessId,params.id);
      const claimed = await query(
        `UPDATE conversations
         SET automation_paused = TRUE, assigned_user_id = $1, status = 'open', updated_at = NOW(), version = version + 1
         WHERE id = $2 AND business_id = $3 AND ($4::boolean OR assigned_user_id IS NULL OR assigned_user_id = $1)
         RETURNING id`,
        [targetUserId, params.id, session.businessId, manager]
      );
      if (!claimed.rows[0]) throw new AppError("This conversation is already owned by another agent.", 409, "CONVERSATION_ALREADY_ASSIGNED");
      await query(
        `UPDATE automation_sessions
         SET status = 'handoff', human_takeover = TRUE, assigned_user_id = $1, ended_at = NOW(), updated_at = NOW()
         WHERE business_id = $2 AND contact_id = $3 AND status = 'active'`,
        [targetUserId, session.businessId, conversation.contact_id]
      );
      await audit(session, "conversation_takeover", { conversationId: params.id, assignedUserId: targetUserId });
    } else if (action === "resume") {
      if (!manager && conversation.assigned_user_id && conversation.assigned_user_id !== session.userId) throw new AppError("Only the assigned agent can resume this conversation.", 403, "CONVERSATION_FORBIDDEN");
      await query("UPDATE conversations SET automation_paused = FALSE, updated_at = NOW(), version = version + 1 WHERE id = $1 AND business_id = $2", [params.id, session.businessId]);
      await audit(session, "conversation_automation_resumed", { conversationId: params.id });
    } else if (action === "mark_read") {
      await query("UPDATE conversations SET unread_count = 0, last_read_at = NOW(), version = version + 1 WHERE id = $1 AND business_id = $2", [params.id, session.businessId]);
    } else if (action === "close" || action === "reopen") {
      if (!manager && conversation.assigned_user_id && conversation.assigned_user_id !== session.userId) throw new AppError("Only the assigned agent can update this conversation.", 403, "CONVERSATION_FORBIDDEN");
      if(action==='close')await cancelPendingAiReply(session.businessId,params.id);
      const nextStatus = action === "close" ? "closed" : "open";
      await transaction(async client=>{
        await client.query("UPDATE conversations SET status = $1, unread_count = CASE WHEN $1 = 'closed' THEN 0 ELSE unread_count END, updated_at = NOW(), version = version + 1 WHERE id = $2 AND business_id = $3", [nextStatus, params.id, session.businessId]);
        if(action==='close')await client.query('UPDATE support_waiting SET waiting_since=NULL,breached_at=NULL WHERE conversation_id=$1 AND business_id=$2',[params.id,session.businessId]);
      });
      await audit(session, `conversation_${action}`, { conversationId: params.id });
    } else if (action === "note") {
      const note = clean(body.note);
      if (!note) throw new AppError("Enter a note.", 400, "VALIDATION_ERROR");
      await query("INSERT INTO conversation_notes (id, business_id, conversation_id, user_id, body) VALUES ($1, $2, $3, $4, $5)", [id("n"), session.businessId, params.id, session.userId, note]);
      await audit(session, "conversation_note_added", { conversationId: params.id });
    } else {
      throw new AppError("Unsupported conversation action.", 400, "VALIDATION_ERROR");
    }

    return json({ ok: true });
  } catch (error) {
    return errorJson(error);
  }
}
export function verifyMetaWebhook(request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && token && expected && token === expected) return new Response(challenge || "ok", { status: 200 });
  return new Response("Forbidden", { status: 403 });
}

export async function receiveMetaWebhook(request) {
  try {
    const { enterSystemContext } = await import('./db');
    enterSystemContext();
    const rawBody = await readTextBodyLimited(request, 2_000_000);
    verifyWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"));
    const body = rawBody ? JSON.parse(rawBody) : {};
    const { enqueueMetaWebhookChanges } = await import('./meta-webhook-queue.js');
    await enqueueMetaWebhookChanges(body, businessForWebhook);
    return json({ ok: true });
  } catch (error) {
    return errorJson(error);
  }
}

export async function processMetaWebhookChange(businessId, wabaId, field, value) {
  const business = await businessForWebhook(value.metadata?.phone_number_id, wabaId);
  if (!business || business.id !== businessId) throw new AppError('WhatsApp asset ownership changed.', 409, 'META_ASSET_MISMATCH');
  if (field === 'calls') {
    await ingestCallingWebhook(businessId, value);
    await recordMetaWebhookActivity(businessId, wabaId, field);
    return;
  }
  if (['history', 'smb_app_state_sync', 'smb_message_echoes'].includes(field)) {
    await ingestCoexistenceWebhook(businessId, String(value.metadata?.phone_number_id || ''), field, value);
    await recordMetaWebhookActivity(businessId, wabaId, field);
    return;
  }
  for (const message of value.messages || []) {
    const metaGroupId = clean(message.group_id || message.context?.group_id || value.group_id);
    if (metaGroupId) {
      const at = new Date(Number(message.timestamp || Date.now() / 1000) * 1000);
      await ingestWorkspaceGroupMessage(businessId, metaGroupId, message, at);
      continue;
    }
    await ingestCatalogOrder(businessId, value.metadata?.phone_number_id, message);
    const at = new Date(Number(message.timestamp || Date.now() / 1000) * 1000);
    const input = webhookInputFromMessage(message);
    const incoming = await ingestIncoming(businessId, message.from, input, at, message.id || '', value.metadata?.phone_number_id || '');
    if (incoming.duplicate) continue;
    if (incoming.contactId) {
      pushOutboundCrmContact(businessId, incoming.contactId).catch(() => {});
    }
    if (!incoming.flowReply && !incoming.entryWorkflowQueued) await enqueueAutomationForIncoming({ businessId, ...incoming, input });
  }
  for (const statusUpdate of value.statuses || []) {
    if (statusUpdate.type === 'call') {
      await ingestCallingWebhook(businessId, { metadata: value.metadata, statuses: [statusUpdate] });
      continue;
    }
    if (statusUpdate.type === 'payment') {
      await ingestNativePaymentWebhook(businessId, value.metadata?.phone_number_id, statusUpdate);
      continue;
    }
    if (await updateWorkspaceGroupMessageStatus(businessId, statusUpdate)) continue;
    await updateDeliveryStatus(businessId, statusUpdate);
  }
  if (field === 'leadgen') {
    const pageId = String(value.page_id || value.from?.id || '');
    const connection = pageId
      ? (await query('SELECT business_id FROM whatsapp_ads_connections WHERE page_id=$1 LIMIT 1', [pageId])).rows[0]
      : null;
    const targetBusinessId = connection?.business_id || businessId;
    if (value.leadgen_id && value.form_id) {
      const { ingestMetaLeadgenSubmission } = await import('./meta-leadgen-ingest.js');
      await transaction(async (client) => {
        await ingestMetaLeadgenSubmission(client, targetBusinessId, {
          formId: value.form_id,
          leadId: value.leadgen_id,
          field_data: value.field_data || []
        });
      });
    }
    await recordMetaWebhookActivity(targetBusinessId, wabaId, field);
    return;
  }
  if (field === 'message_template_status_update') await updateTemplateStatus(businessId, wabaId, value);
  await applyMetaConfigurationEvent(businessId, wabaId, field, value);
  await query("INSERT INTO events (id, business_id, type, metadata) VALUES ($1, $2, 'meta_webhook', $3)", [id('e'), businessId, JSON.stringify({ field })]);
  await recordMetaWebhookActivity(businessId, wabaId, field);
}

function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = clean(process.env.META_APP_SECRET);
  const required = process.env.NODE_ENV === "production" || process.env.META_WEBHOOK_SIGNATURE_REQUIRED === "true" || Boolean(secret && !secret.startsWith("replace-with"));
  if (!required) return;
  if (!secret || secret.startsWith("replace-with")) throw new AppError("META_APP_SECRET is required for secure webhook verification.", 503, "META_APP_SECRET_REQUIRED");
  if (!signatureHeader || !String(signatureHeader).startsWith("sha256=")) throw new AppError("Invalid Meta webhook signature.", 401, "WEBHOOK_SIGNATURE_INVALID");

  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(String(signatureHeader), "utf8");
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new AppError("Invalid Meta webhook signature.", 401, "WEBHOOK_SIGNATURE_INVALID");
  }
}


async function findContact(businessId, contactId) {
  return (await query("SELECT * FROM contacts WHERE id = $1 AND business_id = $2", [contactId, businessId])).rows[0];
}

async function assertConversationOwnership(session, contactId) {
  const conversation = (await query(
    "SELECT assigned_user_id FROM conversations WHERE business_id = $1 AND contact_id = $2",
    [session.businessId, contactId]
  )).rows[0];
  const manager = ["Owner", "Manager"].includes(session.role);
  if (conversation?.assigned_user_id && conversation.assigned_user_id !== session.userId && !manager) {
    throw new AppError("This conversation is assigned to another agent.", 409, "CONVERSATION_ALREADY_ASSIGNED");
  }
}
async function findOrCreateConversation(businessId, contactId) {
  const existing = await query("SELECT id FROM conversations WHERE business_id = $1 AND contact_id = $2", [businessId, contactId]);
  if (existing.rows[0]) return existing.rows[0].id;
  const conversationId = id("v");
  await query("INSERT INTO conversations (id, business_id, contact_id) VALUES ($1, $2, $3)", [conversationId, businessId, contactId]);
  return conversationId;
}

async function ingestIncoming(businessId, phone, input, at, metaMessageId = "", sourcePhoneNumberId = "") {
  const cleanNumber = cleanPhone(phone);
  return transaction(async (client) => {
    let contact = (await client.query("SELECT * FROM contacts WHERE business_id = $1 AND phone = $2", [businessId, cleanNumber])).rows[0];
    if (!contact) {
      const contactId = id("c");
      await client.query(
        `INSERT INTO contacts (id, business_id, name, phone, source, opt_in_source)
         VALUES ($1, $2, $3, $4, 'Meta webhook', 'Customer initiated')
         ON CONFLICT (business_id, phone) DO NOTHING`,
        [contactId, businessId, cleanNumber, cleanNumber]
      );
      contact = (await client.query("SELECT * FROM contacts WHERE business_id = $1 AND phone = $2", [businessId, cleanNumber])).rows[0];
    }

    await client.query("UPDATE contacts SET last_message_at = $1, updated_at = NOW() WHERE id = $2 AND business_id = $3", [at, contact.id, businessId]);
    const conversation = await client.query(
      `INSERT INTO conversations (id, business_id, contact_id, status, unread_count, updated_at, version, whatsapp_phone_number_id, first_referral, first_referral_at)
       VALUES ($1, $2, $3, 'open', 0, NOW(), 0, $4, $5, CASE WHEN $5::jsonb IS NOT NULL THEN $6 ELSE NULL END)
       ON CONFLICT (business_id, contact_id) DO UPDATE SET contact_id = EXCLUDED.contact_id,
         whatsapp_phone_number_id = CASE WHEN EXCLUDED.whatsapp_phone_number_id <> '' THEN EXCLUDED.whatsapp_phone_number_id ELSE conversations.whatsapp_phone_number_id END,
         first_referral = COALESCE(conversations.first_referral, EXCLUDED.first_referral),
         first_referral_at = COALESCE(conversations.first_referral_at, EXCLUDED.first_referral_at)
       RETURNING id`,
      [id("v"), businessId, contact.id, clean(sourcePhoneNumberId), input.metadata?.referral ? JSON.stringify(input.metadata.referral) : null, at]
    );
    const replyToId = clean(input.metadata?.replyToMessageId);
    let attributedRecipient = null;
    if (replyToId) {
      attributedRecipient = (await client.query(
        `SELECT cr.id FROM campaign_recipients cr
         JOIN campaigns c ON c.id = cr.campaign_id
         JOIN messages m ON m.campaign_recipient_id = cr.id AND m.direction = 'outgoing'
         WHERE c.business_id = $1 AND cr.contact_id = $2 AND m.meta_message_id = $3
         LIMIT 1`,
        [businessId, contact.id, replyToId]
      )).rows[0];
    }
    if (!attributedRecipient) {
      attributedRecipient = (await client.query(
        `SELECT cr.id FROM campaign_recipients cr
         JOIN campaigns c ON c.id = cr.campaign_id
         WHERE c.business_id = $1 AND cr.contact_id = $2 AND cr.sent_at IS NOT NULL
           AND cr.sent_at <= $3 AND cr.sent_at >= $3 - INTERVAL '7 days'
         ORDER BY cr.sent_at DESC LIMIT 1`,
        [businessId, contact.id, at]
      )).rows[0];
    }
    const messageId = id("m");
    const inserted = await client.query(
      `INSERT INTO messages (id, conversation_id, direction, body, status, meta_message_id, at, message_type, media_id, mime_type, caption, metadata, campaign_recipient_id)
       VALUES ($1, $2, 'incoming', $3, 'received', $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [messageId, conversation.rows[0].id, input.text, metaMessageId, at, input.type, input.mediaId, input.mimeType, input.caption, JSON.stringify(input.metadata || {}), attributedRecipient?.id || null]
    );
    if (!inserted.rows[0]) return { duplicate: true };
    await enqueueAiAutoReply(client,{businessId,conversationId:conversation.rows[0].id,messageId,type:input.type,text:input.text,unsubscribed:contact.unsubscribed});
    await recordSupportInbound(client,businessId,conversation.rows[0].id,at);
    if (input.buttonId || input.type === 'interactive' || input.type === 'button') {
      const { recordInteractiveButtonAttribution } = await import('./interactive-button-attribution.js');
      await recordInteractiveButtonAttribution(client, {
        businessId,
        contactId: contact.id,
        messageId,
        campaignRecipientId: attributedRecipient?.id || null,
        buttonId: input.buttonId || input.value,
        title: input.title || input.text,
        kind: input.listId ? 'list_reply' : input.type === 'button' ? 'template_button' : 'button_reply',
        at
      });
    }
    await client.query(
      "UPDATE conversations SET status = 'open', unread_count = unread_count + 1, updated_at = NOW(), version = version + 1 WHERE id = $1 AND business_id = $2",
      [conversation.rows[0].id, businessId]
    );

    if (/^(stop|unsubscribe|opt out)$/i.test(String(input.text).trim())) {
      await client.query("UPDATE contacts SET marketing_permission = FALSE, unsubscribed = TRUE, updated_at = NOW() WHERE id = $1 AND business_id = $2", [contact.id, businessId]);
      await client.query(
        `UPDATE automation_jobs j
         SET status='failed', completed_at=NOW(), locked_at=NULL,
             error_message='Customer opted out of automated messages.', updated_at=NOW()
         FROM automation_sessions s
         WHERE j.session_id=s.id AND s.business_id=$1 AND s.contact_id=$2
           AND j.status IN ('queued','retry')`,
        [businessId, contact.id]
      );
      await client.query(
        `UPDATE automation_sessions SET status='completed',ended_at=NOW(),updated_at=NOW()
         WHERE business_id=$1 AND contact_id=$2 AND status='active'`,
        [businessId, contact.id]
      );
      await client.query("INSERT INTO events (id, business_id, type, contact_id) VALUES ($1, $2, 'unsubscribe', $3)", [id("e"), businessId, contact.id]);
    }
    const flowReply=input.flowReply?await applyFlowReply(client,{businessId,contactId:contact.id,phoneNumberId:sourcePhoneNumberId,messageId,reply:input.flowReply,at}):null;
    const entry=input.type==='text'?await applyEntryAttribution(client,{businessId,contactId:contact.id,phoneNumberId:sourcePhoneNumberId,messageId,text:input.text,at}):null;
    return { contactId: contact.id, conversationId: conversation.rows[0].id, messageId,flowReply:Boolean(input.metadata?.nativeFlowReply),entryWorkflowQueued:entry?.status==='queued' };
  });
}

function webhookInputFromMessage(message) {
  const interactive = message.interactive || {};
  const buttonReply = interactive.button_reply;
  const listReply = interactive.list_reply;
  const templateButton = message.button;
  const nativeFlowReply=interactive.type==='nfm_reply';
  const flowReply=nativeFlowReply?parseFlowReply(interactive.nfm_reply?.response_json):null;
  const type = clean(message.type) || "text";
  const media = ["image", "audio", "video", "document", "sticker"].includes(type) ? message[type] || {} : {};
  const caption = clean(media.caption);
  const fallback = type === "text" ? "" : `[${type.charAt(0).toUpperCase()}${type.slice(1)}]`;
  const text = message.text?.body || buttonReply?.title || listReply?.title || templateButton?.text || caption || fallback;
  const referral = normalizeWhatsAppReferral(message.referral);
  return {
    type,
    flowReply,
    text,
    value: buttonReply?.id || listReply?.id || templateButton?.payload || text,
    title: buttonReply?.title || listReply?.title || templateButton?.text || text,
    buttonId: buttonReply?.id || templateButton?.payload || "",
    listId: listReply?.id || "",
    mediaId: clean(media.id),
    mimeType: clean(media.mime_type),
    caption,
    metadata: { filename: clean(media.filename), sha256: clean(media.sha256), voice: Boolean(media.voice), ...(nativeFlowReply?{nativeFlowReply:true}:{}), ...(message.context?.id ? { replyToMessageId: clean(message.context.id).slice(0,512) } : {}), ...(referral ? { referral } : {}) }
  };
}

async function businessForWebhook(phoneNumberId, wabaId) {
  const matches = async (legacyColumn, table, assetColumn, assetId) => {
    if (!assetId) return [];
    const result = await query(
      `SELECT DISTINCT b.id FROM businesses b
       WHERE b.${legacyColumn}=$1 OR EXISTS
         (SELECT 1 FROM ${table} asset WHERE asset.business_id=b.id AND asset.${assetColumn}=$1)
       LIMIT 2`,
      [String(assetId)]
    );
    if (result.rows.length > 1) throw new AppError("WhatsApp asset is linked to multiple workspaces. Resolve ownership before processing webhooks.", 409, "WHATSAPP_ASSET_AMBIGUOUS");
    return result.rows;
  };
  const byPhone = await matches("phone_number_id", "whatsapp_phone_numbers", "phone_number_id", phoneNumberId);
  const byWaba = await matches("waba_id", "whatsapp_accounts", "waba_id", wabaId);
  if (byPhone.length && byWaba.length && byPhone[0].id !== byWaba[0].id) {
    throw new AppError("Webhook phone and WABA belong to different workspaces.", 409, "WHATSAPP_ASSET_MISMATCH");
  }
  const businessId = byPhone[0]?.id || byWaba[0]?.id;
  return businessId ? (await query("SELECT * FROM businesses WHERE id=$1", [businessId])).rows[0] || null : null;
}
async function updateTemplateStatus(businessId, wabaId, value) {
  const templateName = value.message_template_name || value.template_name || value.name;
  const templateId = value.message_template_id || value.template_id;
  const language = value.message_template_language || value.language;
  const status = normalizeTemplateStatus(value.event || value.status);
  if (!templateId && !(templateName && language)) return;
  await query(
    `UPDATE templates
     SET status = $1, rejection_reason = $2, content_revision = content_revision + 1, updated_at = NOW()
     WHERE business_id = $3 AND waba_id=$4
       AND (($5<>'' AND meta_template_id=$5) OR ($5='' AND meta_template_name=$6 AND language=$7))`,
    [status, clean(value.reason || value.rejection_reason), businessId, wabaId, String(templateId || ''), templateName || '', language || '']
  );
}
async function updateDeliveryStatus(businessId, statusUpdate) {
  const nextStatus = clean(statusUpdate.status).toLowerCase();
  if (!["sent", "delivered", "read", "failed"].includes(nextStatus)) return;
  const errorMessage = clean(statusUpdate.errors?.[0]?.message || statusUpdate.errors?.[0]?.title);
  const recipientStatus = `CASE
    WHEN $1 = 'failed' THEN CASE WHEN cr.status IN ('queued', 'sent') THEN 'failed' ELSE cr.status END
    WHEN CASE $1 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END >= CASE cr.status WHEN 'queued' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END THEN $1
    ELSE cr.status END`;
  const messageStatus = `CASE
    WHEN $1 = 'failed' THEN CASE WHEN m.status IN ('queued', 'sent') THEN 'failed' ELSE m.status END
    WHEN CASE $1 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END >= CASE m.status WHEN 'queued' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END THEN $1
    ELSE m.status END`;
  await query(
    `UPDATE campaign_recipients cr SET status = ${recipientStatus},
       error_message = CASE WHEN $1 = 'failed' AND $4 <> '' AND cr.status IN ('queued', 'sent') THEN $4 ELSE cr.error_message END, updated_at = NOW()
     FROM campaigns c WHERE cr.campaign_id = c.id AND c.business_id = $2 AND cr.meta_message_id = $3`,
    [nextStatus, businessId, statusUpdate.id, errorMessage]
  );
  await query(
    `UPDATE messages m SET status = ${messageStatus},
       metadata = CASE WHEN $1 = 'failed' AND $4 <> '' AND m.status IN ('queued', 'sent') THEN m.metadata || jsonb_build_object('deliveryError', $4) ELSE m.metadata END
     FROM conversations c WHERE m.conversation_id = c.id AND c.business_id = $2 AND m.meta_message_id = $3`,
    [nextStatus, businessId, statusUpdate.id, errorMessage]
  );
}
async function audit(session, action, metadata = {}) {
  await query("INSERT INTO audit_logs (id, business_id, user_id, action, metadata) VALUES ($1, $2, $3, $4, $5)", [id("a"), session.businessId, session.userId, action, JSON.stringify(metadata)]);
}










export { mapTemplate, campaignStats, templateVariables, renderTemplate } from './workspace-mappers.js';
export { runCampaignQueue, queueBatchSize } from './campaign-queue-runner.js';

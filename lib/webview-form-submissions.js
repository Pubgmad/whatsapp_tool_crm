import crypto from 'node:crypto';
import { AppError, enterSystemContext, errorJson, id, json, query, transaction } from './db.js';
import { readJsonBodyLimited, enforceRequestRateLimit } from './security.js';
import { workspaceFeatureFlags } from './feature-controls.js';
import { startManualAutomationSession } from './automation-orchestration.js';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function cleanField(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

export function normalizeFormSchema(schema) {
  if (!Array.isArray(schema)) return [];
  const keys = new Set();
  return schema.slice(0, 20).map((field, index) => {
    const key = cleanField(field.key || field.label, 40).toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+/, '');
    const label = cleanField(field.label, 80);
    const type = ['text', 'email', 'tel', 'textarea', 'number'].includes(field.type) ? field.type : 'text';
    if (!key || !label || keys.has(key)) throw new AppError('Each form field needs a unique key and label.', 400, 'WEBVIEW_FORM_INVALID');
    keys.add(key);
    return { key, label, type, required: field.required === true, order: index };
  });
}

export async function submitWebviewForm(request, context) {
  try {
    enterSystemContext();
    const viewId = (await context.params).viewId;
    if (!/^wv_[a-f0-9]{16}$/.test(viewId || '')) throw new AppError('Page not found.', 404, 'NOT_FOUND');
    await enforceRequestRateLimit(request, hash(`webview-form:${viewId}`), 'api');
    const body = await readJsonBodyLimited(request, 32768);
    const view = (await query(
      `SELECT v.*, b.account_status
       FROM whatsapp_webviews v
       JOIN businesses b ON b.id = v.business_id
       WHERE v.id = $1 AND v.enabled AND v.page_mode = 'form'`,
      [viewId]
    )).rows[0];
    if (!view || view.account_status === 'suspended') throw new AppError('Page unavailable.', 404, 'NOT_FOUND');
    if (!(await workspaceFeatureFlags(view.business_id)).webviews) throw new AppError('Page unavailable.', 404, 'NOT_FOUND');

    const schema = Array.isArray(view.form_schema) ? view.form_schema : [];
    if (!schema.length) throw new AppError('This page is not accepting form submissions.', 409, 'WEBVIEW_FORM_DISABLED');
    const payload = {};
    for (const field of schema) {
      const raw = body.fields?.[field.key];
      const value = cleanField(raw, field.type === 'textarea' ? 4000 : 500);
      if (field.required && !value) throw new AppError(`${field.label} is required.`, 400, 'WEBVIEW_FORM_INVALID');
      if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw new AppError(`${field.label} must be a valid email.`, 400, 'WEBVIEW_FORM_INVALID');
      }
      if (value) payload[field.key] = field.type === 'number' ? Number(value) : value;
    }
    const fingerprint = hash(JSON.stringify([viewId, payload, String(body.phone || '').replace(/\D/g, '')]));
    const phone = String(body.phone || '').replace(/\D/g, '');
    const result = await transaction(async (client) => {
      let contactId = null;
      if (/^\d{8,20}$/.test(phone)) {
        const existing = (await client.query(
          'SELECT id FROM contacts WHERE business_id=$1 AND phone=$2 FOR UPDATE',
          [view.business_id, phone]
        )).rows[0];
        if (existing) {
          contactId = existing.id;
          const attributes = { ...(await client.query('SELECT custom_attributes FROM contacts WHERE id=$1', [contactId])).rows[0]?.custom_attributes || {}, ...payload };
          await client.query(
            `UPDATE contacts SET custom_attributes=$1::jsonb, updated_at=NOW()
             WHERE id=$2 AND business_id=$3 AND octet_length($1::text) <= 65536`,
            [JSON.stringify(attributes), contactId, view.business_id]
          );
        } else {
          contactId = id('c');
          await client.query(
            `INSERT INTO contacts (id,business_id,name,phone,source,custom_attributes,marketing_permission,unsubscribed)
             VALUES ($1,$2,$3,$4,'Hosted form',$5::jsonb,FALSE,FALSE)`,
            [contactId, view.business_id, cleanField(payload.name || payload.full_name || phone, 160), phone, JSON.stringify(payload)]
          );
        }
      }
      const inserted = await client.query(
        `INSERT INTO whatsapp_webview_submissions (id,business_id,webview_id,contact_id,fingerprint,payload,status)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,'received')
         ON CONFLICT (business_id, webview_id, fingerprint) DO NOTHING
         RETURNING id`,
        [id('wvs'), view.business_id, viewId, contactId, fingerprint, JSON.stringify(payload)]
      );
      if (!inserted.rows[0]) {
        return { ok: true, duplicate: true, message: view.success_message };
      }
      let sessionId = null;
      if (contactId && view.automation_flow_id) {
        try {
          const started = await startManualAutomationSession(client, {
            businessId: view.business_id,
            contactId,
            flowId: view.automation_flow_id,
            context: { webviewId: viewId, webviewSubmissionId: inserted.rows[0].id, form: payload },
            messageId: `webview:${inserted.rows[0].id}`
          });
          sessionId = started.sessionId;
          await client.query(
            `UPDATE whatsapp_webview_submissions
             SET automation_session_id=$1, status='queued'
             WHERE id=$2 AND business_id=$3`,
            [sessionId, inserted.rows[0].id, view.business_id]
          );
        } catch (error) {
          await client.query(
            `UPDATE whatsapp_webview_submissions SET status='failed' WHERE id=$1 AND business_id=$2`,
            [inserted.rows[0].id, view.business_id]
          );
          if (!['AUTOMATION_ACTIVE', 'AUTOMATION_FLOW_NOT_FOUND'].includes(error.code)) throw error;
        }
      }
      await client.query(
        `INSERT INTO events (id,business_id,type,contact_id,metadata)
         VALUES ($1,$2,'webview_form_submitted',$3,$4::jsonb)`,
        [id('e'), view.business_id, contactId, JSON.stringify({ webviewId: viewId, submissionId: inserted.rows[0].id, sessionId })]
      );
      return { ok: true, duplicate: false, message: view.success_message, sessionId };
    });
    return json(result, 201);
  } catch (error) {
    return errorJson(error);
  }
}

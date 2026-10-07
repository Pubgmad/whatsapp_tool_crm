import { requireSession } from './auth.js';
import { AppError, errorJson, id, json, query } from './db.js';
import { decryptSecret } from './meta.js';
import { readJsonBodyLimited } from './security.js';
import { assertWorkspaceFeature } from './feature-controls.js';
import { requireWorkspaceManager } from './workspace-permissions.js';

const graphVersion = () => process.env.META_GRAPH_API_VERSION || 'v26.0';

function clean(value) {
  return String(value || '').trim();
}

async function graphGet(token, path) {
  const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(20000)
  });
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new AppError('Meta groups response was not JSON.', 502, 'GROUPS_META_ERROR');
  }
  if (!response.ok) {
    const code = result?.error?.code;
    const message = result?.error?.message || 'Meta groups request failed.';
    if (code === 100 || response.status === 404) {
      throw new AppError(message, 409, 'GROUPS_NOT_AVAILABLE');
    }
    throw new AppError(message, response.status >= 500 ? 502 : 400, 'GROUPS_META_ERROR');
  }
  return result;
}

async function defaultPhone(businessId) {
  const row = (
    await query(
      `SELECT p.phone_number_id, a.access_token_encrypted
       FROM whatsapp_phone_numbers p
       JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id
       WHERE p.business_id=$1 AND p.is_default=TRUE AND p.registration_state='registered' AND a.status='connected'
       LIMIT 1`,
      [businessId]
    )
  ).rows[0];
  if (!row) throw new AppError('Connect and register a default WhatsApp number first.', 409, 'GROUPS_PHONE_REQUIRED');
  return { phoneNumberId: row.phone_number_id, token: decryptSecret(row.access_token_encrypted) };
}

export async function syncWhatsAppGroupsFromMeta(businessId, phoneNumberId, token) {
  const path = `${phoneNumberId}/groups?limit=50`;
  const result = await graphGet(token, path);
  const items = Array.isArray(result.data) ? result.data : [];
  for (const group of items) {
    const metaId = clean(group.id);
    if (!metaId) continue;
    const rowId = id('wg');
    await query(
      `INSERT INTO whatsapp_groups(id,business_id,phone_number_id,meta_group_id,subject,participant_count,invite_link,sync_status,last_error,meta_snapshot,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,'synced','',$8::jsonb,NOW())
       ON CONFLICT (business_id, meta_group_id) DO UPDATE SET
         subject=EXCLUDED.subject,
         participant_count=EXCLUDED.participant_count,
         invite_link=EXCLUDED.invite_link,
         sync_status='synced',
         last_error='',
         meta_snapshot=EXCLUDED.meta_snapshot,
         updated_at=NOW()`,
      [
        rowId,
        businessId,
        phoneNumberId,
        metaId,
        clean(group.subject || group.name).slice(0, 200),
        Number(group.participant_count || group.participants?.length || 0) || 0,
        clean(group.invite_link).slice(0, 500),
        JSON.stringify(group)
      ]
    );
  }
  return { synced: items.length };
}

export async function listWhatsAppGroups(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    await assertWorkspaceFeature('whatsapp_groups', session.businessId);
    const rows = (
      await query(
        `SELECT id,phone_number_id,meta_group_id,subject,participant_count,invite_link,sync_status,last_error,updated_at
         FROM whatsapp_groups WHERE business_id=$1 ORDER BY updated_at DESC LIMIT 100`,
        [session.businessId]
      )
    ).rows;
    const capability = (
      await query(
        `SELECT COALESCE(a.capabilities->'groups_messaging'->>'status','UNKNOWN') AS status
         FROM whatsapp_accounts a
         JOIN whatsapp_phone_numbers p ON p.whatsapp_account_id=a.id AND p.business_id=a.business_id
         WHERE a.business_id=$1 AND p.is_default=TRUE LIMIT 1`,
        [session.businessId]
      )
    ).rows[0];
    return json({
      groups: rows,
      metaCapability: capability?.status || 'UNKNOWN',
      operatorNote:
        'Group messaging is a Meta Cloud API product. Sync pulls groups for your default number; 1:1 inbox remains the primary CRM surface.'
    });
  } catch (error) {
    return errorJson(error);
  }
}

export async function mutateWhatsAppGroups(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    await assertWorkspaceFeature('whatsapp_groups', session.businessId);
    const body = await readJsonBodyLimited(request, 8000);
    const phone = await defaultPhone(session.businessId);
    const phoneNumberId = clean(body.phoneNumberId) || phone.phoneNumberId;
    if (body.action === 'sync') {
      try {
        const result = await syncWhatsAppGroupsFromMeta(session.businessId, phoneNumberId, phone.token);
        await query(
          'INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',
          [id('a'), session.businessId, session.userId, 'whatsapp_groups_synced', JSON.stringify(result)]
        );
        return json({ ok: true, ...result });
      } catch (error) {
        if (error.code === 'GROUPS_NOT_AVAILABLE') {
          await query(
            `UPDATE whatsapp_groups SET sync_status='error', last_error=$1, updated_at=NOW() WHERE business_id=$2`,
            [error.message.slice(0, 500), session.businessId]
          );
        }
        throw error;
      }
    }
    if (body.action === 'send') {
      const groupId = clean(body.groupId);
      const text = clean(body.text);
      if (!groupId || !text || text.length > 4096) {
        throw new AppError('Provide a group and message up to 4096 characters.', 400, 'VALIDATION_ERROR');
      }
      const owned = (
        await query('SELECT 1 FROM whatsapp_groups WHERE business_id=$1 AND meta_group_id=$2', [
          session.businessId,
          groupId
        ])
      ).rowCount;
      if (!owned) throw new AppError('Group not found in this workspace.', 404, 'NOT_FOUND');
      const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${phone.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: groupId, type: 'text', text: { body: text } }),
        signal: AbortSignal.timeout(20000)
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new AppError(payload?.error?.message || 'Meta did not accept the group message.', 409, 'GROUPS_SEND_FAILED');
      }
      await query(
        'INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',
        [
          id('a'),
          session.businessId,
          session.userId,
          'whatsapp_group_message_sent',
          JSON.stringify({ groupId, messageId: payload.messages?.[0]?.id })
        ]
      );
      return json({ ok: true, messageId: payload.messages?.[0]?.id });
    }
    throw new AppError('Unknown action.', 400, 'VALIDATION_ERROR');
  } catch (error) {
    return errorJson(error);
  }
}

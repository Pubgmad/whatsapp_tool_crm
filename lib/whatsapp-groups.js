import { requireSession } from './auth.js';
import { AppError, errorJson, id, json, query } from './db.js';
import { decryptSecret } from './meta.js';
import { readJsonBodyLimited } from './security.js';
import { assertWorkspaceFeature } from './feature-controls.js';
import { requireWorkspaceManager } from './workspace-permissions.js';
import { groupsEntitlement } from './workspace-groups-inbox.js';
import { metaGraphApiVersion } from './operational-policy.js';

const graphVersion = () => metaGraphApiVersion();

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

async function phoneWithLiveToken(businessId, phoneNumberId = '') {
  const wanted = clean(phoneNumberId);
  const row = (
    await query(
      `SELECT p.phone_number_id, a.access_token_encrypted
       FROM whatsapp_phone_numbers p
       JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id
       WHERE p.business_id=$1 AND a.status='connected' AND COALESCE(a.access_token_encrypted,'')<>''
         AND ($2 = '' OR p.phone_number_id = $2)
       ORDER BY CASE WHEN $2 <> '' AND p.phone_number_id = $2 THEN 0
                     WHEN p.registration_state='registered' THEN 1 ELSE 2 END,
                p.is_default DESC, p.created_at
       LIMIT 1`,
      [businessId, wanted]
    )
  ).rows[0];
  if (wanted && (!row || row.phone_number_id !== wanted)) {
    throw new AppError('The selected WhatsApp number is no longer connected.', 409, 'GROUPS_PHONE_DISCONNECTED');
  }
  if (!row) throw new AppError('Connect a WhatsApp number first.', 409, 'GROUPS_PHONE_REQUIRED');
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
         WHERE a.business_id=$1 AND a.status='connected' AND COALESCE(a.access_token_encrypted,'')<>''
         ORDER BY p.is_default DESC, p.created_at LIMIT 1`,
        [session.businessId]
      )
    ).rows[0];
    return json({
      groups: rows,
      metaCapability: capability?.status || 'UNKNOWN',
      operatorNote: 'Sync groups for your connected WhatsApp number.'
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
    if (body.action === 'sync') {
      const phone = await phoneWithLiveToken(session.businessId, clean(body.phoneNumberId));
      try {
        const result = await syncWhatsAppGroupsFromMeta(session.businessId, phone.phoneNumberId, phone.token);
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
      const group = (
        await query(
          'SELECT meta_group_id, phone_number_id FROM whatsapp_groups WHERE business_id=$1 AND meta_group_id=$2 LIMIT 1',
          [session.businessId, groupId]
        )
      ).rows[0];
      if (!group) throw new AppError('Group not found in this workspace.', 404, 'NOT_FOUND');
      // Send only as the phone that owns this group — never borrow another number's token.
      const phone = await phoneWithLiveToken(session.businessId, group.phone_number_id || '');
      const capability = (await query(
        `SELECT COALESCE(a.capabilities->'groups_messaging'->>'status','UNKNOWN') AS status
         FROM whatsapp_accounts a JOIN whatsapp_phone_numbers p
           ON p.whatsapp_account_id=a.id AND p.business_id=a.business_id
         WHERE a.business_id=$1 AND p.phone_number_id=$2 AND a.status='connected'
           AND COALESCE(a.access_token_encrypted,'')<>''
         LIMIT 1`,
        [session.businessId, phone.phoneNumberId]
      )).rows[0]?.status;
      if (!groupsEntitlement(capability).entitled) {
        throw new AppError('Meta has not granted Groups messaging to this WhatsApp account.', 403, 'GROUPS_NOT_ENTITLED');
      }
      const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${phone.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${phone.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'group', to: groupId, type: 'text', text: { body: text } }),
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
          JSON.stringify({ groupId, messageId: payload.messages?.[0]?.id, phoneNumberId: phone.phoneNumberId })
        ]
      );
      return json({ ok: true, messageId: payload.messages?.[0]?.id });
    }
    throw new AppError('Unknown action.', 400, 'VALIDATION_ERROR');
  } catch (error) {
    return errorJson(error);
  }
}

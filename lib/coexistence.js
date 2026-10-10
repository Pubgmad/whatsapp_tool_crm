import { AppError, id, query, transaction } from './db.js';
import {recordSupportResponse} from './support-policy.js';
import { decryptSecret } from './meta.js';
import { parseCoexistenceContacts, parseCoexistenceEchoes, parseCoexistenceHistory } from './coexistence-payload.js';

const syncTypes = { contacts: 'smb_app_state_sync', history: 'history' };

export function coexistenceFailureState(error) {
  const status=Number(error?.status);
  return status>=400&&status<500&&![408,409].includes(status)?'failed':'unconfirmed';
}

export async function coexistenceStatusForBusiness(businessId) {
  await query(`UPDATE whatsapp_coexistence_sync SET
    contacts_status=CASE WHEN contacts_status='requesting' AND COALESCE(contacts_claimed_at,updated_at)<NOW()-INTERVAL '2 minutes' THEN 'unconfirmed' ELSE contacts_status END,
    history_status=CASE WHEN history_status='requesting' AND COALESCE(history_claimed_at,updated_at)<NOW()-INTERVAL '2 minutes' THEN 'unconfirmed' ELSE history_status END
    WHERE business_id=$1 AND (contacts_status='requesting' OR history_status='requesting')`,[businessId]);
  const rows=(await query(`SELECT p.id,p.phone_number_id,p.display_phone_number,s.contacts_status,s.history_status,
    s.contacts_imported,s.messages_imported,s.echoes_imported,s.last_error,s.last_event_at,
    s.contacts_requested_at,s.history_requested_at,s.contacts_request_id,s.history_request_id
    FROM whatsapp_coexistence_sync s JOIN whatsapp_phone_numbers p ON p.id=s.phone_id AND p.business_id=s.business_id
    WHERE s.business_id=$1 ORDER BY p.created_at`,[businessId])).rows;
  return rows.map(row=>({id:row.id,phoneNumberId:row.phone_number_id,displayPhoneNumber:row.display_phone_number,
    coexistence:{contactsStatus:row.contacts_status,historyStatus:row.history_status,contactsImported:row.contacts_imported,
      messagesImported:row.messages_imported,echoesImported:row.echoes_imported,lastError:row.last_error,lastEventAt:row.last_event_at,
      contactsRequestedAt:row.contacts_requested_at,historyRequestedAt:row.history_requested_at,
      contactsRequestId:row.contacts_request_id,historyRequestId:row.history_request_id}}));
}

async function syncPhone(businessId, phoneNumberId) {
  const result = await query(
    `SELECT p.id, p.onboarding_method, a.access_token_encrypted, s.*
     FROM whatsapp_phone_numbers p
     JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id
     JOIN whatsapp_coexistence_sync s ON s.phone_id=p.id AND s.business_id=p.business_id
     WHERE p.business_id=$1 AND p.phone_number_id=$2`,
    [businessId, phoneNumberId]
  );
  return result.rows[0];
}

export async function requestCoexistenceSync(businessId, phoneNumberId, kind) {
  if (!Object.hasOwn(syncTypes, kind)) throw new AppError('Unsupported sync type.', 400, 'INVALID_SYNC_TYPE');
  const phone = await syncPhone(businessId, phoneNumberId);
  if (!phone || phone.onboarding_method !== 'coexistence') throw new AppError('This number was not connected using Business App coexistence.', 409, 'COEXISTENCE_REQUIRED');
  if (!phone.access_token_encrypted) throw new AppError('Reconnect WhatsApp before requesting sync.', 409, 'META_TOKEN_MISSING');
  if (phone[`${kind}_status`] === 'unconfirmed') throw new AppError('The earlier sync request is unconfirmed. Check Meta or reconnect before requesting again.',409,'COEXISTENCE_SYNC_UNCONFIRMED');
  if (phone[`${kind}_requested_at`] || ['receiving','complete','declined'].includes(phone[`${kind}_status`])) return { status: phone[`${kind}_status`], requestId: phone[`${kind}_request_id`] };
  if (!phone.onboarding_at || Date.now() - new Date(phone.onboarding_at).getTime() > 86400000) {
    throw new AppError('Meta initial sync window has passed. Reconnect this number.', 409, 'COEXISTENCE_SYNC_WINDOW_CLOSED');
  }
  const claimed = await query(
    `UPDATE whatsapp_coexistence_sync SET ${kind}_status='requesting', ${kind}_claimed_at=NOW(), updated_at=NOW()
     WHERE phone_id=$1 AND business_id=$2 AND ${kind}_requested_at IS NULL AND ${kind}_status IN ('failed','not_requested')
     RETURNING phone_id`, [phone.id, businessId]
  );
  if (!claimed.rows[0]) return { status: 'requesting' };
  try {
    const version = process.env.META_GRAPH_API_VERSION || 'v26.0';
    const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/smb_app_data`, {
      method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${decryptSecret(phone.access_token_encrypted)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', sync_type: syncTypes[kind] })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new AppError(payload.error?.message || 'Meta declined the sync request.', response.status, 'COEXISTENCE_SYNC_FAILED');
    const requestId = String(payload.request_id || payload.data?.request_id || '');
    await query(
      `UPDATE whatsapp_coexistence_sync SET ${kind}_requested_at=NOW(), ${kind}_request_id=$1,
       ${kind}_status=CASE WHEN ${kind}_status IN ('receiving','declined','complete') THEN ${kind}_status ELSE 'requested' END,
       last_error='', updated_at=NOW() WHERE phone_id=$2 AND business_id=$3`,
      [requestId, phone.id, businessId]
    );
    return { status: 'requested', requestId };
  } catch (error) {
    const failureState=coexistenceFailureState(error);
    await query(`UPDATE whatsapp_coexistence_sync SET ${kind}_status=$1, last_error=$2,
      updated_at=NOW() WHERE phone_id=$3 AND business_id=$4 AND ${kind}_status='requesting'`,
      [failureState,String(error.message || 'Sync request failed.').slice(0, 500), phone.id, businessId]);
    throw error;
  }
}

async function upsertContact(client, businessId, phone, name) {
  const result = await client.query(
    `INSERT INTO contacts (id,business_id,name,phone,source,opt_in_source,marketing_permission)
     VALUES ($1,$2,$3,$4,'WhatsApp Business App','Business App sync',FALSE)
     ON CONFLICT (business_id,phone) DO UPDATE SET
       name=CASE WHEN contacts.source='WhatsApp Business App' AND EXCLUDED.name <> EXCLUDED.phone
         THEN EXCLUDED.name ELSE contacts.name END, updated_at=NOW()
     RETURNING id,(xmax = 0) AS inserted`,
    [id('c'), businessId, name || phone, phone]
  );
  return result.rows[0];
}

async function conversationFor(client, businessId, phoneId, phone) {
  const contact = await upsertContact(client, businessId, phone, phone);
  const result = await client.query(
    `INSERT INTO conversations (id,business_id,contact_id,whatsapp_phone_number_id)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (business_id,contact_id) DO UPDATE SET
       whatsapp_phone_number_id=CASE WHEN conversations.whatsapp_phone_number_id=''
         THEN EXCLUDED.whatsapp_phone_number_id ELSE conversations.whatsapp_phone_number_id END
     RETURNING id,whatsapp_phone_number_id`, [id('v'), businessId, contact.id, phoneId]
  );
  if (result.rows[0].whatsapp_phone_number_id !== phoneId) {
    throw new AppError('This contact already has a conversation on another WhatsApp number. Sync cannot merge their histories.', 409, 'COEXISTENCE_NUMBER_CONFLICT');
  }
  return { contactId: contact.id, conversationId: result.rows[0].id };
}

export async function ingestCoexistenceWebhook(businessId, phoneNumberId, field, value) {
  const phone = await syncPhone(businessId, phoneNumberId);
  if (!phone || phone.onboarding_method !== 'coexistence') return;
  if (field === 'smb_app_state_sync') {
    const contacts = parseCoexistenceContacts(value);
    await transaction(async (client) => {
      let imported = 0;
      for (const contact of contacts) {
        const row = await upsertContact(client, businessId, contact.phone, contact.name);
        if (row.inserted) imported++;
      }
      const current = (await client.query(
        'SELECT contacts_status FROM whatsapp_coexistence_sync WHERE phone_id=$1 AND business_id=$2 FOR UPDATE',
        [phone.id, businessId]
      )).rows[0]?.contacts_status;
      // Empty terminal sync after we have already been receiving ⇒ Meta finished contact transfer.
      const nextStatus = contacts.length
        ? 'receiving'
        : ['receiving', 'requested'].includes(current)
          ? 'complete'
          : (current || 'receiving');
      await client.query(
        `UPDATE whatsapp_coexistence_sync SET contacts_status=$1, contacts_imported=contacts_imported+$2,
         last_event_at=NOW(), updated_at=NOW() WHERE phone_id=$3 AND business_id=$4`,
        [nextStatus, imported, phone.id, businessId]
      );
    });
    return;
  }
  const history = field === 'history' ? parseCoexistenceHistory(value) : null;
  const messages = history ? history.messages : field === 'smb_message_echoes' ? parseCoexistenceEchoes(value) : [];
  await transaction(async (client) => {
    let imported = 0;
    for (const message of messages) {
      const conversation = await conversationFor(client, businessId, phoneNumberId, message.phone);
      const source = history ? 'coexistence_history' : 'coexistence_echo';
      const inserted = await client.query(
        `INSERT INTO messages (id,conversation_id,direction,body,status,meta_message_id,at,message_type,media_id,mime_type,caption,metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT DO NOTHING RETURNING id`,
        [id('m'), conversation.conversationId, history ? message.direction : 'outgoing', message.body,
          history ? 'imported' : 'sent', message.metaMessageId, message.at, message.type,
          message.mediaId, message.mimeType, message.caption, JSON.stringify({ source })]
      );
      if (!inserted.rows[0]) continue;
      imported++;
      if (!history) {
        await recordSupportResponse(businessId,conversation.conversationId,message.at,client);
        await client.query(
          `UPDATE conversations SET automation_paused=TRUE, updated_at=NOW(), version=version+1
           WHERE id=$1 AND business_id=$2`, [conversation.conversationId, businessId]
        );
        await client.query(
          `UPDATE automation_sessions SET status='handoff', human_takeover=TRUE, ended_at=NOW(), updated_at=NOW()
           WHERE business_id=$1 AND contact_id=$2 AND status='active'`, [businessId, conversation.contactId]
        );
      }
    }
    if (history) {
      const historyStatus = history.declined ? 'declined' : history.complete ? 'complete' : 'receiving';
      await client.query(
        `UPDATE whatsapp_coexistence_sync SET history_status=$1, messages_imported=messages_imported+$2,
         last_event_at=NOW(), updated_at=NOW() WHERE phone_id=$3 AND business_id=$4`,
        [historyStatus, imported, phone.id, businessId]
      );
    } else {
      await client.query(
        `UPDATE whatsapp_coexistence_sync SET echoes_imported=echoes_imported+$1,
         last_event_at=NOW(), updated_at=NOW() WHERE phone_id=$2 AND business_id=$3`,
        [imported, phone.id, businessId]
      );
    }
  });
}

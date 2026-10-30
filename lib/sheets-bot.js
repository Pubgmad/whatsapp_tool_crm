import crypto from 'crypto';
import { requireSession } from './auth.js';
import { AppError, errorJson, id, json, query, transaction } from './db.js';
import { assertWorkspaceFeature, workspaceFeatureFlags } from './feature-controls.js';
import { decryptSecret, encryptSecret, metaReady, sendTextMessage } from './meta.js';
import { readJsonBodyLimited } from './security.js';
import { requireWorkspaceManager } from './workspace-permissions.js';
const SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'openid',
  'email'
].join(' ');

export function googleSheetsConfigured() {
  return Boolean(
    (process.env.GOOGLE_SHEETS_CLIENT_ID || process.env.GOOGLE_LOGIN_CLIENT_ID || '').trim()
    && (process.env.GOOGLE_SHEETS_CLIENT_SECRET || process.env.GOOGLE_LOGIN_CLIENT_SECRET || '').trim()
    && process.env.APP_URL?.trim()
  );
}

function sheetsClient() {
  return {
    clientId: String(process.env.GOOGLE_SHEETS_CLIENT_ID || process.env.GOOGLE_LOGIN_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.GOOGLE_SHEETS_CLIENT_SECRET || process.env.GOOGLE_LOGIN_CLIENT_SECRET || '').trim(),
    redirectUri: `${String(process.env.APP_URL || '').replace(/\/$/, '')}/api/integrations/google-sheets/callback`
  };
}

function normalize(text = '') {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function platformSchemas() {
  const row = (await query("SELECT value FROM platform_settings WHERE key='smb_sheets_schemas'")).rows[0];
  return Array.isArray(row?.value) ? row.value : [];
}

export async function sheetsBotStatus(request) {
  try {
    const session = await requireSession(request);
    await assertWorkspaceFeature('sheets_bot', session.businessId);
    const connection = (await query('SELECT id, google_account_email, status, token_expires_at, last_error, updated_at FROM sheets_bot_connections WHERE business_id=$1', [session.businessId])).rows[0] || null;
    const bots = (await query('SELECT id, name, schema_id, spreadsheet_title, sheet_name, status, sync_mode, last_synced_at, last_sync_status, last_sync_error, sync_version, row_count, fallback_text, match_mode, column_map, created_at, updated_at FROM sheets_bots WHERE business_id=$1 ORDER BY updated_at DESC LIMIT 50', [session.businessId])).rows;
    return json({
      configured: googleSheetsConfigured(),
      connection,
      bots,
      schemas: await platformSchemas()
    });
  } catch (error) {
    return errorJson(error);
  }
}

export async function startSheetsOAuth(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    await assertWorkspaceFeature('sheets_bot', session.businessId);
    if (!googleSheetsConfigured()) throw new AppError('Google Sheets is not configured on this platform yet. Ask your platform admin to set GOOGLE_SHEETS_CLIENT_ID and GOOGLE_SHEETS_CLIENT_SECRET.', 503, 'SHEETS_NOT_CONFIGURED');
    const { clientId, redirectUri } = sheetsClient();
    const state = crypto.randomBytes(24).toString('hex');
    const stateHash = crypto.createHash('sha256').update(state).digest('hex');
    await query(
      `INSERT INTO sheets_bot_connections (id, business_id, status, last_error)
       VALUES ($1,$2,'disconnected',$3)
       ON CONFLICT (business_id) DO UPDATE SET last_error=$3, updated_at=NOW()`,
      [id('sbc'), session.businessId, `oauth_pending:${stateHash}`]
    );
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SHEETS_SCOPES);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', `${session.businessId}.${state}`);
    return json({ url: url.toString() });
  } catch (error) {
    return errorJson(error);
  }
}

export async function completeSheetsOAuth(request, url) {
  const params = url.searchParams;
  const code = params.get('code');
  const stateRaw = String(params.get('state') || '');
  const [businessId, state] = stateRaw.split('.');
  if (!code || !businessId || !state) throw new AppError('Invalid Google Sheets OAuth callback.', 400, 'OAUTH_INVALID');
  const stateHash = crypto.createHash('sha256').update(state).digest('hex');
  const connection = (await query('SELECT * FROM sheets_bot_connections WHERE business_id=$1', [businessId])).rows[0];
  if (!connection || !String(connection.last_error || '').includes(stateHash)) {
    throw new AppError('OAuth state mismatch. Start Connect Google again.', 400, 'OAUTH_STATE');
  }
  const { clientId, clientSecret, redirectUri } = sheetsClient();
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    throw new AppError(tokenPayload.error_description || 'Google token exchange failed.', 502, 'SHEETS_TOKEN_FAILED');
  }
  let email = '';
  try {
    const profile = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { authorization: `Bearer ${tokenPayload.access_token}` }
    }).then((response) => response.json());
    email = String(profile.email || '');
  } catch {
    email = '';
  }
  const expiresAt = tokenPayload.expires_in
    ? new Date(Date.now() + Number(tokenPayload.expires_in) * 1000).toISOString()
    : null;
  await query(
    `UPDATE sheets_bot_connections SET google_account_email=$2, access_token_encrypted=$3, refresh_token_encrypted=CASE WHEN $4<>'' THEN $4 ELSE refresh_token_encrypted END,
     token_expires_at=$5, scopes=$6, status='connected', last_error='', updated_at=NOW() WHERE business_id=$1`,
    [
      businessId,
      email,
      encryptSecret(tokenPayload.access_token),
      tokenPayload.refresh_token ? encryptSecret(tokenPayload.refresh_token) : '',
      expiresAt,
      String(tokenPayload.scope || SHEETS_SCOPES)
    ]
  );
  return businessId;
}

async function accessTokenForBusiness(businessId) {
  const connection = (await query('SELECT * FROM sheets_bot_connections WHERE business_id=$1', [businessId])).rows[0];
  if (!connection || connection.status !== 'connected') throw new AppError('Connect Google Sheets first.', 409, 'SHEETS_NOT_CONNECTED');
  let accessToken = decryptSecret(connection.access_token_encrypted);
  const expiresSoon = connection.token_expires_at && new Date(connection.token_expires_at).getTime() < Date.now() + 60_000;
  if (expiresSoon && connection.refresh_token_encrypted) {
    const { clientId, clientSecret } = sheetsClient();
    const refreshed = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: decryptSecret(connection.refresh_token_encrypted),
        grant_type: 'refresh_token'
      })
    }).then((response) => response.json());
    if (refreshed.access_token) {
      accessToken = refreshed.access_token;
      await query(
        `UPDATE sheets_bot_connections SET access_token_encrypted=$2, token_expires_at=$3, status='connected', last_error='', updated_at=NOW() WHERE business_id=$1`,
        [businessId, encryptSecret(accessToken), refreshed.expires_in ? new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString() : null]
      );
    }
  }
  return accessToken;
}

export async function manageSheetsBot(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    await assertWorkspaceFeature('sheets_bot', session.businessId);
    const body = await readJsonBodyLimited(request, 65536);
    const action = String(body.action || '');

    if (action === 'listSpreadsheets') {
      const token = await accessTokenForBusiness(session.businessId);
      const drive = await fetch('https://www.googleapis.com/drive/v3/files?q=mimeType%3D%27application%2Fvnd.google-apps.spreadsheet%27&pageSize=50&fields=files(id,name)', {
        headers: { authorization: `Bearer ${token}` }
      }).then((response) => response.json());
      if (drive.error) throw new AppError(drive.error.message || 'Could not list spreadsheets.', 502, 'SHEETS_LIST_FAILED');
      return json({ files: drive.files || [] });
    }

    if (action === 'listSheets') {
      const token = await accessTokenForBusiness(session.businessId);
      const spreadsheetId = String(body.spreadsheetId || '').trim();
      if (!spreadsheetId) throw new AppError('Select a spreadsheet.', 400, 'VALIDATION_ERROR');
      const meta = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`, {
        headers: { authorization: `Bearer ${token}` }
      }).then((response) => response.json());
      if (meta.error) throw new AppError(meta.error.message || 'Could not read spreadsheet.', 502, 'SHEETS_META_FAILED');
      return json({
        title: meta.properties?.title || '',
        sheets: (meta.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean)
      });
    }

    if (action === 'save') {
      const connection = (await query('SELECT id FROM sheets_bot_connections WHERE business_id=$1 AND status=$2', [session.businessId, 'connected'])).rows[0];
      if (!connection) throw new AppError('Connect Google Sheets first.', 409, 'SHEETS_NOT_CONNECTED');
      const name = String(body.name || 'Sheets bot').trim().slice(0, 120);
      const spreadsheetId = String(body.spreadsheetId || '').trim();
      const sheetName = String(body.sheetName || '').trim();
      const columnMap = body.columnMap && typeof body.columnMap === 'object' ? body.columnMap : {};
      if (!spreadsheetId || !sheetName) throw new AppError('Choose a spreadsheet and worksheet.', 400, 'VALIDATION_ERROR');
      if (body.botId) {
        await query(
          `UPDATE sheets_bots SET name=$3, schema_id=$4, spreadsheet_id=$5, spreadsheet_title=$6, sheet_name=$7, column_map=$8::jsonb,
           fallback_text=$9, match_mode=$10, sync_mode=$11, updated_at=NOW()
           WHERE id=$1 AND business_id=$2`,
          [body.botId, session.businessId, name, String(body.schemaId || 'faq'), spreadsheetId, String(body.spreadsheetTitle || '').slice(0, 200), sheetName, JSON.stringify(columnMap), String(body.fallbackText || '').slice(0, 1000), ['exact', 'keyword', 'normalized'].includes(body.matchMode) ? body.matchMode : 'keyword', body.syncMode === 'manual' ? 'manual' : 'poll']
        );
        return json({ ok: true, botId: body.botId });
      }
      const botId = id('sb');
      await query(
        `INSERT INTO sheets_bots (id, business_id, connection_id, name, schema_id, spreadsheet_id, spreadsheet_title, sheet_name, column_map, fallback_text, match_mode, sync_mode)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)`,
        [botId, session.businessId, connection.id, name, String(body.schemaId || 'faq'), spreadsheetId, String(body.spreadsheetTitle || '').slice(0, 200), sheetName, JSON.stringify(columnMap), String(body.fallbackText || '').slice(0, 1000), ['exact', 'keyword', 'normalized'].includes(body.matchMode) ? body.matchMode : 'keyword', body.syncMode === 'manual' ? 'manual' : 'poll']
      );
      return json({ ok: true, botId });
    }

    if (action === 'setStatus') {
      if (!['draft', 'published', 'paused'].includes(body.status)) throw new AppError('Invalid status.', 400, 'VALIDATION_ERROR');
      const result = await query(
        'UPDATE sheets_bots SET status=$3, updated_at=NOW() WHERE id=$1 AND business_id=$2 RETURNING id',
        [body.botId, session.businessId, body.status]
      );
      if (!result.rowCount) throw new AppError('Bot not found.', 404, 'NOT_FOUND');
      return json({ ok: true });
    }

    if (action === 'sync') {
      const summary = await syncSheetsBot(session.businessId, body.botId);
      return json({ ok: true, summary });
    }

    if (action === 'test') {
      const preview = await matchSheetsBot(session.businessId, String(body.text || ''), body.botId || '');
      return json({ preview });
    }

    if (action === 'disconnect') {
      await query(
        `UPDATE sheets_bot_connections SET status='disconnected', access_token_encrypted='', refresh_token_encrypted='', last_error='', updated_at=NOW() WHERE business_id=$1`,
        [session.businessId]
      );
      await query(`UPDATE sheets_bots SET status='paused', updated_at=NOW() WHERE business_id=$1 AND status='published'`, [session.businessId]);
      return json({ ok: true });
    }

    throw new AppError('Unsupported action.', 400, 'INVALID_ACTION');
  } catch (error) {
    return errorJson(error);
  }
}

export async function syncSheetsBot(businessId, botId) {
  const bot = (await query('SELECT * FROM sheets_bots WHERE id=$1 AND business_id=$2', [botId, businessId])).rows[0];
  if (!bot) throw new AppError('Bot not found.', 404, 'NOT_FOUND');
  const token = await accessTokenForBusiness(businessId);
  const range = `${bot.sheet_name}!A1:Z5000`;
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(bot.spreadsheet_id)}/values/${encodeURIComponent(range)}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    await query(
      `UPDATE sheets_bots SET last_sync_status='failed', last_sync_error=$3, updated_at=NOW() WHERE id=$1 AND business_id=$2`,
      [botId, businessId, String(payload.error?.message || 'Sync failed').slice(0, 500)]
    );
    throw new AppError(payload.error?.message || 'Sheet sync failed.', 502, 'SHEETS_SYNC_FAILED');
  }
  const values = Array.isArray(payload.values) ? payload.values : [];
  if (!values.length) {
    await query(
      `UPDATE sheets_bots SET last_synced_at=NOW(), last_sync_status='empty', last_sync_error='', row_count=0, sync_version=sync_version+1, updated_at=NOW() WHERE id=$1 AND business_id=$2`,
      [botId, businessId]
    );
    await query('DELETE FROM sheets_bot_rows WHERE bot_id=$1 AND business_id=$2', [botId, businessId]);
    return { rows: 0, version: bot.sync_version + 1 };
  }
  const headers = values[0].map((cell) => String(cell || '').trim());
  const map = bot.column_map || {};
  const col = (key) => {
    const header = map[key];
    if (!header) return -1;
    return headers.findIndex((item) => item.toLowerCase() === String(header).toLowerCase());
  };
  const nextVersion = Number(bot.sync_version || 0) + 1;
  await transaction(async (client) => {
    await client.query('DELETE FROM sheets_bot_rows WHERE bot_id=$1 AND business_id=$2', [botId, businessId]);
    let stored = 0;
    for (let index = 1; index < values.length; index += 1) {
      const row = values[index] || [];
      const payloadRow = {};
      for (const [key, header] of Object.entries(map)) {
        const idx = headers.findIndex((item) => item.toLowerCase() === String(header).toLowerCase());
        payloadRow[key] = idx >= 0 ? String(row[idx] || '').trim() : '';
      }
      const enabledRaw = payloadRow.enabled;
      const enabled = enabledRaw === undefined || enabledRaw === '' || /^(1|true|yes|y|on)$/i.test(enabledRaw);
      const replyText = String(payloadRow.reply || payloadRow.answer || '').trim();
      const searchParts = [payloadRow.question, payloadRow.keywords, payloadRow.product, payloadRow.service, payloadRow.description]
        .map((item) => String(item || '').trim())
        .filter(Boolean);
      if (!replyText || !searchParts.length || !enabled) continue;
      await client.query(
        `INSERT INTO sheets_bot_rows (id, business_id, bot_id, row_index, payload, search_text, reply_text, enabled, sync_version)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,TRUE,$8)`,
        [id('sbr'), businessId, botId, index + 1, JSON.stringify(payloadRow), searchParts.join(' | ').slice(0, 2000), replyText.slice(0, 1000), nextVersion]
      );
      stored += 1;
    }
    await client.query(
      `UPDATE sheets_bots SET last_synced_at=NOW(), last_sync_status='ok', last_sync_error='', row_count=$3, sync_version=$4, updated_at=NOW()
       WHERE id=$1 AND business_id=$2`,
      [botId, businessId, stored, nextVersion]
    );
  });
  return { rows: (await query('SELECT row_count, sync_version FROM sheets_bots WHERE id=$1 AND business_id=$2', [botId, businessId])).rows[0] };
}

export async function matchSheetsBot(businessId, text, botId = '') {
  const bots = (await query(
    `SELECT * FROM sheets_bots WHERE business_id=$1 AND status='published' AND ($2='' OR id=$2) ORDER BY updated_at DESC LIMIT 10`,
    [businessId, botId || '']
  )).rows;
  const needle = normalize(text);
  for (const bot of bots) {
    const rows = (await query(
      'SELECT * FROM sheets_bot_rows WHERE business_id=$1 AND bot_id=$2 AND enabled ORDER BY row_index ASC LIMIT 5000',
      [businessId, bot.id]
    )).rows;
    for (const row of rows) {
      const hay = normalize(row.search_text);
      const payload = row.payload || {};
      const keywords = String(payload.keywords || '')
        .split(/[,|;]/)
        .map((item) => normalize(item))
        .filter(Boolean);
      let hit = false;
      if (bot.match_mode === 'exact') hit = hay === needle || normalize(payload.question) === needle;
      else if (bot.match_mode === 'normalized') hit = hay.includes(needle) || needle.includes(normalize(payload.question || ''));
      else hit = keywords.some((item) => needle.includes(item)) || (normalize(payload.question) && needle.includes(normalize(payload.question))) || hay.includes(needle);
      if (hit) {
        return {
          matched: true,
          botId: bot.id,
          botName: bot.name,
          rowIndex: row.row_index,
          replyText: row.reply_text,
          syncVersion: bot.sync_version,
          sheetName: bot.sheet_name,
          fallback: false
        };
      }
    }
    if (bot.fallback_text) {
      return {
        matched: false,
        botId: bot.id,
        botName: bot.name,
        replyText: bot.fallback_text,
        syncVersion: bot.sync_version,
        sheetName: bot.sheet_name,
        fallback: true
      };
    }
  }
  return { matched: false, replyText: '', fallback: false };
}

export async function tryHandleSheetsBot({ businessId, contactId, conversationId, messageId, text, phoneNumberId }) {
  const flags = await workspaceFeatureFlags(businessId);
  if (!flags.sheets_bot) return { handled: false };
  const conversation = (await query('SELECT automation_paused FROM conversations WHERE id=$1 AND business_id=$2', [conversationId, businessId])).rows[0];
  if (conversation?.automation_paused) return { handled: false };
  const contact = (await query('SELECT unsubscribed, phone FROM contacts WHERE id=$1 AND business_id=$2', [contactId, businessId])).rows[0];
  if (!contact || contact.unsubscribed) return { handled: false };
  const preview = await matchSheetsBot(businessId, text);
  // Fallback-only answers must not swallow every inbound message and skip automation/AI.
  if (!preview.replyText || preview.fallback) return { handled: false, fallbackPreview: preview.fallback || false };
  const phone = (await query(
    `SELECT p.phone_number_id, a.access_token_encrypted, a.token_expires_at
     FROM whatsapp_phone_numbers p
     JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id
     WHERE p.business_id=$1 AND (p.phone_number_id=$2 OR $2='')
     ORDER BY p.is_default DESC LIMIT 1`,
    [businessId, phoneNumberId || '']
  )).rows[0];
  if (!phone || !metaReady({ accessToken: decryptSecret(phone.access_token_encrypted), phoneNumberId: phone.phone_number_id, tokenExpiresAt: phone.token_expires_at })) {
    return { handled: false, reason: 'meta_not_ready' };
  }
  const meta = await sendTextMessage({
    setup: { accessToken: decryptSecret(phone.access_token_encrypted), phoneNumberId: phone.phone_number_id },
    to: contact.phone,
    body: preview.replyText
  });
  await query(
    "INSERT INTO messages (id, conversation_id, direction, body, status, meta_message_id) VALUES ($1,$2,'outgoing',$3,$4,$5)",
    [id('m'), conversationId, preview.replyText, meta.status, meta.metaMessageId]
  );
  return { handled: true, botId: preview.botId, fallback: preview.fallback, syncVersion: preview.syncVersion };
}

export async function runSheetsBotSyncJobs({ limit = 10 } = {}) {
  const bots = (await query(
    `SELECT id, business_id FROM sheets_bots
     WHERE status='published' AND sync_mode='poll'
       AND (last_synced_at IS NULL OR last_synced_at < NOW() - INTERVAL '5 minutes')
     ORDER BY COALESCE(last_synced_at, to_timestamp(0)) ASC LIMIT $1`,
    [Math.min(50, Math.max(1, Number(limit) || 10))]
  )).rows;
  let synced = 0;
  let failed = 0;
  for (const bot of bots) {
    try {
      await syncSheetsBot(bot.business_id, bot.id);
      synced += 1;
    } catch {
      failed += 1;
    }
  }
  return { attempted: bots.length, synced, failed };
}

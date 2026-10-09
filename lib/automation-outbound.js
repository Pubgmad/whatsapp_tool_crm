import https from 'node:https';
import dns from 'node:dns/promises';
import { requireSession } from './auth.js';
import { AppError, query, transaction, id, json, errorJson } from './db.js';
import { encryptSecret, decryptSecret } from './meta.js';
import { integrationWebhookUrl, publicWebhookAddress } from './workspace-integrations.js';
import { readJsonBodyLimited } from './security.js';
import { assertSubscriptionActive, subscriptionUsage } from './limits.js';
import { nodeError } from './automation-node-runtime.js';

export async function resolveOutboundHost(hostname, lookup = dns.lookup) {
  let timer;
  try {
    const addresses = await Promise.race([lookup(hostname, { all: true }), new Promise((_, reject) => {
      timer = setTimeout(() => reject(nodeError('AUTOMATION_API_DNS_TIMEOUT')), 5000);
    })]);
    if (!addresses.length || addresses.some(record => !publicWebhookAddress(record.address))) throw nodeError('AUTOMATION_API_ADDRESS_DENIED');
    return addresses[0];
  } finally { clearTimeout(timer); }
}

export function normalizeOutboundConnection(body) {
  const url = integrationWebhookUrl(body.url);
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120 || !['GET', 'POST'].includes(body.method) || typeof body.token !== 'string' || !body.token.trim() || body.token.length > 4096 || /[\r\n]/.test(body.token)) {
    throw new AppError('Provide a name, GET or POST, and a bearer credential.', 400, 'CONNECTION_INVALID');
  }
  // Query parameters belong to node fields, so credentials cannot be stored in a URL.
  if (url.search) throw new AppError('Connection endpoints cannot contain query parameters.', 400, 'CONNECTION_INVALID');
  return { name: body.name.trim(), url: url.href, method: body.method, token: body.token.trim() };
}

export async function outboundConnectionSettings(request) {
  try {
    const session = await requireSession(request);
    if (request.method === 'GET') {
      const result = await query('SELECT id,name,method,url,enabled FROM automation_outbound_connections WHERE business_id=$1 ORDER BY name LIMIT 100', [session.businessId]);
      return json({ connections: result.rows });
    }
    if (session.role !== 'Owner') throw new AppError('Only the workspace owner can manage outbound credentials.', 403, 'FORBIDDEN');
    await assertSubscriptionActive(await subscriptionUsage(session.businessId));
    const body = await readJsonBodyLimited(request, 16384);
    if (body.action === 'toggle') {
      if (typeof body.enabled !== 'boolean') throw new AppError('Specify enabled or disabled.', 400, 'CONNECTION_INVALID');
      await transaction(async client => {
        const changed = await client.query('UPDATE automation_outbound_connections SET enabled=$1,updated_at=NOW() WHERE id=$2 AND business_id=$3 RETURNING id', [body.enabled, body.id, session.businessId]);
        if (!changed.rowCount) throw new AppError('Connection not found.', 404, 'NOT_FOUND');
        await client.query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'automation_connection_toggled',$4)", [id('a'), session.businessId, session.userId, JSON.stringify({ connectionId: body.id, enabled: body.enabled })]);
      });
      return json({ ok: true });
    }
    if (body.action !== 'create') throw new AppError('Unsupported connection action.', 400, 'INVALID_ACTION');
    const connection = normalizeOutboundConnection(body);
    await resolveOutboundHost(new URL(connection.url).hostname);
    const connectionId = id('ac');
    await transaction(async client => {
      await client.query('INSERT INTO automation_outbound_connections (id,business_id,created_by,name,url,method,credential_encrypted) VALUES ($1,$2,$3,$4,$5,$6,$7)', [connectionId, session.businessId, session.userId, connection.name, connection.url, connection.method, encryptSecret(connection.token)]);
      await client.query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'automation_connection_created',$4)", [id('a'), session.businessId, session.userId, JSON.stringify({ connectionId, host: new URL(connection.url).hostname, method: connection.method })]);
    });
    return json({ ok: true, id: connectionId }, 201);
  } catch (error) { return errorJson(error); }
}

export async function requestOutboundConnection({ businessId, connectionId, fields, guard, load = query, lookup = dns.lookup, request = https.request }) {
  const connection = (await load(`SELECT c.* FROM automation_outbound_connections c
    JOIN memberships m ON m.business_id=c.business_id AND m.user_id=c.created_by AND m.role='Owner'
    WHERE c.id=$1 AND c.business_id=$2 AND c.enabled`, [connectionId, businessId])).rows[0];
  if (!connection) throw nodeError('AUTOMATION_API_CONNECTION_UNAVAILABLE');
  const url = integrationWebhookUrl(connection.url);
  if (url.search || !['GET', 'POST'].includes(connection.method)) throw nodeError('AUTOMATION_API_CONNECTION_INVALID');
  const pinned = await resolveOutboundHost(url.hostname, lookup);
  const token = decryptSecret(connection.credential_encrypted);
  if (!token || /[\r\n]/.test(token)) throw nodeError('AUTOMATION_API_CREDENTIAL_INVALID');
  const body = connection.method === 'POST' ? JSON.stringify(fields) : '';
  if (Buffer.byteLength(body) > 16384) throw nodeError('AUTOMATION_API_REQUEST_TOO_LARGE');
  if (connection.method === 'GET') for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, String(value));
  if (url.href.length > 2000) throw nodeError('AUTOMATION_API_REQUEST_TOO_LARGE');
  await guard();
  // A single attempt, including HTTP 429: a POST may have committed before failing.
  return new Promise((resolve, reject) => {
    let timer;
    const fail = code => reject(nodeError(code));
    const req = request(url, {
      method: connection.method, agent: false,
      lookup: (_host, options, callback) => callback(null, options.all ? [pinned] : pinned.address, pinned.family),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) }
    }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 65536) { fail('AUTOMATION_API_RESPONSE_TOO_LARGE'); req.destroy(); }
        else chunks.push(chunk);
      });
      response.on('error', () => fail('AUTOMATION_API_UNCONFIRMED'));
      response.on('aborted', () => fail('AUTOMATION_API_UNCONFIRMED'));
      response.on('end', () => {
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers['content-type'] || '')) return fail('AUTOMATION_API_RESPONSE_INVALID');
        try { resolve({ statusCode: response.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { fail('AUTOMATION_API_RESPONSE_INVALID'); }
      });
    });
    timer = setTimeout(() => { fail('AUTOMATION_API_TIMEOUT'); req.destroy(); }, 10000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', () => fail('AUTOMATION_API_UNCONFIRMED'));
    req.end(body || undefined);
  });
}

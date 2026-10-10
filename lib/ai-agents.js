import { AppError, id, query, transaction } from './db.js';
import { aiRuntimeTunables } from './ai-policy.js';

export const namedAgentIdOk = (value) => /^aig_[a-f0-9]{16}$/.test(value || '');
const statuses = new Set(['active', 'paused', 'archived']);

function normalizeStatus(body) {
  if (body.status && statuses.has(String(body.status))) return String(body.status);
  if (body.enabled === false) return 'paused';
  return 'active';
}

export async function listAiAgents(businessId, { includeArchived = false } = {}) {
  return (await query(
    `SELECT id,name,purpose,instructions,language_code,enabled,status,version,is_default,created_at,updated_at
     FROM ai_agents
     WHERE business_id=$1 AND ($2::boolean OR COALESCE(status,'active')<>'archived')
     ORDER BY is_default DESC, name ASC`,
    [businessId, includeArchived]
  )).rows;
}

export async function resolveActiveAgent(businessId, settings = null) {
  const activeId = settings?.active_agent_id;
  if (activeId && namedAgentIdOk(activeId)) {
    const row = (await query(
      `SELECT * FROM ai_agents
       WHERE business_id=$1 AND id=$2 AND COALESCE(status,'active')='active' AND enabled`,
      [businessId, activeId]
    )).rows[0];
    if (row) return row;
  }
  return (await query(
    `SELECT * FROM ai_agents
     WHERE business_id=$1 AND COALESCE(status,'active')='active' AND enabled AND is_default
     ORDER BY updated_at DESC LIMIT 1`,
    [businessId]
  )).rows[0] || null;
}

async function writeRevision(client, { businessId, userId, agent }) {
  await client.query(
    `INSERT INTO ai_agent_revisions(id,business_id,agent_id,version,snapshot,created_by)
     VALUES($1,$2,$3,$4,$5::jsonb,$6)
     ON CONFLICT (agent_id, version) DO NOTHING`,
    [
      id('aigr'),
      businessId,
      agent.id,
      agent.version,
      JSON.stringify({
        name: agent.name,
        purpose: agent.purpose,
        instructions: agent.instructions,
        language_code: agent.language_code,
        status: agent.status,
        enabled: agent.enabled,
        is_default: agent.is_default
      }),
      userId
    ]
  );
}

export async function saveAiAgent(businessId, userId, body) {
  const name = String(body.name || '').trim();
  const purpose = String(body.purpose || '').trim().slice(0, 500);
  const instructions = String(body.instructions || '').trim().slice(0, 4000);
  const language = String(body.languageCode || 'en').trim().slice(0, 16) || 'en';
  const status = normalizeStatus(body);
  const enabled = status === 'active';
  const isDefault = Boolean(body.isDefault) && status === 'active';
  if (!name || name.length > 80) throw new AppError('Provide an agent name up to 80 characters.', 400, 'VALIDATION_ERROR');
  if (!/^[a-z]{2,8}(-[A-Za-z]{2,8})?$/.test(language)) {
    throw new AppError('Choose a valid language code.', 400, 'VALIDATION_ERROR');
  }
  if (body.id !== undefined && !namedAgentIdOk(body.id)) throw new AppError('Invalid agent ID.', 400, 'VALIDATION_ERROR');
  const tunables = await aiRuntimeTunables();

  return transaction(async (client) => {
    const documentId = body.id || id('aig');
    if (isDefault) {
      await client.query('UPDATE ai_agents SET is_default=FALSE,updated_at=NOW() WHERE business_id=$1 AND is_default', [businessId]);
    }
    if (body.id) {
      const updated = await client.query(
        `UPDATE ai_agents
         SET name=$1,purpose=$2,instructions=$3,language_code=$4,enabled=$5,status=$6,is_default=$7,
             version=COALESCE(version,1)+1,updated_at=NOW()
         WHERE business_id=$8 AND id=$9 AND COALESCE(status,'active')<>'archived'
         RETURNING *`,
        [name, purpose, instructions, language, enabled, status, isDefault, businessId, documentId]
      );
      if (!updated.rowCount) throw new AppError('Agent not found or archived.', 404, 'NOT_FOUND');
      await writeRevision(client, { businessId, userId, agent: updated.rows[0] });
      await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)', [
        id('a'), businessId, userId, 'ai_agent_updated', JSON.stringify({ agentId: documentId, version: updated.rows[0].version, status })
      ]);
      return updated.rows[0];
    }
    const count = (await client.query(
      `SELECT COUNT(*)::int AS total FROM ai_agents WHERE business_id=$1 AND COALESCE(status,'active')<>'archived'`,
      [businessId]
    )).rows[0].total;
    if (count >= tunables.agentLimit) throw new AppError('Agent limit reached.', 409, 'AGENT_LIMIT');
    const makeDefault = isDefault || count === 0;
    if (makeDefault) {
      await client.query('UPDATE ai_agents SET is_default=FALSE,updated_at=NOW() WHERE business_id=$1 AND is_default', [businessId]);
    }
    const inserted = await client.query(
      `INSERT INTO ai_agents(id,business_id,name,purpose,instructions,language_code,enabled,status,is_default,version)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1) RETURNING *`,
      [documentId, businessId, name, purpose, instructions, language, enabled, status, makeDefault]
    );
    await writeRevision(client, { businessId, userId, agent: inserted.rows[0] });
    await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)', [
      id('a'), businessId, userId, 'ai_agent_created', JSON.stringify({ agentId: documentId })
    ]);
    return inserted.rows[0];
  });
}

export async function archiveAiAgent(businessId, userId, agentId) {
  if (!namedAgentIdOk(agentId)) throw new AppError('Invalid agent ID.', 400, 'VALIDATION_ERROR');
  await transaction(async (client) => {
    const row = (await client.query(
      `UPDATE ai_agents
       SET status='archived',enabled=FALSE,is_default=FALSE,version=COALESCE(version,1)+1,updated_at=NOW()
       WHERE business_id=$1 AND id=$2 AND COALESCE(status,'active')<>'archived'
       RETURNING *`,
      [businessId, agentId]
    )).rows[0];
    if (!row) throw new AppError('Agent not found.', 404, 'NOT_FOUND');
    await writeRevision(client, { businessId, userId, agent: row });
    const hasDefault = (await client.query(
      `SELECT 1 FROM ai_agents WHERE business_id=$1 AND is_default AND COALESCE(status,'active')='active'`,
      [businessId]
    )).rowCount;
    if (!hasDefault) {
      const next = (await client.query(
        `SELECT id FROM ai_agents WHERE business_id=$1 AND COALESCE(status,'active')='active'
         ORDER BY updated_at DESC LIMIT 1`,
        [businessId]
      )).rows[0];
      if (next) {
        await client.query('UPDATE ai_agents SET is_default=TRUE,updated_at=NOW() WHERE business_id=$1 AND id=$2', [businessId, next.id]);
      }
    }
    await client.query('UPDATE ai_agent_settings SET active_agent_id=NULL WHERE business_id=$1 AND active_agent_id=$2', [businessId, agentId]);
    await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)', [
      id('a'), businessId, userId, 'ai_agent_archived', JSON.stringify({ agentId })
    ]);
  });
}

export async function removeAiAgent(businessId, userId, agentId) {
  return archiveAiAgent(businessId, userId, agentId);
}

export async function duplicateAiAgent(businessId, userId, agentId) {
  if (!namedAgentIdOk(agentId)) throw new AppError('Invalid agent ID.', 400, 'VALIDATION_ERROR');
  const source = (await query('SELECT * FROM ai_agents WHERE business_id=$1 AND id=$2', [businessId, agentId])).rows[0];
  if (!source) throw new AppError('Agent not found.', 404, 'NOT_FOUND');
  return saveAiAgent(businessId, userId, {
    name: `${source.name} copy`.slice(0, 80),
    purpose: source.purpose,
    instructions: source.instructions,
    languageCode: source.language_code,
    status: 'paused',
    isDefault: false
  });
}

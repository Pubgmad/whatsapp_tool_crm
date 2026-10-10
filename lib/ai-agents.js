import { AppError, id, query, transaction } from './db.js';

// Named agents use prefix aig_ to avoid colliding with action proposals (aia_)
export const namedAgentIdOk = (value) => /^aig_[a-f0-9]{16}$/.test(value || '');

export async function listAiAgents(businessId) {
  return (await query(
    `SELECT id,name,purpose,instructions,language_code,enabled,is_default,created_at,updated_at
     FROM ai_agents WHERE business_id=$1 ORDER BY is_default DESC, name ASC`,
    [businessId]
  )).rows;
}

export async function resolveActiveAgent(businessId, settings = null) {
  const activeId = settings?.active_agent_id;
  if (activeId && namedAgentIdOk(activeId)) {
    const row = (await query(
      'SELECT * FROM ai_agents WHERE business_id=$1 AND id=$2 AND enabled',
      [businessId, activeId]
    )).rows[0];
    if (row) return row;
  }
  return (await query(
    'SELECT * FROM ai_agents WHERE business_id=$1 AND enabled AND is_default ORDER BY updated_at DESC LIMIT 1',
    [businessId]
  )).rows[0] || null;
}

export async function saveAiAgent(businessId, userId, body) {
  const name = String(body.name || '').trim();
  const purpose = String(body.purpose || '').trim().slice(0, 500);
  const instructions = String(body.instructions || '').trim().slice(0, 4000);
  const language = String(body.languageCode || 'en').trim().slice(0, 16) || 'en';
  const enabled = body.enabled !== false;
  const isDefault = Boolean(body.isDefault);
  if (!name || name.length > 80) throw new AppError('Provide an agent name up to 80 characters.', 400, 'VALIDATION_ERROR');
  if (!/^[a-z]{2}(-[A-Z]{2})?$|^en$|^hi$|^es$|^pt$|^ar$|^fr$|^de$|^id$|^tr$/.test(language) && !/^[a-z]{2,8}$/.test(language)) {
    throw new AppError('Choose a valid language code.', 400, 'VALIDATION_ERROR');
  }
  if (body.id !== undefined && !namedAgentIdOk(body.id)) throw new AppError('Invalid agent ID.', 400, 'VALIDATION_ERROR');

  return transaction(async (client) => {
    const documentId = body.id || id('aig');
    if (isDefault) {
      await client.query('UPDATE ai_agents SET is_default=FALSE,updated_at=NOW() WHERE business_id=$1 AND is_default', [businessId]);
    }
    if (body.id) {
      const updated = await client.query(
        `UPDATE ai_agents SET name=$1,purpose=$2,instructions=$3,language_code=$4,enabled=$5,is_default=$6,updated_at=NOW()
         WHERE business_id=$7 AND id=$8 RETURNING *`,
        [name, purpose, instructions, language, enabled, isDefault, businessId, documentId]
      );
      if (!updated.rowCount) throw new AppError('Agent not found.', 404, 'NOT_FOUND');
      await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)', [
        id('a'), businessId, userId, 'ai_agent_updated', JSON.stringify({ agentId: documentId })
      ]);
      return updated.rows[0];
    }
    const count = (await client.query('SELECT COUNT(*)::int AS total FROM ai_agents WHERE business_id=$1', [businessId])).rows[0].total;
    if (count >= 25) throw new AppError('Agent limit reached.', 409, 'AGENT_LIMIT');
    const makeDefault = isDefault || count === 0;
    if (makeDefault) {
      await client.query('UPDATE ai_agents SET is_default=FALSE,updated_at=NOW() WHERE business_id=$1 AND is_default', [businessId]);
    }
    const inserted = await client.query(
      `INSERT INTO ai_agents(id,business_id,name,purpose,instructions,language_code,enabled,is_default)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [documentId, businessId, name, purpose, instructions, language, enabled, makeDefault]
    );
    await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)', [
      id('a'), businessId, userId, 'ai_agent_created', JSON.stringify({ agentId: documentId })
    ]);
    return inserted.rows[0];
  });
}

export async function removeAiAgent(businessId, userId, agentId) {
  if (!namedAgentIdOk(agentId)) throw new AppError('Invalid agent ID.', 400, 'VALIDATION_ERROR');
  await transaction(async (client) => {
    const row = (await client.query('DELETE FROM ai_agents WHERE business_id=$1 AND id=$2 RETURNING id,is_default', [businessId, agentId])).rows[0];
    if (!row) throw new AppError('Agent not found.', 404, 'NOT_FOUND');
    if (row.is_default) {
      const next = (await client.query(
        'SELECT id FROM ai_agents WHERE business_id=$1 AND enabled ORDER BY updated_at DESC LIMIT 1',
        [businessId]
      )).rows[0];
      if (next) await client.query('UPDATE ai_agents SET is_default=TRUE,updated_at=NOW() WHERE business_id=$1 AND id=$2', [businessId, next.id]);
    }
    await client.query('UPDATE ai_agent_settings SET active_agent_id=NULL WHERE business_id=$1 AND active_agent_id=$2', [businessId, agentId]);
    await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)', [
      id('a'), businessId, userId, 'ai_agent_removed', JSON.stringify({ agentId })
    ]);
  });
}

export async function duplicateAiAgent(businessId, userId, agentId) {
  if (!namedAgentIdOk(agentId)) throw new AppError('Invalid agent ID.', 400, 'VALIDATION_ERROR');
  const source = (await query('SELECT * FROM ai_agents WHERE business_id=$1 AND id=$2', [businessId, agentId])).rows[0];
  if (!source) throw new AppError('Agent not found.', 404, 'NOT_FOUND');
  const base = `${source.name} copy`.slice(0, 80);
  return saveAiAgent(businessId, userId, {
    name: base,
    purpose: source.purpose,
    instructions: source.instructions,
    languageCode: source.language_code,
    enabled: false,
    isDefault: false
  });
}

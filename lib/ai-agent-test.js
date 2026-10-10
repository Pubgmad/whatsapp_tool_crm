import { AppError, id, query } from './db.js';
import { configured, createSupportSuggestion, reserveAiDailyRequest } from './ai-support.js';
import { retrieveKnowledgeSources } from './ai-knowledge-retrieve.js';
import { resolveActiveAgent, namedAgentIdOk } from './ai-agents.js';
import { detectPromptInjection } from './ai-policy.js';

export async function runAiAgentTest({ businessId, userId, prompt, agentId = null }) {
  const text = String(prompt || '').trim();
  if (!text || text.length > 2000) throw new AppError('Provide a test prompt up to 2000 characters.', 400, 'VALIDATION_ERROR');
  if (detectPromptInjection(text)) throw new AppError('Test prompt blocked by AI safety policy.', 400, 'AI_POLICY_BLOCKED');

  const settings = (await query(
    'SELECT enabled,instructions,allow_crm_context,active_agent_id,dialogflow_enabled FROM ai_agent_settings WHERE business_id=$1',
    [businessId]
  )).rows[0];
  if (!settings) throw new AppError('Configure the assistant first.', 409, 'AI_NOT_CONFIGURED');

  let agent = null;
  if (agentId) {
    if (!namedAgentIdOk(agentId)) throw new AppError('Invalid agent ID.', 400, 'VALIDATION_ERROR');
    agent = (await query('SELECT * FROM ai_agents WHERE business_id=$1 AND id=$2', [businessId, agentId])).rows[0];
    if (!agent) throw new AppError('Agent not found.', 404, 'NOT_FOUND');
  } else {
    agent = await resolveActiveAgent(businessId, settings);
  }

  const instructions = (agent?.instructions || settings.instructions || '').trim();
  const knowledge = await retrieveKnowledgeSources(businessId, text, { agentId: agent?.id || null, limit: 5 });
  if (!knowledge.length) {
    const runId = id('ait');
    await query(
      `INSERT INTO ai_agent_test_runs(id,business_id,agent_id,prompt,reply,handoff,source_ids,provider,status,error_code,created_by)
       VALUES($1,$2,$3,$4,'',TRUE,'[]'::jsonb,'none','no_source','AI_NO_SOURCE',$5)`,
      [runId, businessId, agent?.id || null, text, userId]
    );
    return { id: runId, handoff: true, suggestion: '', sources: [], status: 'no_source', errorCode: 'AI_NO_SOURCE' };
  }

  if (!configured()) throw new AppError('The platform OpenAI connection is not configured.', 503, 'OPENAI_NOT_CONFIGURED');
  await reserveAiDailyRequest(businessId);
  try {
    const result = await createSupportSuggestion({
      model: process.env.OPENAI_MODEL,
      key: process.env.OPENAI_API_KEY,
      instructions,
      knowledge,
      messages: [{ role: 'customer', text }],
      automatic: false
    });
    const runId = id('ait');
    await query(
      `INSERT INTO ai_agent_test_runs(id,business_id,agent_id,prompt,reply,handoff,source_ids,provider,status,error_code,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'openai','completed','',$8)`,
      [runId, businessId, agent?.id || null, text, result.suggestion || '', Boolean(result.handoff), JSON.stringify(result.sourceIds || []), userId]
    );
    return {
      id: runId,
      handoff: result.handoff,
      suggestion: result.suggestion,
      sources: knowledge.filter((item) => (result.sourceIds || []).includes(item.id)).map((item) => ({ id: item.id, title: item.title })),
      status: 'completed',
      agentId: agent?.id || null
    };
  } catch (error) {
    const runId = id('ait');
    const code = String(error?.code || 'AI_TEST_FAILED').slice(0, 80);
    await query(
      `INSERT INTO ai_agent_test_runs(id,business_id,agent_id,prompt,reply,handoff,source_ids,provider,status,error_code,created_by)
       VALUES($1,$2,$3,$4,'',TRUE,'[]'::jsonb,'openai','failed',$5,$6)`,
      [runId, businessId, agent?.id || null, text, code, userId]
    );
    throw error;
  }
}

import { AppError, query } from './db.js';

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(the\s+)?(system|developer)\s+prompt/i,
  /\bsystem\s*:\s*/i,
  /\bdeveloper\s*:\s*/i,
  /<\s*script\b/i,
  /\bjailbreak\b/i
];

const PLATFORM_CAP_KEYS = {
  autoReplyDailyMax: 'ai_platform_auto_reply_daily_max',
  suggestionDailyMax: 'ai_platform_suggestion_daily_max',
  chunkSize: 'ai_platform_chunk_size',
  chunkOverlap: 'ai_platform_chunk_overlap',
  retrievalLimit: 'ai_platform_retrieval_limit',
  agentLimit: 'ai_platform_agent_limit',
  knowledgeLimit: 'ai_platform_knowledge_limit',
  autoReplyBatch: 'ai_platform_auto_reply_batch',
  autoReplyDelaySeconds: 'ai_platform_auto_reply_delay_seconds'
};

function intSetting(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

export function detectPromptInjection(text) {
  const value = String(text || '').trim();
  if (!value || value.length > 8000) return true;
  return INJECTION_PATTERNS.some((pattern) => pattern.test(value));
}

export async function platformAiLimits(run = query) {
  const keys = [PLATFORM_CAP_KEYS.autoReplyDailyMax, PLATFORM_CAP_KEYS.suggestionDailyMax];
  const rows = (await run('SELECT key,value FROM platform_settings WHERE key=ANY($1::text[])', [keys])).rows;
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    autoReplyDailyMax: intSetting(values[PLATFORM_CAP_KEYS.autoReplyDailyMax], 1, 10000, 500),
    suggestionDailyMax: intSetting(values[PLATFORM_CAP_KEYS.suggestionDailyMax], 1, 10000, 2000)
  };
}

export async function aiRuntimeTunables(run = query) {
  const keys = Object.values(PLATFORM_CAP_KEYS);
  const rows = (await run('SELECT key,value FROM platform_settings WHERE key=ANY($1::text[])', [keys])).rows;
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    ...(await platformAiLimits(run)),
    chunkSize: intSetting(values[PLATFORM_CAP_KEYS.chunkSize], 400, 4000, 1200),
    chunkOverlap: intSetting(values[PLATFORM_CAP_KEYS.chunkOverlap], 0, 800, 150),
    retrievalLimit: intSetting(values[PLATFORM_CAP_KEYS.retrievalLimit], 1, 20, 5),
    agentLimit: intSetting(values[PLATFORM_CAP_KEYS.agentLimit], 1, 100, 25),
    knowledgeLimit: intSetting(values[PLATFORM_CAP_KEYS.knowledgeLimit], 10, 5000, 500),
    autoReplyBatch: intSetting(values[PLATFORM_CAP_KEYS.autoReplyBatch], 1, 10, 5),
    autoReplyDelaySeconds: intSetting(values[PLATFORM_CAP_KEYS.autoReplyDelaySeconds], 0, 120, 10)
  };
}

export async function autonomousActionsAllowedByPlatform(run = query) {
  // Prefer platform_settings; env remains an emergency override for operators.
  const row = (await run("SELECT value FROM platform_settings WHERE key='ai_autonomous_actions_enabled'")).rows[0];
  if (row) {
    const value = typeof row.value === 'string' ? row.value : row.value;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') {
      return String(process.env.AI_AUTONOMOUS_ACTIONS_ENABLED || '').toLowerCase() === 'true';
    }
  }
  return String(process.env.AI_AUTONOMOUS_ACTIONS_ENABLED || '').toLowerCase() === 'true';
}

export async function enforceInboundAiPolicy({ businessId, inboundText, settings, conversationId }) {
  if (detectPromptInjection(inboundText)) {
    const { recordAiSafetyEvent } = await import('./ai-safety-events.js');
    await recordAiSafetyEvent({
      businessId,
      conversationId,
      eventKind: 'prompt_injection',
      detail: 'Inbound message matched injection heuristics'
    });
    throw new AppError('Message blocked by AI safety policy.', 422, 'AI_POLICY_BLOCKED');
  }
  const caps = await platformAiLimits();
  const limit = Math.min(Number(settings?.auto_reply_daily_limit || 0), caps.autoReplyDailyMax);
  if (settings?.auto_reply_enabled && limit < 1) {
    throw new AppError('Automatic replies require a positive daily limit.', 409, 'AI_POLICY_LIMIT');
  }
  if (settings?.action_autonomous_enabled && !(await autonomousActionsAllowedByPlatform())) {
    const { recordAiSafetyEvent } = await import('./ai-safety-events.js');
    await recordAiSafetyEvent({
      businessId,
      conversationId,
      eventKind: 'autonomous_denied',
      detail: 'Platform autonomous gate blocked execution'
    });
    throw new AppError('Autonomous AI actions are disabled on this platform.', 403, 'AI_AUTONOMOUS_DISABLED');
  }
  return { autoReplyDailyMax: caps.autoReplyDailyMax, suggestionDailyMax: caps.suggestionDailyMax, effectiveAutoReplyLimit: limit };
}

export function clampAiSettings(body, caps) {
  const autoReplyDailyLimit = Math.min(Math.max(0, Number(body.autoReplyDailyLimit || 0)), caps.autoReplyDailyMax);
  let actionAutonomousEnabled = Boolean(body.actionAutonomousEnabled);
  if (actionAutonomousEnabled && !body.actionProposalsEnabled) actionAutonomousEnabled = false;
  const retrievalLimit = Math.min(20, Math.max(1, Number(body.retrievalLimit || 5) || 5));
  return { autoReplyDailyLimit, actionAutonomousEnabled, retrievalLimit };
}

export const ACTION_MODE_TYPES = [
  'set_contact_attribute',
  'set_order_status',
  'send_booking_flow',
  'add_contact_tag',
  'assign_conversation'
];

export function normalizeActionModes(value) {
  const input = value && typeof value === 'object' ? value : {};
  const modes = {};
  for (const type of ACTION_MODE_TYPES) {
    const mode = String(input[type] || 'propose').toLowerCase();
    modes[type] = ['off', 'propose', 'auto'].includes(mode) ? mode : 'propose';
  }
  return modes;
}

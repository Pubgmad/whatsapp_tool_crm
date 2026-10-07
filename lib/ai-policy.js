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
  suggestionDailyMax: 'ai_platform_suggestion_daily_max'
};

export function detectPromptInjection(text) {
  const value = String(text || '').trim();
  if (!value || value.length > 8000) return true;
  return INJECTION_PATTERNS.some((pattern) => pattern.test(value));
}

export async function platformAiLimits(run = query) {
  const keys = Object.values(PLATFORM_CAP_KEYS);
  const rows = (await run('SELECT key,value FROM platform_settings WHERE key=ANY($1::text[])', [keys])).rows;
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const autoReply = Number(values[PLATFORM_CAP_KEYS.autoReplyDailyMax]);
  const suggestions = Number(values[PLATFORM_CAP_KEYS.suggestionDailyMax]);
  return {
    autoReplyDailyMax: Number.isInteger(autoReply) && autoReply >= 1 && autoReply <= 10000 ? autoReply : 500,
    suggestionDailyMax: Number.isInteger(suggestions) && suggestions >= 1 && suggestions <= 10000 ? suggestions : 2000
  };
}

export async function autonomousActionsAllowedByPlatform(run = query) {
  if (String(process.env.AI_AUTONOMOUS_ACTIONS_ENABLED || '').toLowerCase() === 'true') return true;
  const row = (await run("SELECT value FROM platform_settings WHERE key='ai_autonomous_actions_enabled'")).rows[0];
  if (!row) return false;
  const value = typeof row.value === 'string' ? row.value : row.value;
  return value === true || value === 'true';
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
  // clampAiSettings is sync; platform gate is enforced again at execution time
  if (actionAutonomousEnabled && !body.actionProposalsEnabled) actionAutonomousEnabled = false;
  return { autoReplyDailyLimit, actionAutonomousEnabled };
}

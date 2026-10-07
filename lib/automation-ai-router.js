import { AppError } from './db.js';

/**
 * Routes automation to a target node based on keyword/intent rules (production chatbot router).
 */
export function resolveAutomationRoute(definition, input = {}) {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const router = nodes.find((node) => node.type === 'ai_route');
  if (!router) return null;
  const text = String(input.text || '').toLowerCase();
  const rules = Array.isArray(router.routes) ? router.routes : [];
  for (const rule of rules) {
    const keywords = (rule.match || []).map((k) => String(k).toLowerCase()).filter(Boolean);
    if (keywords.some((k) => text.includes(k))) return rule.next || router.fallback || definition.startNodeId;
  }
  if (router.intent === 'handoff' && /human|agent|support|person/.test(text)) {
    return router.handoffNext || nodes.find((n) => n.type === 'handoff')?.id || router.fallback;
  }
  return router.fallback || definition.startNodeId;
}

export function validateAiRouteNode(node) {
  if (node.type !== 'ai_route') return;
  if (!Array.isArray(node.routes)) throw new AppError('AI route node requires routes array.', 400, 'VALIDATION_ERROR');
}

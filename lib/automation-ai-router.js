import { AppError } from './db.js';

const clean = value => String(value || '').trim();
const destinationId = value => /^[A-Za-z0-9_-]{1,100}$/.test(clean(value));

export function normalizeAiRouteNode(node) {
  if (node.type !== 'ai_route') return {};
  const model = clean(node.model);
  const prompt = clean(node.prompt);
  const destinations = Array.isArray(node.allowedDestinations) ? [...new Set(node.allowedDestinations.map(clean).filter(Boolean))] : [];
  const fallback = clean(node.fallback);
  if (!model || model.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(model) || !prompt || prompt.length > 2000) {
    throw new AppError('AI route requires a valid model and prompt.', 400, 'VALIDATION_ERROR');
  }
  if (!destinations.length || destinations.length > 20 || destinations.some(value => !destinationId(value)) || !fallback || !destinations.includes(fallback)) {
    throw new AppError('AI route destinations and fallback must be explicitly allowed.', 400, 'VALIDATION_ERROR');
  }
  return { model, prompt, allowedDestinations: destinations, fallback, inputKind: 'none', body: '', options: [] };
}

/**
 * Deterministic routing is used by previews and as an optional pre-route. It never
 * grants a destination outside the node's explicit allow-list.
 */
export function resolveAutomationRoute(definition, input = {}, nodeId = '') {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const router = nodeId ? nodes.find(node => node.id === nodeId && node.type === 'ai_route') : nodes.find((node) => node.type === 'ai_route');
  if (!router) return null;
  const allowed = new Set(router.allowedDestinations || []);
  const accept = value => allowed.size ? (allowed.has(value) ? value : null) : value;
  const text = String(input.text || '').toLowerCase();
  const rules = Array.isArray(router.routes) ? router.routes : [];
  for (const rule of rules) {
    const keywords = (rule.match || []).map((k) => String(k).toLowerCase()).filter(Boolean);
    if (keywords.some((k) => text.includes(k))) return accept(rule.next) || accept(router.fallback);
  }
  if (router.intent === 'handoff' && /human|agent|support|person/.test(text)) {
    return accept(router.handoffNext) || accept(nodes.find((n) => n.type === 'handoff')?.id) || accept(router.fallback);
  }
  return accept(router.fallback);
}

export function validateAiRouteNode(node) {
  if (node.type !== 'ai_route') return;
  normalizeAiRouteNode(node);
}

export function parseAiRouteResponse(payload, allowedDestinations, fallback) {
  const text = payload?.output?.flatMap(item => item.type === 'message' ? item.content || [] : [])
    .find(item => item.type === 'output_text')?.text;
  let value;
  try { value = JSON.parse(text); } catch { return fallback; }
  return allowedDestinations.includes(value?.destination) ? value.destination : fallback;
}

export async function executeAiRoute({ node, input, key = process.env.OPENAI_API_KEY, fetcher = fetch }) {
  const config = normalizeAiRouteNode(node);
  const configuredModels = clean(process.env.AUTOMATION_AI_MODELS).split(',').map(clean).filter(Boolean);
  const allowedModels = configuredModels.length ? configuredModels : [clean(process.env.OPENAI_MODEL)].filter(Boolean);
  if (!key || !allowedModels.includes(config.model)) throw new AppError('AI routing is not configured for this model.', 503, 'AUTOMATION_AI_NOT_CONFIGURED');
  try {
    const response = await fetcher('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model, store: false, max_output_tokens: 80,
        instructions: config.prompt,
        input: JSON.stringify({ customer_message: clean(input?.text).slice(0, 4000), allowed_destinations: config.allowedDestinations }),
        text: { format: { type: 'json_schema', name: 'automation_route', strict: true, schema: {
          type: 'object', properties: { destination: { type: 'string', enum: config.allowedDestinations } },
          required: ['destination'], additionalProperties: false
        } } }
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) return config.fallback;
    return parseAiRouteResponse(await response.json(), config.allowedDestinations, config.fallback);
  } catch {
    return config.fallback;
  }
}

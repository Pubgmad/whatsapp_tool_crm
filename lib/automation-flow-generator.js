import { requireSession } from './auth.js';
import { AppError, errorJson, id, json, query } from './db.js';
import { readJsonBodyLimited } from './security.js';
import { requireWorkspaceManager } from './workspace-permissions.js';
import { assertWorkspaceFeature } from './feature-controls.js';
import { configured, reserveAiDailyRequest } from './ai-support.js';
import { AUTOMATION_NODE_PALETTE } from './automation-canvas-layout.js';
import { autoLayoutNodes } from './automation-canvas-layout.js';

const clean = (value) => String(value || '').trim();
const ALLOWED_TYPES = new Set(AUTOMATION_NODE_PALETTE.map((item) => item.type));

const FALLBACK_PRESETS = Object.freeze({
  lead_qualify: {
    name: 'Lead qualify',
    description: 'Ask intent, capture interest, hand off when needed.',
    triggerMode: 'keywords',
    triggerKeywords: ['hi', 'hello', 'interest', 'demo', 'pricing'],
    nodes: [
      { id: 'n1', type: 'question', body: 'Hi! Are you looking for pricing, a demo, or support?', options: [{ id: 'o1', label: 'Pricing', next: 'n2' }, { id: 'o2', label: 'Demo', next: 'n3' }, { id: 'o3', label: 'Support', next: 'n4' }], next: 'n4' },
      { id: 'n2', type: 'message', body: 'Great — share your company size and we will send pricing.', next: 'n5' },
      { id: 'n3', type: 'message', body: 'Happy to book a demo. What day works best?', next: 'n5' },
      { id: 'n4', type: 'handoff', body: 'Connecting you with a teammate now.', next: '' },
      { id: 'n5', type: 'question', body: 'Anything else we can help with?', options: [{ id: 'o4', label: 'Talk to human', next: 'n4' }, { id: 'o5', label: 'All set', next: '' }], next: '' }
    ]
  },
  support_triage: {
    name: 'Support triage',
    description: 'Route common support topics before human handoff.',
    triggerMode: 'keywords',
    triggerKeywords: ['help', 'support', 'issue', 'problem'],
    nodes: [
      { id: 'n1', type: 'question', body: 'How can we help today?', options: [{ id: 'o1', label: 'Order status', next: 'n2' }, { id: 'o2', label: 'Billing', next: 'n3' }, { id: 'o3', label: 'Other', next: 'n4' }], next: 'n4' },
      { id: 'n2', type: 'message', body: 'Reply with your order ID and we will look it up.', next: 'n4' },
      { id: 'n3', type: 'message', body: 'Share the invoice or last 4 digits of the payment method.', next: 'n4' },
      { id: 'n4', type: 'handoff', body: 'A teammate will continue from here.', next: '' }
    ]
  },
  faq_bot: {
    name: 'FAQ starter',
    description: 'Answer common questions with quick replies.',
    triggerMode: 'any_inbound',
    triggerKeywords: [],
    nodes: [
      { id: 'n1', type: 'question', body: 'Welcome! What would you like to know?', options: [{ id: 'o1', label: 'Hours', next: 'n2' }, { id: 'o2', label: 'Location', next: 'n3' }, { id: 'o3', label: 'Talk to us', next: 'n4' }], next: 'n4' },
      { id: 'n2', type: 'message', body: 'We are open Mon–Sat, 9am–6pm.', next: 'n1' },
      { id: 'n3', type: 'message', body: 'Find us at the address listed on our website profile.', next: 'n1' },
      { id: 'n4', type: 'handoff', body: 'Connecting you with our team.', next: '' }
    ]
  }
});

function sanitizeGeneratedFlow(raw, prompt) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const nodesIn = Array.isArray(source.nodes) ? source.nodes : [];
  const nodes = [];
  const idMap = new Map();
  nodesIn.slice(0, 20).forEach((node, index) => {
    const type = ALLOWED_TYPES.has(node?.type) ? node.type : 'message';
    const nextId = `n${index + 1}`;
    idMap.set(clean(node?.id) || nextId, nextId);
    nodes.push({
      id: nextId,
      type,
      body: clean(node?.body || node?.text).slice(0, 1000) || (type === 'handoff' ? 'Connecting you with a teammate.' : 'Continue'),
      options: Array.isArray(node?.options)
        ? node.options.slice(0, 8).map((opt, optIndex) => ({
            id: `o${index + 1}_${optIndex + 1}`,
            label: clean(opt?.label || opt?.text).slice(0, 80) || `Option ${optIndex + 1}`,
            next: clean(opt?.next)
          }))
        : [],
      next: clean(node?.next),
      inputKind: type === 'question' ? 'buttons' : 'none'
    });
  });
  if (!nodes.length) {
    const preset = FALLBACK_PRESETS.faq_bot;
    return {
      name: preset.name,
      description: preset.description,
      triggerMode: preset.triggerMode,
      triggerKeywords: preset.triggerKeywords,
      nodes: autoLayoutNodes(preset.nodes.map((node) => ({ ...node }))),
      source: 'preset'
    };
  }
  for (const node of nodes) {
    if (node.next) node.next = idMap.get(node.next) || '';
    node.options = (node.options || []).map((opt) => ({
      ...opt,
      next: idMap.get(opt.next) || ''
    }));
  }
  const triggerMode = ['keywords', 'regex', 'any_inbound', 'manual'].includes(source.triggerMode)
    ? source.triggerMode
    : 'keywords';
  const keywords = Array.isArray(source.triggerKeywords)
    ? source.triggerKeywords.map(clean).filter(Boolean).slice(0, 40)
    : clean(prompt)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 2)
        .slice(0, 8);
  return {
    name: clean(source.name).slice(0, 120) || 'AI generated workflow',
    description: clean(source.description).slice(0, 500) || clean(prompt).slice(0, 500),
    triggerMode,
    triggerKeywords: keywords,
    nodes: autoLayoutNodes(nodes),
    source: 'ai'
  };
}

function pickPreset(prompt) {
  const text = prompt.toLowerCase();
  if (/support|help|ticket|issue/.test(text)) return FALLBACK_PRESETS.support_triage;
  if (/lead|demo|pricing|sales/.test(text)) return FALLBACK_PRESETS.lead_qualify;
  return FALLBACK_PRESETS.faq_bot;
}

async function generateWithOpenAi(prompt, key = process.env.OPENAI_API_KEY) {
  const model = clean(process.env.OPENAI_MODEL);
  if (!key || !model) return null;
  const allowed = [...ALLOWED_TYPES];
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: 1200,
      instructions:
        'You design WhatsApp chatbot workflows for a CRM. Return JSON only. Use only allowed node types. Keep copy concise. Always include a handoff path.',
      input: JSON.stringify({
        prompt: prompt.slice(0, 2000),
        allowed_node_types: allowed,
        schema_hint: {
          name: 'string',
          description: 'string',
          triggerMode: 'keywords|any_inbound|manual',
          triggerKeywords: ['string'],
          nodes: [{ id: 'n1', type: 'question|message|handoff|template', body: 'string', options: [{ id: 'o1', label: 'string', next: 'n2' }], next: 'n2' }]
        }
      }),
      text: {
        format: {
          type: 'json_schema',
          name: 'automation_flow',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'description', 'triggerMode', 'triggerKeywords', 'nodes'],
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              triggerMode: { type: 'string', enum: ['keywords', 'regex', 'any_inbound', 'manual'] },
              triggerKeywords: { type: 'array', items: { type: 'string' } },
              nodes: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['id', 'type', 'body', 'options', 'next'],
                  properties: {
                    id: { type: 'string' },
                    type: { type: 'string', enum: allowed },
                    body: { type: 'string' },
                    options: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['id', 'label', 'next'],
                        properties: {
                          id: { type: 'string' },
                          label: { type: 'string' },
                          next: { type: 'string' }
                        }
                      }
                    },
                    next: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) return null;
  const payload = await response.json();
  const text = payload?.output?.flatMap((item) => (item.type === 'message' ? item.content || [] : []))
    .find((item) => item.type === 'output_text')?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function generateAutomationFlow(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    await assertWorkspaceFeature('automation', session.businessId);
    const body = await readJsonBodyLimited(request, 16384);
    const prompt = clean(body.prompt);
    if (!prompt || prompt.length < 8) {
      throw new AppError('Describe the chatbot you want in at least a short sentence.', 400, 'VALIDATION_ERROR');
    }
    if (prompt.length > 2000) {
      throw new AppError('Keep the generator prompt under 2000 characters.', 400, 'VALIDATION_ERROR');
    }

    let raw = null;
    let source = 'preset';
    if (configured()) {
      await reserveAiDailyRequest(session.businessId);
      raw = await generateWithOpenAi(prompt);
      if (raw) source = 'ai';
    }
    if (!raw) {
      const preset = pickPreset(prompt);
      raw = {
        name: preset.name,
        description: `${preset.description} (from: ${prompt.slice(0, 120)})`,
        triggerMode: preset.triggerMode,
        triggerKeywords: preset.triggerKeywords,
        nodes: preset.nodes
      };
      source = 'preset';
    }

    const flow = sanitizeGeneratedFlow(raw, prompt);
    flow.source = source;
    await query(
      `INSERT INTO audit_logs (id,business_id,user_id,action,metadata)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        id('a'),
        session.businessId,
        session.userId,
        'automation_flow_generated',
        JSON.stringify({ source, nodeCount: flow.nodes.length, prompt: prompt.slice(0, 200) })
      ]
    );
    return json({ ok: true, flow, providerAvailable: configured() });
  } catch (error) {
    return errorJson(error);
  }
}

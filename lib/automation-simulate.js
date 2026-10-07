import { AppError } from './db.js';
import { resolveAutomationRoute } from './automation-ai-router.js';

function clean(value) {
  return String(value || '').trim();
}

function normalize(value) {
  return clean(value).toLowerCase();
}

function assertDefinition(definition) {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  if (!nodes.length) throw new AppError('Flow definition must include at least one node.', 400, 'VALIDATION_ERROR');
  const startNodeId = clean(definition.startNodeId || nodes[0]?.id);
  if (!startNodeId || !nodes.some((node) => node.id === startNodeId)) {
    throw new AppError('Flow startNodeId must match one of the node IDs.', 400, 'VALIDATION_ERROR');
  }
  return { startNodeId, nodes };
}

function pickBranch(node, input) {
  const text = normalize(input.text);
  for (const option of node.options || []) {
    const matches = [option.value, option.id, option.label, ...(option.match || [])].map(normalize).filter(Boolean);
    if (matches.some((item) => text === item || text.includes(item))) return option.next || node.next;
  }
  return node.next || node.options?.[0]?.next || '';
}

export function simulateAutomationFlow(definition, input = {}) {
  const def = assertDefinition(definition);
  const values = { ...(input.values && typeof input.values === 'object' ? input.values : {}) };
  const steps = [];
  let current = resolveAutomationRoute(definition, input) || def.startNodeId;
  const visited = new Set();
  while (current && steps.length < 60) {
    if (visited.has(current)) {
      steps.push({ nodeId: current, type: 'cycle', detail: 'Stopped at repeated node.' });
      break;
    }
    visited.add(current);
    const node = def.nodes.find((item) => item.id === current);
    if (!node) throw new AppError('Simulation reached a missing node.', 400, 'FLOW_NODE_NOT_FOUND');
    if (node.captureAs && input.text) values[node.captureAs] = clean(input.text);
    steps.push({
      nodeId: node.id,
      type: node.type,
      body: node.body,
      templateId: node.templateId || '',
      assignedUserId: node.assignedUserId || ''
    });
    if (node.type === 'ai_route') {
      current = resolveAutomationRoute(definition, input) || node.fallback || '';
      continue;
    }
    if (node.type === 'end' || node.type === 'handoff') break;
    if (node.type === 'message' || node.type === 'template') {
      current = node.next;
      continue;
    }
    if (node.type === 'question') {
      const next = pickBranch(node, input);
      steps[steps.length - 1].branchTaken = next || '';
      current = next;
      continue;
    }
    current = node.next || node.falseNext || node.errorNext || '';
  }
  return { steps, values, terminal: steps.at(-1)?.type || 'unknown' };
}

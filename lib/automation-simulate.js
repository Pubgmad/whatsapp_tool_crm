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
  let current = def.startNodeId;
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
      current = resolveAutomationRoute(definition, input, node.id) || node.fallback || '';
      steps[steps.length - 1].branchTaken = current;
      continue;
    }
    if (node.type === 'end' || node.type === 'handoff') break;
    if (['message', 'template', 'single_product', 'multi_product'].includes(node.type)) {
      current = node.next;
      continue;
    }
    if (node.type === 'question' || node.type === 'section_list') {
      const next = pickBranch(node, input);
      steps[steps.length - 1].branchTaken = next || '';
      current = next;
      continue;
    }
    if (node.type === 'attribute_condition') {
      const present = Object.hasOwn(values, node.attribute) && values[node.attribute] !== null;
      const actual = values[node.attribute];
      const matches = { exists: present, not_exists: !present, equals: actual === node.compareValue, not_equals: actual !== node.compareValue,
        contains: typeof actual === 'string' && actual.includes(String(node.compareValue)), gt: actual > node.compareValue,
        gte: actual >= node.compareValue, lt: actual < node.compareValue, lte: actual <= node.compareValue }[node.operator] === true;
      current = matches ? node.next : node.falseNext;
      steps[steps.length - 1].branchTaken = current;
      continue;
    }
    if (node.type === 'api_request') {
      const outcome = clean(input.apiOutcome || 'success').toLowerCase();
      const status = Number(input.apiStatus || 200);
      if (outcome === 'timeout') current = node.timeoutNext;
      else if (outcome === 'error') current = node.errorNext;
      else current = (node.statusBranches || []).find(item => item.status === String(status))?.next
        || (node.statusBranches || []).find(item => item.status === `${Math.floor(status / 100)}xx`)?.next
        || (status >= 200 && status < 300 ? node.next : node.errorNext);
      steps[steps.length - 1].branchTaken = current;
      steps[steps.length - 1].status = status;
      continue;
    }
    if (['set_contact_attribute', 'order_lookup', 'set_order_status'].includes(node.type)) {
      current = clean(input.advancedOutcome).toLowerCase() === 'error' ? node.errorNext : node.next;
      steps[steps.length - 1].branchTaken = current;
      continue;
    }
    current = node.next || node.falseNext || node.errorNext || '';
  }
  return { steps, values, terminal: steps.at(-1)?.type || 'unknown' };
}

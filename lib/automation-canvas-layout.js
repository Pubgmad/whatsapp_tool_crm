/** Pure layout helpers for the automation visual canvas (no React). */

export const NODE_W = 220;
export const NODE_H = 88;
export const GRID = 24;

export const AUTOMATION_NODE_PALETTE = Object.freeze([
  { type: 'question', label: 'Question', group: 'Chat' },
  { type: 'message', label: 'Message', group: 'Chat' },
  { type: 'template', label: 'Template', group: 'Chat' },
  { type: 'section_list', label: 'Section list', group: 'Chat' },
  { type: 'send_native_flow', label: 'Native Flow', group: 'Meta' },
  { type: 'send_webview_cta', label: 'Hosted page CTA', group: 'Meta' },
  { type: 'single_product', label: 'Single product', group: 'Commerce' },
  { type: 'multi_product', label: 'Multi product', group: 'Commerce' },
  { type: 'attribute_condition', label: 'Condition', group: 'Logic' },
  { type: 'set_contact_attribute', label: 'Set field', group: 'Logic' },
  { type: 'api_request', label: 'API request', group: 'Logic' },
  { type: 'order_lookup', label: 'Order lookup', group: 'Logic' },
  { type: 'set_order_status', label: 'Order status', group: 'Logic' },
  { type: 'ai_route', label: 'AI route', group: 'AI' },
  { type: 'handoff', label: 'Handoff', group: 'End' },
  { type: 'end', label: 'End', group: 'End' }
]);

export function snapToGrid(value, grid = GRID) {
  return Math.round(Number(value) / grid) * grid;
}

export function defaultNodePosition(index) {
  const col = index % 3;
  const row = Math.floor(index / 3);
  return { canvasX: 48 + col * (NODE_W + 72), canvasY: 48 + row * (NODE_H + 56) };
}

export function ensureNodePositions(nodes) {
  return (nodes || []).map((node, index) => {
    const hasX = Number.isFinite(Number(node.canvasX));
    const hasY = Number.isFinite(Number(node.canvasY));
    if (hasX && hasY) {
      return {
        ...node,
        canvasX: snapToGrid(node.canvasX),
        canvasY: snapToGrid(node.canvasY)
      };
    }
    const pos = defaultNodePosition(index);
    return { ...node, ...pos };
  });
}

export function collectEdges(nodes) {
  const edges = [];
  for (const node of nodes || []) {
    if (node.next) edges.push({ id: `${node.id}->next->${node.next}`, from: node.id, to: node.next, kind: 'next', label: 'next' });
    if (node.falseNext) edges.push({ id: `${node.id}->false->${node.falseNext}`, from: node.id, to: node.falseNext, kind: 'false', label: 'false' });
    if (node.errorNext) edges.push({ id: `${node.id}->error->${node.errorNext}`, from: node.id, to: node.errorNext, kind: 'error', label: 'error' });
    if (node.timeoutNext) edges.push({ id: `${node.id}->timeout->${node.timeoutNext}`, from: node.id, to: node.timeoutNext, kind: 'timeout', label: 'timeout' });
    for (const option of node.options || []) {
      if (option.next) edges.push({ id: `${node.id}->opt:${option.id}->${option.next}`, from: node.id, to: option.next, kind: 'option', label: option.label || option.id });
    }
    for (const branch of node.statusBranches || []) {
      if (branch?.next) edges.push({ id: `${node.id}->status:${branch.status || ''}->${branch.next}`, from: node.id, to: branch.next, kind: 'status', label: branch.status || 'status' });
    }
    for (const dest of node.allowedDestinations || []) {
      if (dest) edges.push({ id: `${node.id}->ai->${dest}`, from: node.id, to: dest, kind: 'ai', label: 'AI' });
    }
  }
  return edges;
}

export function edgePath(fromNode, toNode, offsetIndex = 0) {
  const x1 = Number(fromNode.canvasX) + NODE_W;
  const y1 = Number(fromNode.canvasY) + NODE_H / 2 + offsetIndex * 10;
  const x2 = Number(toNode.canvasX);
  const y2 = Number(toNode.canvasY) + NODE_H / 2;
  const dx = Math.max(48, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export function canvasBounds(nodes, padding = 160) {
  if (!nodes?.length) return { width: 960, height: 560, minX: 0, minY: 0 };
  let maxX = 0;
  let maxY = 0;
  for (const node of nodes) {
    maxX = Math.max(maxX, Number(node.canvasX) + NODE_W);
    maxY = Math.max(maxY, Number(node.canvasY) + NODE_H);
  }
  return { width: Math.max(960, maxX + padding), height: Math.max(560, maxY + padding), minX: 0, minY: 0 };
}

export function autoLayoutNodes(nodes) {
  const positioned = ensureNodePositions(nodes);
  const byId = new Map(positioned.map((node) => [node.id, node]));
  const startId = positioned[0]?.id;
  const depth = new Map();
  const visit = (id, level) => {
    if (!id || !byId.has(id)) return;
    if (depth.has(id) && depth.get(id) <= level) return;
    depth.set(id, level);
    const node = byId.get(id);
    const nexts = [
      node.next,
      node.falseNext,
      node.errorNext,
      node.timeoutNext,
      ...(node.options || []).map((o) => o.next),
      ...(node.statusBranches || []).map((b) => b?.next),
      ...(node.allowedDestinations || [])
    ].filter(Boolean);
    for (const next of nexts) visit(next, level + 1);
  };
  if (startId) visit(startId, 0);
  positioned.forEach((node, index) => {
    if (!depth.has(node.id)) depth.set(node.id, Math.floor(index / 2) + 1);
  });
  const columns = new Map();
  for (const [id, level] of depth) {
    if (!columns.has(level)) columns.set(level, []);
    columns.get(level).push(id);
  }
  return positioned.map((node) => {
    const level = depth.get(node.id) || 0;
    const siblings = columns.get(level) || [node.id];
    const row = siblings.indexOf(node.id);
    return {
      ...node,
      canvasX: snapToGrid(48 + level * (NODE_W + 96)),
      canvasY: snapToGrid(48 + row * (NODE_H + 64))
    };
  });
}

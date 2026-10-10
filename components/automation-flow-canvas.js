'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, GripVertical, Maximize2, Plus, Trash2, Workflow } from 'lucide-react';
import {
  AUTOMATION_NODE_PALETTE,
  NODE_H,
  NODE_W,
  autoLayoutNodes,
  canvasBounds,
  collectEdges,
  edgePath,
  ensureNodePositions,
  snapToGrid
} from '../lib/automation-canvas-layout.js';
import './automation-flow-canvas.css';

function nodeTitle(type) {
  return AUTOMATION_NODE_PALETTE.find((item) => item.type === type)?.label || type;
}

export default function AutomationFlowCanvas({
  nodes,
  startNodeId,
  selectedId,
  onSelect,
  onNodesChange,
  onAddNode,
  onRemoveNode,
  onConnect,
  connectingFrom,
  onStartConnect,
  onCancelConnect
}) {
  const surfaceRef = useRef(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [draggingId, setDraggingId] = useState('');
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panOrigin = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const positioned = useMemo(() => ensureNodePositions(nodes), [nodes]);
  const edges = useMemo(() => collectEdges(positioned), [positioned]);
  const bounds = useMemo(() => canvasBounds(positioned), [positioned]);
  const byId = useMemo(() => new Map(positioned.map((node) => [node.id, node])), [positioned]);

  useEffect(() => {
    const dirty = nodes.some((node, index) => {
      const next = positioned[index];
      return node.canvasX !== next.canvasX || node.canvasY !== next.canvasY;
    });
    if (dirty) onNodesChange(positioned);
    // Only sync missing positions once when nodes lack coordinates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length]);

  const moveNode = (nodeId, clientX, clientY) => {
    const surface = surfaceRef.current?.getBoundingClientRect();
    if (!surface) return;
    const x = snapToGrid((clientX - surface.left - pan.x) / zoom - dragOffset.x);
    const y = snapToGrid((clientY - surface.top - pan.y) / zoom - dragOffset.y);
    onNodesChange(
      positioned.map((node) => (node.id === nodeId ? { ...node, canvasX: Math.max(0, x), canvasY: Math.max(0, y) } : node))
    );
  };

  const onPaletteDrop = (event) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/x-automation-node-type') || event.dataTransfer.getData('text/plain');
    if (!type) return;
    const surface = surfaceRef.current?.getBoundingClientRect();
    if (!surface) return;
    const canvasX = snapToGrid((event.clientX - surface.left - pan.x) / zoom - NODE_W / 2);
    const canvasY = snapToGrid((event.clientY - surface.top - pan.y) / zoom - NODE_H / 2);
    onAddNode(type, { canvasX: Math.max(0, canvasX), canvasY: Math.max(0, canvasY) });
  };

  const edgeOffsets = new Map();
  const paths = edges
    .map((edge) => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) return null;
      const key = `${edge.from}->${edge.to}`;
      const offset = edgeOffsets.get(key) || 0;
      edgeOffsets.set(key, offset + 1);
      return { ...edge, d: edgePath(from, to, offset) };
    })
    .filter(Boolean);

  return (
    <div className="automationCanvasShell" aria-label="Automation visual canvas">
      <aside className="automationPalette">
        <header>
          <Workflow size={16} />
          <strong>Node palette</strong>
          <span>Drag onto the canvas</span>
        </header>
        <div className="automationPaletteGroups">
          {['Chat', 'Meta', 'Commerce', 'Logic', 'AI', 'End'].map((group) => (
            <div key={group} className="automationPaletteGroup">
              <small>{group}</small>
              {AUTOMATION_NODE_PALETTE.filter((item) => item.group === group).map((item) => (
                <button
                  key={item.type}
                  type="button"
                  className="automationPaletteItem"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/x-automation-node-type', item.type);
                    event.dataTransfer.setData('text/plain', item.type);
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onAddNode(item.type)}
                >
                  <Plus size={14} />
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="automationCanvasTools">
          <button type="button" className="secondaryAction" onClick={() => onNodesChange(autoLayoutNodes(positioned))}>
            <Maximize2 size={15} /> Auto-layout
          </button>
          <button type="button" className="secondaryAction" onClick={() => { setPan({ x: 0, y: 0 }); setZoom(1); }}>
            Reset view
          </button>
          {connectingFrom && (
            <button type="button" className="secondaryAction" onClick={onCancelConnect}>
              Cancel wire
            </button>
          )}
        </div>
        {connectingFrom && (
          <p className="automationConnectHint" role="status">
            Wiring from <strong>{connectingFrom}</strong> — click a target node to connect.
          </p>
        )}
      </aside>

      <div
        className={`automationCanvasSurface${panning ? ' isPanning' : ''}${connectingFrom ? ' isWiring' : ''}`}
        ref={surfaceRef}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onPaletteDrop}
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          setZoom((current) => Math.min(1.6, Math.max(0.55, current + (event.deltaY > 0 ? -0.06 : 0.06))));
        }}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget && !event.target.classList?.contains('automationCanvasWorld')) return;
          setPanning(true);
          panOrigin.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!panning) return;
          setPan({
            x: panOrigin.current.panX + (event.clientX - panOrigin.current.x),
            y: panOrigin.current.panY + (event.clientY - panOrigin.current.y)
          });
        }}
        onPointerUp={() => setPanning(false)}
        onPointerCancel={() => setPanning(false)}
      >
        <div
          className="automationCanvasWorld"
          style={{
            width: bounds.width,
            height: bounds.height,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
          }}
        >
          <svg className="automationCanvasEdges" width={bounds.width} height={bounds.height} aria-hidden="true">
            {paths.map((edge) => (
              <g key={edge.id}>
                <path d={edge.d} className={`automationEdge automationEdge-${edge.kind}`} />
                {edge.label && edge.kind !== 'next' && (
                  <text className="automationEdgeLabel">
                    <textPath href={`#${edge.id}`} startOffset="50%">
                      {edge.label}
                    </textPath>
                  </text>
                )}
              </g>
            ))}
          </svg>

          {positioned.map((node) => {
            const isStart = node.id === startNodeId || (!startNodeId && node.id === positioned[0]?.id);
            return (
              <article
                key={node.id}
                className={`automationCanvasNode${selectedId === node.id ? ' isSelected' : ''}${draggingId === node.id ? ' isDragging' : ''}${isStart ? ' isStart' : ''}`}
                style={{ left: node.canvasX, top: node.canvasY, width: NODE_W, minHeight: NODE_H }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (connectingFrom) {
                    if (connectingFrom !== node.id) onConnect(connectingFrom, node.id);
                    return;
                  }
                  onSelect(node.id);
                }}
              >
                <header
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    const surface = surfaceRef.current?.getBoundingClientRect();
                    if (!surface) return;
                    setDraggingId(node.id);
                    setDragOffset({
                      x: (event.clientX - surface.left - pan.x) / zoom - node.canvasX,
                      y: (event.clientY - surface.top - pan.y) / zoom - node.canvasY
                    });
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (draggingId !== node.id) return;
                    moveNode(node.id, event.clientX, event.clientY);
                  }}
                  onPointerUp={() => setDraggingId('')}
                >
                  <GripVertical size={14} />
                  <div>
                    <strong>{node.id}</strong>
                    <span>{nodeTitle(node.type)}{isStart ? ' · start' : ''}</span>
                  </div>
                  <button
                    type="button"
                    className="iconButton dangerSoft"
                    title="Remove node"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveNode(node.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </header>
                <p>{node.body?.trim() || node.nativeFlowId || node.webviewId || node.templateId || 'Configure in inspector'}</p>
                <footer>
                  <button
                    type="button"
                    className="automationWireButton"
                    title="Drag wire / click then target"
                    onClick={(event) => {
                      event.stopPropagation();
                      onStartConnect(node.id);
                    }}
                  >
                    <GitBranch size={13} /> Wire next
                  </button>
                </footer>
              </article>
            );
          })}

          {!positioned.length && (
            <div className="automationCanvasEmpty">
              <p>Drag a node from the palette to start your flow graph.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

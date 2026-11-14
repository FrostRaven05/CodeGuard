import { useId, useMemo, useState, type ReactNode } from 'react';
import { GitBranch } from 'lucide-react';
import type { CodeLocation, ReviewFlow } from './types';

export function FlowDiagram({
  flow,
  renderLocation,
}: {
  flow: ReviewFlow;
  renderLocation: (location: CodeLocation) => ReactNode;
}) {
  const marker = useId().replaceAll(':', '');
  const [selected, setSelected] = useState(flow.nodes[0].id);
  const [zoom, setZoom] = useState(1);
  const layout = useMemo(() => {
    const indegree = new Map(flow.nodes.map((node) => [node.id, 0]));
    const ranks = new Map(flow.nodes.map((node) => [node.id, 0]));
    for (const edge of flow.edges) indegree.set(edge.to, indegree.get(edge.to)! + 1);
    const queue = flow.nodes.filter((node) => !indegree.get(node.id)).map((node) => node.id);
    let visited = 0;
    while (queue.length) {
      const id = queue.shift()!;
      visited++;
      for (const edge of flow.edges.filter((edge) => edge.from === id)) {
        ranks.set(edge.to, Math.max(ranks.get(edge.to)!, ranks.get(id)! + 1));
        indegree.set(edge.to, indegree.get(edge.to)! - 1);
        if (!indegree.get(edge.to)) queue.push(edge.to);
      }
    }
    if (visited !== flow.nodes.length)
      flow.nodes.forEach((node, index) => ranks.set(node.id, index));
    const levels = Array.from({ length: Math.max(...ranks.values()) + 1 }, (_, rank) =>
      flow.nodes.filter((node) => ranks.get(node.id) === rank),
    );
    const heightOf = (label: string) => 70 + Math.ceil(label.length / 17) * 22;
    const width = Math.max(336, Math.max(...levels.map((level) => level.length)) * 312 + 24);
    const positions = new Map<string, { x: number; y: number; height: number }>();
    let y = 30;
    for (const level of levels) {
      level.forEach((node, index) =>
        positions.set(node.id, {
          x: (width - level.length * 312) / 2 + 16 + index * 312,
          y,
          height: heightOf(node.label),
        }),
      );
      y += Math.max(...level.map((node) => heightOf(node.label))) + 74;
    }
    return { positions, width, height: y - 44 };
  }, [flow]);
  const node = flow.nodes.find((node) => node.id === selected) || flow.nodes[0];
  const related = flow.edges.filter((edge) => edge.from === node.id || edge.to === node.id);
  return (
    <section className="visual-flow-card">
      <div className="visual-section-heading">
        <h3>
          <GitBranch size={16} />
          {flow.title}
        </h3>
        <div className="flow-zoom">
          <button
            aria-label="缩小流程图"
            disabled={zoom <= 0.7}
            onClick={() => setZoom((value) => Math.max(0.7, value - 0.15))}
          >
            −
          </button>
          <button aria-label="重置流程图缩放" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button
            aria-label="放大流程图"
            disabled={zoom >= 1.45}
            onClick={() => setZoom((value) => Math.min(1.45, value + 0.15))}
          >
            ＋
          </button>
        </div>
      </div>
      <div className="flow-viewport" role="region" aria-label={flow.title} tabIndex={0}>
        <div style={{ width: layout.width * zoom, height: layout.height * zoom, margin: '0 auto' }}>
          <div
            className="flow-canvas"
            style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}
          >
            <svg width={layout.width} height={layout.height} aria-hidden="true">
              <defs>
                <marker
                  id={marker}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M0 0L10 5L0 10Z" fill="#86a5bc" />
                </marker>
              </defs>
              {flow.edges.map((edge, index) => {
                const from = layout.positions.get(edge.from)!,
                  to = layout.positions.get(edge.to)!;
                const x = from.x + 140,
                  y = from.y + from.height,
                  tx = to.x + 140,
                  ty = to.y - 5;
                return (
                  <g key={index}>
                    <path
                      className={selected === edge.from || selected === edge.to ? 'active' : ''}
                      d={`M${x} ${y}C${x} ${y + 36},${tx} ${ty - 36},${tx} ${ty}`}
                      markerEnd={`url(#${marker})`}
                    />
                    <text x={(x + tx) / 2 + 10} y={(y + ty) / 2} textAnchor="start">
                      <title>{edge.label}</title>
                      {edge.label.length > 22 ? `${edge.label.slice(0, 22)}…` : edge.label}
                    </text>
                  </g>
                );
              })}
            </svg>
            {flow.nodes.map((item, index) => {
              const position = layout.positions.get(item.id)!;
              return (
                <button
                  key={item.id}
                  className={`flow-node ${item.kind} ${node.id === item.id ? 'selected' : ''}`}
                  style={{ left: position.x, top: position.y, height: position.height }}
                  aria-pressed={node.id === item.id}
                  onClick={() => setSelected(item.id)}
                >
                  <small>
                    {String(index + 1).padStart(2, '0')} ·{' '}
                    {item.kind === 'decision'
                      ? '条件判断'
                      : item.kind === 'start'
                        ? '入口'
                        : item.kind === 'end'
                          ? '结果'
                          : '处理'}
                  </small>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flow-node-detail">
        <strong>{node.label}</strong>
        {node.location ? (
          <>
            {renderLocation(node.location)}
            <pre>{node.location.evidence}</pre>
          </>
        ) : (
          <p>行为说明节点，无独立代码位置。</p>
        )}
        {related.map((edge, index) => (
          <p className="flow-relation" key={index}>
            {flow.nodes.find((item) => item.id === edge.from)?.label} →{' '}
            {flow.nodes.find((item) => item.id === edge.to)?.label}
            {edge.label && ` · ${edge.label}`}
          </p>
        ))}
      </div>
    </section>
  );
}

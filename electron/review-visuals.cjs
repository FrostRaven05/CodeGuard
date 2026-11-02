const { diffLines } = require('./review-evidence.cjs');

function normalizeVisuals(input, files) {
  const visuals = { changes: [], flows: [] };
  let visualsRejected = 0;
  const text = (value, limit) => typeof value === 'string' && value.trim() && value.length <= limit;
  const maps = new Map(files.map((file) => [file.path, diffLines(file.text)]));
  const location = (value) => {
    if (
      !value ||
      !text(value.evidence, 3000) ||
      !['old', 'new'].includes(value.side) ||
      !Number.isSafeInteger(value.line) ||
      value.line < 1
    )
      return null;
    const lines = maps.get(value.path)?.[value.side];
    if (
      !lines ||
      !value.evidence
        .trim()
        .split('\n')
        .every((line, index) => lines.get(value.line + index)?.trim() === line.trim())
    )
      return null;
    return { path: value.path, side: value.side, line: value.line, evidence: value.evidence };
  };
  if (input === undefined) return { visuals, visualsRejected };
  if (
    !input ||
    typeof input !== 'object' ||
    JSON.stringify(input).length > 40000 ||
    !Array.isArray(input.changes) ||
    !Array.isArray(input.flows) ||
    input.changes.length > 8 ||
    input.flows.length > 3
  )
    return { visuals, visualsRejected: 1 };
  for (const change of input.changes) {
    const citation = location(change?.location);
    if (
      !change ||
      !text(change.title, 120) ||
      !text(change.before, 1000) ||
      !text(change.after, 1000) ||
      !citation
    ) {
      visualsRejected++;
      continue;
    }
    visuals.changes.push({
      title: change.title,
      before: change.before,
      after: change.after,
      location: citation,
    });
  }
  for (const flow of input.flows) {
    if (
      !flow ||
      !text(flow.title, 120) ||
      !Array.isArray(flow.nodes) ||
      !Array.isArray(flow.edges) ||
      flow.nodes.length < 2 ||
      flow.nodes.length > 12 ||
      flow.edges.length > 24
    ) {
      visualsRejected++;
      continue;
    }
    const nodes = [],
      ids = new Set();
    let valid = true;
    for (const node of flow.nodes) {
      const citation = location(node?.location);
      if (
        !node ||
        !text(node.id, 40) ||
        !/^[a-zA-Z0-9_-]+$/.test(node.id) ||
        ids.has(node.id) ||
        !text(node.label, 160) ||
        !['start', 'step', 'decision', 'end'].includes(node.kind) ||
        (node.location != null && !citation)
      ) {
        valid = false;
        break;
      }
      ids.add(node.id);
      nodes.push({ id: node.id, label: node.label, kind: node.kind, location: citation });
    }
    const edges = [],
      seen = new Set();
    for (const edge of flow.edges) {
      if (
        !edge ||
        !ids.has(edge.from) ||
        !ids.has(edge.to) ||
        edge.from === edge.to ||
        (edge.label !== undefined && (typeof edge.label !== 'string' || edge.label.length > 80))
      ) {
        valid = false;
        break;
      }
      const key = `${edge.from}:${edge.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: edge.from, to: edge.to, label: edge.label || '' });
    }
    const linked = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
    if (
      !valid ||
      !nodes.some((node) => node.location) ||
      nodes.some((node) => !linked.has(node.id))
    ) {
      visualsRejected++;
      continue;
    }
    visuals.flows.push({ title: flow.title, nodes, edges });
  }
  return { visuals, visualsRejected };
}

module.exports = { normalizeVisuals };

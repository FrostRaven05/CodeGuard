import type { Commit } from './types';

export const graphColors = ['#a995f2', '#6cd7b2', '#e8b56b', '#79b9e6', '#e28fb2', '#a7c984'];
export interface GraphRow {
  lane: number;
  color: string;
  incoming: boolean;
  edges: { from: number; to: number; color: string; current: boolean }[];
}

export function layoutGraph(commits: Commit[]) {
  let lanes: string[] = [];
  let width = 1;
  const rows: GraphRow[] = [];
  for (const commit of commits) {
    const incoming = lanes.includes(commit.hash);
    if (!incoming) lanes.push(commit.hash);
    const before = [...lanes],
      lane = lanes.indexOf(commit.hash);
    const after = [...lanes];
    after.splice(lane, 1);
    let insertion = lane;
    for (const parent of commit.parents)
      if (!after.includes(parent)) after.splice(insertion++, 0, parent);
    const edges: GraphRow['edges'] = [];
    before.forEach((sha, index) => {
      if (sha !== commit.hash && after.includes(sha))
        edges.push({
          from: index,
          to: after.indexOf(sha),
          color: graphColors[index % graphColors.length],
          current: false,
        });
    });
    commit.parents.forEach((parent) =>
      edges.push({
        from: lane,
        to: after.indexOf(parent),
        color: graphColors[lane % graphColors.length],
        current: true,
      }),
    );
    rows.push({ lane, incoming, color: graphColors[lane % graphColors.length], edges });
    width = Math.max(width, before.length, after.length);
    lanes = after;
  }
  return { rows, width: Math.max(66, width * 18 + 24) };
}

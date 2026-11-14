// Split only on complete diff rows, retaining the original version coordinates.
function fitDiff(text, budget) {
  if (JSON.stringify(text).length <= budget) return { text, partial: false };
  const chunks = [];
  let old = 0,
    fresh = 0,
    rows = [],
    startOld = 0,
    startNew = 0,
    active = false;
  const flush = () => {
    if (!rows.length) return;
    const oldCount = rows.filter((row) => !row.startsWith('+')).length;
    const newCount = rows.filter((row) => !row.startsWith('-')).length;
    chunks.push(`@@ -${startOld},${oldCount} +${startNew},${newCount} @@\n${rows.join('\n')}\n`);
    rows = [];
  };
  for (const row of text.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (hunk) {
      flush();
      old = Number(hunk[1]);
      fresh = Number(hunk[2]);
      active = true;
      continue;
    }
    if (!active || !/^[ +\-]/.test(row)) continue;
    if (
      rows.length &&
      JSON.stringify(rows.join('\n') + row).length >
        Math.max(180, Math.min(1600, Math.floor((budget - 120) / 3)))
    )
      flush();
    if (!rows.length) {
      startOld = old;
      startNew = fresh;
    }
    rows.push(row);
    if (!row.startsWith('+')) old++;
    if (!row.startsWith('-')) fresh++;
  }
  flush();
  // Breadth first sampling covers the beginning, middle and end of a large diff.
  const order = [],
    queue = [[0, chunks.length - 1]];
  if (chunks.length) order.push(0);
  if (chunks.length > 1) order.push(chunks.length - 1);
  while (queue.length) {
    const [from, to] = queue.shift();
    if (to - from < 2) continue;
    const middle = Math.floor((from + to) / 2);
    order.push(middle);
    queue.push([from, middle], [middle, to]);
  }
  const selected = [];
  for (const index of order) {
    const next = [...selected, index].sort((a, b) => a - b);
    if (JSON.stringify(next.map((i) => chunks[i]).join('')).length <= budget) selected.push(index);
  }
  return {
    text: selected
      .sort((a, b) => a - b)
      .map((i) => chunks[i])
      .join(''),
    partial: true,
  };
}

module.exports = { fitDiff };

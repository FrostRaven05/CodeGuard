const path = require('node:path');

const source = /\.(?:[cm]?[jt]sx?|py)$/i;
const declaration =
  /^\s*(?:(?:export|default|async|static|public|private)\s+)*(?:(?:function|def)\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|(?:\([^)]*\)|[\w$]+)\s*=>))/;
const LIMITATION =
  '固定版本的附近文本与引用片段，合并重叠范围，按文件和版本共享预算；大文件最多读取 1 MB，只发送必要片段。相关引用扫描最多 80 个候选；文本匹配不证明调用关系，未纳入部分单独记录。';

function changedLines(diff, side) {
  const result = [];
  let line = 0,
    active = false;
  for (const row of diff.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (header) {
      line = Number(header[side === 'old' ? 1 : 2]);
      active = true;
      continue;
    }
    if (!active) continue;
    if (row.startsWith(side === 'old' ? '-' : '+')) result.push(line++);
    else if (row.startsWith(' ')) line++;
  }
  return result;
}

function enclosing(lines, at) {
  let start = Math.max(0, at - 16);
  for (let i = at; i >= Math.max(0, at - 100); i--) {
    if (declaration.test(lines[i])) {
      start = i;
      break;
    }
  }
  let end = Math.min(lines.length, at + 25);
  for (let i = at + 1; i < Math.min(lines.length, start + 120); i++) {
    if (declaration.test(lines[i]) && !/^\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [start, Math.min(end, start + 120)];
}

async function collectContext(git, snapshot, files, excluded, patterns, budget, blockedPaths) {
  const contexts = [],
    skipped = [],
    withheldPaths = new Set(blockedPaths),
    candidates = [];
  const notes = new Set();
  const note = (relative, reason) => {
    const key = `${relative}:${reason}`;
    if (!notes.has(key)) {
      notes.add(key);
      skipped.push({ path: relative, reason });
    }
  };
  const propose = (relative, side, lines, range, kind, focus) => {
    const [start, end] = range;
    if (end <= start) return;
    const overlaps = candidates.filter(
      (item) =>
        item.path === relative && item.side === side && item.start <= end && item.end >= start,
    );
    if (overlaps.length) {
      const item = overlaps[0];
      item.start = Math.min(start, ...overlaps.map((x) => x.start));
      item.end = Math.max(end, ...overlaps.map((x) => x.end));
      for (const other of overlaps.slice(1)) candidates.splice(candidates.indexOf(other), 1);
    } else candidates.push({ path: relative, side, lines, start, end, kind, focus });
  };
  const references = [];
  for (const side of ['new', 'old']) {
    const symbols = new Set(),
      directories = new Set(),
      own = new Set();
    for (const file of files) {
      const positions = changedLines(file.text, side);
      if (!positions.length) continue;
      const relative = side === 'old' ? file.previousPath || file.path : file.path;
      own.add(relative);
      directories.add(path.posix.dirname(relative));
      const blob = await git.readReviewBlob(snapshot, relative, side, 1000000);
      if (blob.reason) {
        note(relative, blob.reason);
        continue;
      }
      const lines = blob.text.split('\n');
      if (lines.at(-1) === '') lines.pop();
      const ranges = [];
      for (const line of positions) {
        const range = source.test(relative)
          ? enclosing(lines, line - 1)
          : [Math.max(0, line - 9), Math.min(lines.length, line + 12)];
        if (ranges.some((item) => range[0] <= item[1] && range[1] >= item[0])) {
          const item = ranges.find((item) => range[0] <= item[1] && range[1] >= item[0]);
          item[0] = Math.min(item[0], range[0]);
          item[1] = Math.max(item[1], range[1]);
        } else ranges.push([...range, line - 1]);
      }
      const chosen =
        ranges.length <= 12
          ? ranges
          : Array.from(
              { length: 12 },
              (_, i) => ranges[Math.floor((i * (ranges.length - 1)) / 11)],
            );
      if (ranges.length > 12) note(relative, '改动区域较多，已选取分散的 12 个附近区域');
      for (const [start, end, focus] of chosen) {
        const match = declaration.exec(lines[start] || '');
        if (match) symbols.add(match[1] || match[2]);
        propose(
          relative,
          side,
          lines,
          [start, end],
          match ? '改动所在函数附近（启发式）' : '改动附近文本',
          focus,
        );
      }
    }
    if (!symbols.size) continue;
    let paths;
    try {
      paths = await git.reviewTreePaths(snapshot, side);
    } catch {
      note('相关文件扫描', '无法列出固定版本');
      continue;
    }
    const related = paths.filter(
      (relative) =>
        source.test(relative) &&
        !own.has(relative) &&
        (directories.has(path.posix.dirname(relative)) ||
          /(?:^|\/)(?:tests?|__tests__)(?:\/|\.)|\.(?:test|spec)\./i.test(relative)),
    );
    if (related.length > 80)
      note(
        '相关文件扫描',
        `${side === 'old' ? '父版本' : '当前版本'}相关候选 ${related.length} 个，仅扫描 80 个`,
      );
    references.push({ side, symbols, paths: related.slice(0, 80) });
  }
  for (const { side, symbols, paths } of references)
    for (const relative of paths) {
      if (excluded(relative, patterns) || blockedPaths.has(relative)) {
        withheldPaths.add(relative);
        note(
          relative,
          excluded(relative, patterns)
            ? '上下文排除规则或敏感路径'
            : '本轮差异未纳入，未扩展该文件上下文',
        );
        continue;
      }
      const blob = await git.readReviewBlob(snapshot, relative, side, 1000000);
      if (blob.reason) {
        withheldPaths.add(relative);
        note(relative, blob.reason);
        continue;
      }
      const lines = blob.text.split('\n');
      if (lines.at(-1) === '') lines.pop();
      let matches = 0;
      for (let i = 0; i < lines.length && matches < 3; i++) {
        if (
          ![...symbols].some((symbol) =>
            new RegExp(`\\b${symbol.replace(/\$/g, '\\$')}\\s*\\(`).test(lines[i]),
          )
        )
          continue;
        propose(
          relative,
          side,
          lines,
          [Math.max(0, i - 4), Math.min(lines.length, i + 7)],
          /(?:test|spec)/i.test(relative) ? '相关测试（文本匹配）' : '直接引用（文本匹配）',
          i,
        );
        matches++;
      }
    }
  const groups = new Map();
  for (const item of candidates) {
    const key = `${item.path}:${item.side}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  let remaining = budget;
  while ([...groups.values()].some((items) => items.length)) {
    const active = [...groups.values()].filter((items) => items.length);
    const allowance = Math.floor(
      remaining / active.reduce((count, items) => count + items.length, 0),
    );
    for (const items of active) {
      const item = items.shift();
      let start = item.start,
        end = item.end;
      const entry = () => ({
        path: item.path,
        side: item.side,
        revision: item.side === 'old' ? snapshot.head : snapshot.tree,
        startLine: start + 1,
        endLine: end,
        kind: item.kind,
        text: item.lines.slice(start, end).join('\n'),
      });
      while (end > start + 1 && JSON.stringify(entry()).length > allowance) {
        if (item.focus - start > end - item.focus - 1) start++;
        else end--;
      }
      const value = entry(),
        size = JSON.stringify(value).length;
      if (size <= remaining && size <= allowance) {
        remaining -= size;
        contexts.push(value);
        if (start > item.start || end < item.end)
          note(item.path, '附近上下文已精简，部分片段未纳入预算');
      } else note(item.path, '部分相关片段未纳入预算');
    }
  }
  return { contexts, skipped, withheldPaths, used: budget - remaining, limitation: LIMITATION };
}
module.exports = { collectContext, changedLines, LIMITATION };

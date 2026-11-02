const path = require('node:path');

const source = /\.(?:[cm]?[jt]sx?|py)$/i;
const declaration =
  /^\s*(?:(?:export|default|async|static|public|private)\s+)*(?:(?:function|def)\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|(?:\([^)]*\)|[\w$]+)\s*=>))/;
const LIMITATION =
  '启发式文本关联，仅支持 TS/JS、Python。每文件取前 12 个改动位置附近（每段最多 120 行），每版本扫描同目录源码及测试候选前 40 个文件，每文件最多 3 处引用。上下文最多占总预算三分之一；不证明调用关系，不保证完整函数或全仓库覆盖。';

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
    seen = new Set(),
    withheldPaths = new Set(blockedPaths);
  for (const file of files)
    if (!source.test(file.path))
      skipped.push({ path: file.path, reason: '此语言暂不自动关联上下文，仍评审已纳入的差异' });
  let remaining = budget;
  const add = (relative, side, text, range, kind) => {
    const [start, end] = range,
      key = `${relative}:${side}:${start}:${end}`;
    if (seen.has(key) || end <= start) return;
    seen.add(key);
    const item = {
      path: relative,
      side,
      revision: side === 'old' ? snapshot.head : snapshot.tree,
      startLine: start + 1,
      endLine: end,
      kind,
      text: text.slice(start, end).join('\n'),
    };
    const size = JSON.stringify(item).length;
    if (size > remaining) {
      skipped.push({ path: relative, reason: '相关上下文预算不足' });
      return;
    }
    remaining -= size;
    contexts.push(item);
  };
  for (const side of ['new', 'old']) {
    const symbols = new Set(),
      directories = new Set(),
      own = new Set();
    for (const file of files) {
      const positions = changedLines(file.text, side);
      if (!positions.length || !source.test(file.path)) continue;
      const relative = side === 'old' ? file.previousPath || file.path : file.path;
      own.add(relative);
      directories.add(path.posix.dirname(relative));
      const blob = await git.readReviewBlob(snapshot, relative, side);
      if (blob.reason) {
        skipped.push({ path: relative, reason: blob.reason });
        continue;
      }
      const lines = blob.text.split('\n');
      if (lines.at(-1) === '') lines.pop();
      for (const line of positions.slice(0, 12)) {
        const range = enclosing(lines, line - 1);
        const match = declaration.exec(lines[range[0]] || '');
        add(
          relative,
          side,
          lines,
          range,
          match ? '改动所在函数附近（启发式）' : '改动附近（未识别函数）',
        );
        if (match) symbols.add(match[1] || match[2]);
      }
      if (positions.length > 12)
        skipped.push({ path: relative, reason: '仅为前 12 个改动位置补充附近上下文' });
    }
    if (!symbols.size) continue;
    let paths;
    try {
      paths = await git.reviewTreePaths(snapshot, side);
    } catch {
      skipped.push({ path: '相关文件扫描', reason: '无法列出固定版本，未扩展相关文件' });
      continue;
    }
    const candidates = paths.filter(
      (relative) =>
        source.test(relative) &&
        !own.has(relative) &&
        (directories.has(path.posix.dirname(relative)) ||
          /(?:^|\/)(?:tests?|__tests__)(?:\/|\.)|\.(?:test|spec)\./i.test(relative)),
    );
    if (candidates.length > 40)
      skipped.push({
        path: '相关文件扫描',
        reason: `${side === 'old' ? '父版本' : '暂存版本'}候选 ${candidates.length} 个，仅扫描前 40 个`,
      });
    for (const relative of candidates.slice(0, 40)) {
      if (excluded(relative, patterns) || blockedPaths.has(relative)) {
        withheldPaths.add(relative);
        skipped.push({ path: relative, reason: '上下文排除规则或敏感路径' });
        continue;
      }
      const blob = await git.readReviewBlob(snapshot, relative, side);
      if (blob.reason) {
        withheldPaths.add(relative);
        skipped.push({ path: relative, reason: blob.reason });
        continue;
      }
      const lines = blob.text.split('\n');
      if (lines.at(-1) === '') lines.pop();
      const isTest = /(?:test|spec)/i.test(relative);
      let matches = 0;
      for (let i = 0; i < lines.length && matches < 3; i++) {
        if (
          ![...symbols].some((symbol) =>
            new RegExp(`\\b${symbol.replace(/\$/g, '\\$')}\\s*\\(`).test(lines[i]),
          )
        )
          continue;
        add(
          relative,
          side,
          lines,
          [Math.max(0, i - 5), Math.min(lines.length, i + 9)],
          isTest ? '相关测试（文本匹配）' : '直接引用（文本匹配）',
        );
        matches++;
      }
    }
  }
  return { contexts, skipped, withheldPaths, used: budget - remaining, limitation: LIMITATION };
}

module.exports = { collectContext, changedLines, LIMITATION };

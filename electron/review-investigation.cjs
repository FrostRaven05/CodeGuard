const { diffLines } = require('./review-evidence.cjs');
const { excluded, sensitive } = require('./review-safety.cjs');
const { WorkbenchError } = require('./git-service.cjs');

const SOURCE = /\.(?:[cm]?[jt]sx?|py|rs|go|[ch](?:pp|xx)?|java|kt|cs|rb|php|swift|vue|svelte)$/i;
const validText = (value, max) =>
  typeof value === 'string' && !!value.trim() && value.length <= max;
const same = (a, b) =>
  !!a &&
  typeof a === 'object' &&
  a.path === b.path &&
  a.side === b.side &&
  a.line === b.line &&
  a.evidence === b.evidence;

function citation(value, files, contexts = []) {
  if (
    !value ||
    !['old', 'new'].includes(value.side) ||
    !Number.isSafeInteger(value.line) ||
    value.line < 1 ||
    !validText(value.evidence, 3000)
  )
    return null;
  const lines = new Map();
  for (const item of contexts.filter(
    (item) => item.path === value.path && item.side === value.side,
  ))
    item.text.split('\n').forEach((line, i) => lines.set(item.startLine + i, line));
  const file = files.find((item) => item.path === value.path);
  if (file) for (const [line, text] of diffLines(file.text)[value.side]) lines.set(line, text);
  if (
    !value.evidence
      .trim()
      .split('\n')
      .every((line, i) => lines.get(value.line + i)?.trim() === line.trim())
  )
    return null;
  return { path: value.path, side: value.side, line: value.line, evidence: value.evidence };
}

function hypotheses(input, files) {
  if (!Array.isArray(input) || input.length > 4) return [];
  const seen = new Set();
  return input.flatMap((item) => {
    const location = citation(item?.location, files);
    if (
      !item ||
      !validText(item.id, 24) ||
      !/^[a-zA-Z0-9_-]+$/.test(item.id) ||
      seen.has(item.id) ||
      !validText(item.title, 120) ||
      !validText(item.hypothesis, 800) ||
      !location ||
      !Array.isArray(item.queries) ||
      !item.queries.length ||
      item.queries.length > 3 ||
      !item.queries.every(
        (query) =>
          typeof query === 'string' &&
          /^[A-Za-z_$][A-Za-z0-9_$.:/-]{2,79}$/.test(query) &&
          !excluded(query, '') &&
          !sensitive(query),
      )
    )
      return [];
    seen.add(item.id);
    return [
      {
        id: item.id,
        title: item.title,
        hypothesis: item.hypothesis,
        queries: [...new Set(item.queries)],
        location,
      },
    ];
  });
}

// Read immutable blobs, never execute model-supplied commands or search the live worktree.
async function searchSnapshot(git, snapshot, plans, patterns, blockedPaths, budget, signal) {
  const hits = plans.map((plan) => ({ id: plan.id, queries: plan.queries, matches: [] }));
  const stats = { candidates: 0, scanned: 0, skipped: 0, truncated: false, chars: 0 };
  let remaining = Number.isFinite(budget) ? Math.max(0, budget) : 0;
  const checkCancel = () => {
    if (signal?.aborted) throw new WorkbenchError('评审已取消。', 'REVIEW_CANCELLED');
  };
  for (const side of ['new', 'old']) {
    checkCancel();
    const paths = (await git.reviewTreePaths(snapshot, side)).filter((name) => SOURCE.test(name));
    stats.candidates += paths.length;
    for (const relative of paths) {
      checkCancel();
      if (excluded(relative, patterns) || blockedPaths.has(relative)) {
        stats.skipped++;
        continue;
      }
      if (stats.scanned >= 300 || stats.chars >= 1500000) {
        stats.truncated = true;
        continue;
      }
      const blob = await git.readReviewBlob(
        snapshot,
        relative,
        side,
        Math.min(1000000, 1500000 - stats.chars),
      );
      checkCancel();
      if (blob.reason || sensitive(blob.text)) {
        blockedPaths.add(relative);
        stats.skipped++;
        continue;
      }
      stats.scanned++;
      stats.chars += blob.text.length;
      const lines = blob.text.split('\n');
      for (let p = 0; p < plans.length; p++) {
        let perFile = 0;
        for (let i = 0; i < lines.length; i++) {
          if (!plans[p].queries.some((query) => lines[i].includes(query))) continue;
          if (perFile >= 2 || hits[p].matches.length >= 8) {
            stats.truncated = true;
            break;
          }
          const start = Math.max(0, i - 3),
            end = Math.min(lines.length, i + 5);
          const match = {
            path: relative,
            side,
            line: i + 1,
            evidence: lines[i],
            startLine: start + 1,
            text: lines.slice(start, end).join('\n'),
          };
          const size = JSON.stringify(match).length;
          if (size > remaining) {
            stats.truncated = true;
            continue;
          }
          remaining -= size;
          hits[p].matches.push(match);
          perFile++;
        }
      }
    }
  }
  return {
    hits,
    stats,
    limitation:
      '固定快照跨目录字面搜索；最多扫描两个版本合计 300 个源码文件、150 万字符，每个假设最多保留 8 处片段。受排除、文件读取及发送预算限制；未命中不证明不存在，静态证据不等于执行测试。',
  };
}

function conclusions(input, plans, search) {
  return plans.map((plan) => {
    const result = Array.isArray(input) ? input.find((item) => item?.id === plan.id) : null;
    const matches = search.hits.find((hit) => hit.id === plan.id)?.matches || [];
    const evidence = Array.isArray(result?.evidence)
      ? result.evidence.filter((item) => matches.some((match) => same(item, match))).slice(0, 8)
      : [];
    const valid =
      result &&
      ['supported', 'refuted', 'uncertain'].includes(result.verdict) &&
      validText(result.conclusion, 1200) &&
      validText(result.suggestion, 1200);
    const verified = valid && evidence.length > 0;
    return {
      ...plan,
      verdict: verified ? result.verdict : 'uncertain',
      conclusion: verified ? result.conclusion : '未收到引用有效搜索证据的结论，需要进一步确认。',
      suggestion: verified ? result.suggestion : '检查相关调用与测试，再决定是否修改。',
      evidence: evidence.map((item) => ({
        path: item.path,
        side: item.side,
        line: item.line,
        evidence: item.evidence,
      })),
      matches,
    };
  });
}

module.exports = { hypotheses, searchSnapshot, conclusions, citation };

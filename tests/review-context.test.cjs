const test = require('node:test');
const assert = require('node:assert/strict');
const { collectContext } = require('../electron/review-context.cjs');
const { fitDiff } = require('../electron/review-budget.cjs');
const { diffLines } = require('../electron/review-evidence.cjs');

test('大差异按完整行采样，真实行号保留且发送预算不超限', () => {
  const text =
    '@@ -20,0 +20,800 @@\n' +
    Array.from({ length: 800 }, (_, i) => `+export const item${i} = ${i};`).join('\n');
  const full = diffLines(text).new;
  const selected = fitDiff(text, 3000);
  assert.equal(selected.partial, true);
  assert.ok(JSON.stringify(selected.text).length <= 3000);
  const actual = diffLines(selected.text).new;
  assert.ok(actual.size > 0 && actual.size < 800);
  for (const [line, row] of actual) assert.equal(full.get(line), row);
  assert.ok(
    [...actual.keys()].some((line) => line > 750),
    'Must include later changes, not just a prefix',
  );
});

test('混合增删和上下文采样仍保留新旧版本的准确坐标', () => {
  const text =
    '@@ -40,303 +60,303 @@\n' +
    Array.from({ length: 300 }, (_, i) => `-const old${i} = "old ${i}";`).join('\n') +
    '\n' +
    Array.from({ length: 300 }, (_, i) => `+const fresh${i} = "new ${i}";`).join('\n') +
    '\n same1\n same2\n same3\n';
  const full = diffLines(text),
    selected = diffLines(fitDiff(text, 4000).text);
  for (const side of ['old', 'new']) {
    assert.ok(selected[side].size > 0);
    for (const [line, row] of selected[side]) assert.equal(full[side].get(line), row);
  }
});

test('重叠的附近片段不重复占用预算，限制提示按文件原因去重', async () => {
  const lines = [
    'export function change(value) {',
    ...Array.from({ length: 100 }, (_, i) => `  const item${i} = value + ${i};`),
    '}',
  ];
  const diff =
    '@@ -2,20 +2,20 @@\n' +
    lines
      .slice(1, 21)
      .map((line) => `-${line}\n+${line}`)
      .join('\n');
  const git = {
    readReviewBlob: async () => ({ text: lines.join('\n') }),
    reviewTreePaths: async () => [],
  };
  return collectContext(
    git,
    { tree: 'tree', head: 'head' },
    [{ path: 'a.ts', text: diff }],
    () => false,
    '',
    6000,
    new Set(),
  ).then((result) => {
    for (const side of ['new', 'old']) {
      const ranges = result.contexts
        .filter((item) => item.side === side)
        .sort((a, b) => a.startLine - b.startLine);
      assert.ok(ranges.length > 0);
      for (let i = 1; i < ranges.length; i++)
        assert.ok(
          ranges[i].startLine > ranges[i - 1].endLine,
          'Overlapping context was sent twice',
        );
    }
    assert.equal(
      new Set(result.skipped.map((item) => `${item.path}:${item.reason}`)).size,
      result.skipped.length,
    );
  });
});

test('普通文档也可以补充改动附近的文本上下文', async () => {
  const git = {
    readReviewBlob: async () => ({ text: '# Behavior\nkeep zero\nmore context\n' }),
    reviewTreePaths: async () => [],
  };
  const result = await collectContext(
    git,
    { tree: 'tree', head: null },
    [{ path: 'README.md', text: '@@ -0,0 +1,2 @@\n+# Behavior\n+keep zero\n' }],
    () => false,
    '',
    2000,
    new Set(),
  );
  assert.ok(result.contexts.some((item) => item.path === 'README.md' && item.side === 'new'));
  assert.ok(!result.skipped.some((item) => item.reason.includes('此语言')));
});

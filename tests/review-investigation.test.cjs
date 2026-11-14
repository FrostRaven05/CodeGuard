const test = require('node:test');
const assert = require('node:assert/strict');
const { hypotheses, searchSnapshot, conclusions } = require('../electron/review-investigation.cjs');
const files = [
  {
    path: 'src/value.ts',
    text: '@@ -1 +1 @@\n-export const amount = 1;\n+export const amount = 0;\n',
  },
];
const location = {
  path: 'src/value.ts',
  side: 'new',
  line: 1,
  evidence: 'export const amount = 0;',
};
const plan = () => ({
  id: 'h1',
  title: '默认值的调用方',
  hypothesis: '零值可能改变跨模块调用的行为。',
  queries: ['amount'],
  location,
});

test('假设仅接受可核实的差异锚点与字面符号，不执行命令或正则', () => {
  assert.equal(hypotheses([plan()], files).length, 1);
  for (const change of [
    { queries: ['.*'] },
    { queries: ['$(whoami)'] },
    { location: { ...location, line: 2 } },
    { location: { ...location, path: '../outside.ts' } },
  ])
    assert.deepEqual(hypotheses([{ ...plan(), ...change }], files), []);
  assert.equal(hypotheses([plan(), plan()], files).length, 1);
});

test('实际搜索跨目录固定版本，排除内容不读取，敏感文件不发送', async () => {
  const read = [];
  const git = {
    reviewTreePaths: async () => [
      'feature/use.ts',
      'hidden.ts',
      '.env.ts',
      'token.ts',
      'linked.ts',
    ],
    readReviewBlob: async (snapshot, path, side) => {
      read.push([snapshot.tree, path, side]);
      if (path === 'linked.ts') return { reason: '符号链接' };
      if (path === 'token.ts') return { text: 'const api_key = "fixture-secret-1234567890";' };
      return {
        text:
          side === 'new'
            ? 'import { amount } from "../../src/value";\nuse(amount);'
            : 'old(amount);',
      };
    },
  };
  const result = await searchSnapshot(
    git,
    { tree: 'fixed-tree', head: 'fixed-head' },
    [plan()],
    'hidden.ts',
    new Set(),
    8000,
  );
  assert.equal(result.stats.scanned, 2);
  assert.equal(result.hits[0].matches.length, 3);
  assert.equal(result.hits[0].matches[0].path, 'feature/use.ts');
  assert.ok(read.every(([tree]) => tree === 'fixed-tree'));
  assert.ok(!read.some(([, path]) => path === 'hidden.ts' || path === '.env.ts'));
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|token.ts|linked.ts/);
});

test('扫描上限和片段预算如实记录，取消会停止后续读取', async () => {
  let reads = 0;
  const controller = new AbortController();
  const git = {
    reviewTreePaths: async () => Array.from({ length: 310 }, (_, i) => `src/${i}.ts`),
    readReviewBlob: async () => {
      reads++;
      return { text: 'amount();' };
    },
  };
  const result = await searchSnapshot(git, {}, [plan()], '', new Set(), 0);
  assert.equal(result.stats.scanned, 300);
  assert.equal(result.stats.candidates, 620);
  assert.equal(result.stats.truncated, true);
  assert.deepEqual(result.hits[0].matches, []);
  assert.equal(reads, 300);
  controller.abort();
  await assert.rejects(searchSnapshot(git, {}, [plan()], '', new Set(), 4000, controller.signal), {
    code: 'REVIEW_CANCELLED',
  });
  assert.equal(reads, 300);
});

test('结论只能引用该假设真实命中；伪造或缺少证据降为待确认', () => {
  const match = {
    path: 'other/use.ts',
    side: 'new',
    line: 3,
    evidence: 'use(amount);',
    startLine: 3,
    text: 'use(amount);',
  };
  const search = { hits: [{ id: 'h1', matches: [match] }] };
  const result = {
    id: 'h1',
    verdict: 'refuted',
    conclusion: '调用方已区分零值。',
    suggestion: '保留当前处理。',
    evidence: [match],
  };
  assert.equal(conclusions([result], [plan()], search)[0].verdict, 'refuted');
  for (const evidence of [
    [null, 'invalid'],
    [],
    [{ ...match, line: 99 }],
    [{ ...match, evidence: 'fake()' }],
  ]) {
    const value = conclusions([{ ...result, evidence }], [plan()], search)[0];
    assert.equal(value.verdict, 'uncertain');
    assert.deepEqual(value.evidence, []);
    assert.doesNotMatch(value.conclusion, /调用方已区分/);
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeResult } = require('../electron/review-service.cjs');

const files = [
  {
    path: 'src/value.ts',
    text: '@@ -1 +1 @@\n-export const value = 1;\n+export const value = 0;\n',
  },
];
const cite = { path: 'src/value.ts', side: 'new', line: 1, evidence: 'export const value = 0;' };
const visuals = () => ({
  changes: [
    { title: '调整默认值', before: '默认值为一。', after: '默认值为零。', location: { ...cite } },
  ],
  flows: [
    {
      title: '默认值使用流程',
      nodes: [
        { id: 'input', label: '读取默认值', kind: 'start', location: { ...cite } },
        { id: 'output', label: '向调用者提供零值', kind: 'end', location: null },
      ],
      edges: [{ from: 'input', to: 'output', label: '返回' }],
    },
  ],
});
const result = (visual) =>
  normalizeResult(
    JSON.stringify({
      summary: '调整默认值。',
      findings: [],
      ...(visual === undefined ? {} : { visuals: visual }),
    }),
    files,
    false,
  );

test('可视化描述保留白名单字段，代码位置来自已发送的对应版本', () => {
  const value = visuals();
  value.changes[0].componentCode = 'throw new Error("execute")';
  value.flows[0].nodes[0].onClick = 'fetch("external")';
  const normalized = result(value);
  assert.equal(normalized.visuals.changes[0].location.evidence, cite.evidence);
  assert.equal(normalized.visuals.flows[0].nodes.length, 2);
  assert.doesNotMatch(JSON.stringify(normalized.visuals), /componentCode|onClick|execute|external/);
  assert.equal(normalized.visualsRejected, 0);
  const old = visuals();
  old.changes[0].location = { ...cite, side: 'old', evidence: 'export const value = 1;' };
  assert.equal(result(old).visuals.changes[0].location.side, 'old');
});

test('旧结果和无效可选图示不破坏原有摘要与发现', () => {
  assert.deepEqual(result().visuals, { changes: [], flows: [] });
  for (const invalid of [null, '<script>run()</script>', { changes: [], flows: 'code' }]) {
    const normalized = result(invalid);
    assert.equal(normalized.summary, '调整默认值。');
    assert.deepEqual(normalized.findings, []);
    assert.equal(normalized.visualsRejected, 1);
  }
});

test('未知文件、错误版本行号和编造摘录都不能成为可点击位置', () => {
  for (const bad of [
    { ...cite, path: '../outside.ts' },
    { ...cite, line: 99 },
    { ...cite, side: 'old' },
    { ...cite, evidence: 'invented()' },
  ]) {
    const value = visuals();
    value.changes[0].location = bad;
    value.flows[0].nodes[0].location = bad;
    const normalized = result(value);
    assert.deepEqual(normalized.visuals, { changes: [], flows: [] });
    assert.equal(normalized.visualsRejected, 2);
  }
});

test('图的重复节点、悬空边、未知类型、孤立节点和无代码依据均被拒绝', () => {
  for (const mutate of [
    (value) => (value.flows[0].nodes[1].id = 'input'),
    (value) => (value.flows[0].edges[0].to = 'unknown'),
    (value) => (value.flows[0].nodes[0].kind = 'iframe'),
    (value) => (value.flows[0].edges = []),
    (value) => (value.flows[0].nodes[0].location = null),
  ]) {
    const value = visuals();
    mutate(value);
    const normalized = result(value);
    assert.equal(normalized.visuals.changes.length, 1);
    assert.equal(normalized.visuals.flows.length, 0);
    assert.equal(normalized.visualsRejected, 1);
  }
});

test('规模与文字长度受限，循环图仍可作为解释图保存', () => {
  const tooMany = visuals();
  tooMany.changes = Array.from({ length: 9 }, () => tooMany.changes[0]);
  assert.equal(result(tooMany).visualsRejected, 1);
  const long = visuals();
  long.changes[0].after = 'x'.repeat(1001);
  assert.equal(result(long).visuals.changes.length, 0);
  const cycle = visuals();
  cycle.flows[0].edges[0].label = '';
  cycle.flows[0].edges.push({ from: 'output', to: 'input', label: '重新读取' });
  assert.equal(result(cycle).visuals.flows.length, 1);
});

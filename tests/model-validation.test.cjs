const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { cases, scoreCase } = require('./fixtures/review-cases.cjs');

test('JS/TS 合成样例的原行为与已知回归可独立执行复现', () => {
  for (const item of cases.filter((item) => /\.[jt]s$/.test(item.path))) {
    const evaluate = (code, expression) =>
      vm.runInNewContext(`${code.replace('export ', '')}\n${expression}`);
    assert.equal(evaluate(item.before, item.expression), item.expected);
    assert.equal(evaluate(item.after, item.expression), item.actual);
    for (const value of ['null', 'undefined', '0', '5'])
      if (!item.buggy)
        assert.equal(
          evaluate(item.before, `limit(${value})`),
          evaluate(item.after, `limit(${value})`),
        );
  }
});

test('Python 合成样例的原行为与已知回归可独立执行复现', (t) => {
  const available = spawnSync('python', ['--version'], { windowsHide: true });
  if (available.error || available.status !== 0) {
    t.skip('Python 不可用，未声称运行 Python oracle');
    return;
  }
  for (const item of cases.filter((item) => item.path.endsWith('.py'))) {
    for (const [code, expected] of [
      [item.before, item.expected],
      [item.after, item.actual],
    ]) {
      const result = spawnSync('python', ['-c', `${code}\nprint(${item.expression})`], {
        encoding: 'utf8',
        windowsHide: true,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), expected ? 'True' : 'False');
    }
  }
});

test('质量评估必须人工核对，位置有效不自动算真阳性，漏报与误报独立计数', () => {
  const item = { expected: { buggy: true }, result: { findings: [{ id: 'one' }] } };
  assert.equal(scoreCase(item).status, 'pending-human-assessment');
  item.assessment = { complete: true, knownBugFound: false, verdicts: { one: 'false-positive' } };
  assert.deepEqual(scoreCase(item), {
    status: 'assessed',
    truePositives: 0,
    falsePositives: 1,
    falseNegatives: 1,
  });
  item.assessment = { complete: true, knownBugFound: true, verdicts: { one: 'true-positive' } };
  assert.deepEqual(scoreCase(item), {
    status: 'assessed',
    truePositives: 1,
    falsePositives: 0,
    falseNegatives: 0,
  });
  assert.equal(
    scoreCase({ ...item, expected: { buggy: false } }).status,
    'inconsistent-assessment',
  );
  assert.equal(
    scoreCase({ expected: { buggy: true }, protocol: 'failed', assessment: { complete: true } })
      .falseNegatives,
    null,
  );
});

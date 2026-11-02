// Public, generated examples only. Expected outcomes are never included in model messages.
const cases = [
  {
    id: 'ts-zero-regression',
    path: 'limit.ts',
    buggy: true,
    before: 'export function limit(value) {\n  return value ?? 10;\n}\n',
    after: 'export function limit(value) {\n  return value || 10;\n}\n',
    test: 'import { limit } from "./limit";\nconsole.assert(limit(0) === 0);\n',
    expression: 'limit(0)',
    expected: 0,
    actual: 10,
    oracle: '合法值 0 必须保留；改动后返回 10。',
    anchor: { side: 'new', line: 2 },
  },
  {
    id: 'js-nullish-correct',
    path: 'limit.js',
    buggy: false,
    before:
      'export function limit(value) {\n  return value === null || value === undefined ? 10 : value;\n}\n',
    after: 'export function limit(value) {\n  return value ?? 10;\n}\n',
    test: 'import { limit } from "./limit";\nconsole.assert(limit(0) === 0);\nconsole.assert(limit(null) === 10);\n',
    expression: 'limit(0)',
    expected: 0,
    actual: 0,
    oracle: '等价简化；0、null、undefined 的行为保持。',
  },
  {
    id: 'python-exclusive-regression',
    path: 'bounds.py',
    buggy: true,
    before: 'def valid_index(index, size):\n    return 0 <= index < size\n',
    after: 'def valid_index(index, size):\n    return 0 <= index <= size\n',
    test: 'from bounds import valid_index\nassert valid_index(3, 3) is False\n',
    expression: 'valid_index(3, 3)',
    expected: false,
    actual: true,
    oracle: 'index 等于 size 时不合法；改动后错误返回 True，列表访问将越界。',
    anchor: { side: 'new', line: 2 },
  },
  {
    id: 'python-range-correct',
    path: 'bounds.py',
    buggy: false,
    before: 'def valid_index(index, size):\n    return index >= 0 and index < size\n',
    after: 'def valid_index(index, size):\n    return 0 <= index < size\n',
    test: 'from bounds import valid_index\nassert valid_index(3, 3) is False\nassert valid_index(0, 3) is True\n',
    expression: 'valid_index(3, 3)',
    expected: false,
    actual: false,
    oracle: '对整数索引等价简化，保留右侧开区间。',
  },
];

function scoreCase(item) {
  const verdicts = item.assessment?.verdicts || {};
  const findings = item.result?.findings || [];
  if (
    !item.result ||
    !item.assessment?.complete ||
    findings.some(
      (finding) => !['true-positive', 'false-positive'].includes(verdicts[finding.id]),
    ) ||
    (item.expected.buggy && typeof item.assessment?.knownBugFound !== 'boolean')
  )
    return {
      status: 'pending-human-assessment',
      truePositives: null,
      falsePositives: null,
      falseNegatives: null,
    };
  const truePositives = findings.filter(
    (finding) => verdicts[finding.id] === 'true-positive',
  ).length;
  if (
    (!item.expected.buggy && truePositives) ||
    (item.expected.buggy && item.assessment.knownBugFound !== truePositives > 0)
  )
    return {
      status: 'inconsistent-assessment',
      truePositives: null,
      falsePositives: null,
      falseNegatives: null,
    };
  return {
    status: 'assessed',
    truePositives,
    falsePositives: findings.length - truePositives,
    falseNegatives: item.expected.buggy && !item.assessment.knownBugFound ? 1 : 0,
  };
}

module.exports = { cases, scoreCase };

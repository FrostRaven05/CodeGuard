const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

// Execute the actual persistence stores, with transport latency/failure and a snapshot reader.
// Rendering is covered by the desktop smoke; these checks exercise navigation-independent queues.
function store(file, api) {
  let source = stripTypeScriptTypes(
    fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8'),
  );
  source = source.replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
  return vm.runInNewContext(
    `${source}\n;({${file === 'reviewDrafts.ts' ? 'initializeReviewDraft,saveReviewDraft,flushReviewDraft,useReviewDraft' : 'useFindingDraft,flushFindingDrafts'}})`,
    {
      api,
      useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    },
  );
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('规范需求快速输入后离开视图，旧保存不覆盖最新草稿；失败后可重试', async () => {
  const calls = [],
    first = deferred(),
    second = deferred();
  const draft = store('reviewDrafts.ts', {
    saveReviewOptions: (id, value) => {
      calls.push([id, value]);
      return calls.length === 1
        ? first.promise
        : calls.length === 2
          ? second.promise
          : Promise.resolve(value);
    },
  });
  const one = { standards: '规范', requirements: '输入一' },
    two = { standards: '规范', requirements: '最后的输入' };
  draft.initializeReviewDraft('repo-a', { standards: '', requirements: '' });
  draft.saveReviewDraft('repo-a', one);
  draft.saveReviewDraft('repo-a', two);
  await tick();
  assert.equal(calls.length, 1);
  // A remounted panel can receive an old server response while persistence is pending.
  draft.initializeReviewDraft('repo-a', { standards: '', requirements: '服务器旧值' });
  assert.equal(draft.useReviewDraft('repo-a').options.requirements, two.requirements);
  first.resolve(one);
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(draft.useReviewDraft('repo-a').saving, true);
  second.reject(new Error('disk unavailable'));
  await assert.rejects(draft.flushReviewDraft('repo-a'));
  await tick();
  assert.equal(draft.useReviewDraft('repo-a').options.requirements, two.requirements);
  assert.ok(draft.useReviewDraft('repo-a').error);
  draft.initializeReviewDraft('repo-b', { standards: '另一仓库', requirements: '' });
  assert.equal(draft.useReviewDraft('repo-b').options.standards, '另一仓库');
  draft.saveReviewDraft('repo-a', two);
  await draft.flushReviewDraft('repo-a');
  await tick();
  assert.equal(draft.useReviewDraft('repo-a').error, '');
  assert.equal(draft.useReviewDraft('repo-a').saving, false);
  assert.equal(calls.at(-1)[1].requirements, two.requirements);
});

test('问题状态和备注按提交顺序保存，切换视图不丢失最新输入', async () => {
  const calls = [],
    pending = deferred();
  const module = store('findingDrafts.ts', {
    saveFindingDisposition: (id, value) => {
      calls.push([id, value]);
      return calls.length === 1 ? pending.promise : Promise.resolve(value);
    },
  });
  const request = {
    scope: 'local',
    reviewId: 'review-one',
    findingId: 'finding-one',
    status: 'pending',
    note: '',
  };
  module.useFindingDraft('repo', request).save({ status: 'handled', note: '已交接' });
  module
    .useFindingDraft('repo', request)
    .save({ status: 'handled', note: '交接给编码助手，等待复查' });
  await tick();
  assert.equal(module.useFindingDraft('repo', request).value.note, '交接给编码助手，等待复查');
  let flushed = false;
  const beforeRerun = module.flushFindingDrafts('repo', 'local').then(() => {
    flushed = true;
  });
  await tick();
  assert.equal(flushed, false);
  pending.resolve({ status: 'handled', note: '已交接' });
  await beforeRerun;
  await tick();
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(module.useFindingDraft('repo', request).value.note, '交接给编码助手，等待复查');
  assert.equal(
    module.useFindingDraft('repo', { ...request, scope: 'staged' }).value.status,
    'pending',
  );
});

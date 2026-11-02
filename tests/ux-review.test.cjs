const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GitService, runGit } = require('../electron/git-service.cjs');
const { ModelSettings } = require('../electron/model-settings.cjs');
const { ReviewService } = require('../electron/review-service.cjs');
const { createHandlers, invoke } = require('../electron/api-controller.cjs');
const { diffLines } = require('../electron/review-evidence.cjs');

async function fixture(t) {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'codeguard-ux-test-'));
  const repo = path.join(owned, 'repository with space');
  fs.mkdirSync(repo);
  t.after(() => {
    assert.equal(path.dirname(path.resolve(owned)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(owned).startsWith('codeguard-ux-test-'));
    fs.rmSync(owned, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  await runGit(repo, ['init', '--initial-branch=main']);
  for (const [key, value] of [
    ['user.name', 'UX Test'],
    ['user.email', 'ux@example.invalid'],
    ['core.autocrlf', 'false'],
    ['commit.gpgsign', 'false'],
    ['core.hooksPath', path.join(repo, '.git/hooks')],
  ])
    await runGit(repo, ['config', key, value]);
  const write = (relative, text) => {
    const file = path.join(repo, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  write('source.ts', 'export const value = 0;\n');
  write('.gitignore', 'ignored/\n');
  await runGit(repo, ['add', '--all']);
  await runGit(repo, ['commit', '-m', 'baseline']);
  const git = new GitService(path.join(owned, 'settings'));
  const { id } = await git.addRepository(repo);
  const settings = new ModelSettings(git.storageDirectory, { sessionOnly: true });
  settings.save({
    baseUrl: 'http://127.0.0.1:1/v1',
    model: 'offline-fixture',
    maxContextChars: 60000,
    excludePatterns: '',
  });
  const requests = [];
  let answer = () => ({ summary: '离线测试的范围说明', findings: [] });
  const transport = {
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      requests.push(body);
      const value = await answer(
        JSON.parse(body.messages.find((item) => item.role === 'user').content),
      );
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
          usage: { total_tokens: 7 },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    },
  };
  const reviews = new ReviewService(git, settings, transport);
  const handlers = createHandlers(git, async () => null, reviews);
  return {
    owned,
    repo,
    write,
    git,
    id,
    settings,
    reviews,
    handlers,
    requests,
    transport,
    answer: (fn) => {
      answer = fn;
    },
  };
}
function finding(input) {
  const file = input.files.find((item) => item.path === 'source.ts') || input.files[0];
  const [line, evidence] = [...diffLines(file.text).new.entries()].find(([, text]) => text.trim());
  return {
    priority: 'P1',
    category: 'correctness',
    title: '核对默认值',
    path: file.path,
    side: 'new',
    line,
    evidence,
    trigger: '输入为空时',
    consequence: '可能使用不合适的默认值',
    suggestion: '区分空输入与零',
  };
}

test('全部本地改动使用最新工作区与未跟踪文件，保留真实索引字节和工作文件', async (t) => {
  const f = await fixture(t);
  f.write('source.ts', 'export const value = 2;\n');
  await runGit(f.repo, ['add', '--', 'source.ts']);
  f.write('source.ts', 'export const value = 3;\n');
  f.write('untracked.ts', 'export const localOnly = true;\n');
  f.write('ignored/secret.ts', 'IGNORED_MARKER\n');
  f.write('.env.local', 'PRIVATE_ENV_MARKER\n');
  f.write('private.ts', 'export const password = "a-long-hidden-password";\n');
  const index = fs.readFileSync(path.join(f.repo, '.git/index'));
  const preview = await f.reviews.prepare(f.id, 'local');
  assert.equal(f.requests.length, 0);
  assert.equal(preview.scope, 'local');
  assert.ok(preview.included.some((item) => item.path === 'untracked.ts'));
  assert.ok(preview.skipped.some((item) => item.path === '.env.local'));
  assert.ok(preview.skipped.some((item) => item.path === 'private.ts'));
  assert.ok(!preview.included.some((item) => item.path.startsWith('ignored/')));
  const result = await f.reviews.start(f.id, preview.token);
  assert.equal(result.scope, 'local');
  const payload = JSON.stringify(f.requests[0]);
  assert.match(payload, /value = 3/);
  assert.doesNotMatch(payload, /value = 2|PRIVATE_ENV_MARKER|IGNORED_MARKER|long-hidden-password/);
  assert.deepEqual(fs.readFileSync(path.join(f.repo, '.git/index')), index);
  assert.equal(
    fs.readFileSync(path.join(f.repo, 'source.ts'), 'utf8'),
    'export const value = 3;\n',
  );
  assert.equal((await f.reviews.state(f.id, 'local')).latest.stale, false);
  assert.equal((await f.reviews.state(f.id, 'staged')).latest, null);
  const diff = await f.reviews.diff(f.id, {
    scope: 'local',
    reviewId: result.id,
    path: 'source.ts',
  });
  assert.match(diff.text, /value = 3/);
  f.write('source.ts', 'export const value = 4;\n');
  assert.match(
    (await f.reviews.diff(f.id, { scope: 'local', reviewId: result.id, path: 'source.ts' })).text,
    /value = 3/,
  );
  assert.equal((await f.reviews.state(f.id, 'local')).latest.stale, true);
});

test('本地快照不运行 clean filter，临时索引始终清理', async (t) => {
  const f = await fixture(t);
  f.write('.gitattributes', '*.ts filter=ux\n');
  await runGit(f.repo, ['add', '--', '.gitattributes']);
  await runGit(f.repo, ['commit', '-m', 'attributes']);
  const marker = path.join(f.owned, 'filter-ran');
  const script = path.join(f.owned, 'clean.cjs');
  fs.writeFileSync(
    script,
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); process.stdin.pipe(process.stdout);`,
  );
  await runGit(f.repo, [
    'config',
    'filter.ux.clean',
    `"${process.execPath.replaceAll('\\', '/')}" "${script.replaceAll('\\', '/')}"`,
  ]);
  await runGit(f.repo, ['config', 'filter.ux.required', 'true']);
  fs.writeFileSync(path.join(f.repo, '.git/hooks/post-index-change'), '#!/bin/sh\nexit 1\n', {
    mode: 0o755,
  });
  f.write('source.ts', 'export const value = 9;\n');
  await f.reviews.prepare(f.id, 'local');
  assert.equal(fs.existsSync(marker), false);
  assert.equal(
    fs.readdirSync(f.git.storageDirectory).some((name) => name.startsWith('local-snapshot-')),
    false,
  );
});

test('本地预览用内容识别变化，恢复时间戳也不能发送旧版本', async (t) => {
  const f = await fixture(t);
  f.write('source.ts', 'export const value = 1;\n');
  const preview = await f.reviews.prepare(f.id, 'local');
  const file = path.join(f.repo, 'source.ts'),
    stat = fs.statSync(file);
  f.write('source.ts', 'export const value = 2;\n');
  fs.utimesSync(file, stat.atime, stat.mtime);
  await assert.rejects(f.reviews.start(f.id, preview.token), { code: 'STALE_REVIEW' });
  assert.equal(f.requests.length, 0);
});

test('未跟踪新文件可独立分析，暂存评审继续使用索引版本', async (t) => {
  const f = await fixture(t);
  f.write('untracked.ts', 'export const another = 1;\n');
  const preview = await f.reviews.prepare(f.id, 'local');
  assert.deepEqual(
    preview.included.map((item) => item.path),
    ['untracked.ts'],
  );
  await f.reviews.start(f.id, preview.token);
  await assert.rejects(f.reviews.prepare(f.id, 'staged'), { code: 'EMPTY_INDEX' });
  f.write('source.ts', 'export const value = 2;\n');
  await runGit(f.repo, ['add', '--', 'source.ts']);
  f.write('source.ts', 'export const value = 3;\n');
  const staged = await f.reviews.prepare(f.id, 'staged');
  await f.reviews.start(f.id, staged.token);
  assert.match(JSON.stringify(f.requests.at(-1)), /value = 2/);
  assert.doesNotMatch(JSON.stringify(f.requests.at(-1)), /value = 3|another/);
  assert.equal((await f.reviews.state(f.id, 'staged')).latest.stale, false);
});

test('排除文件未暂存重命名后仍不发送，二进制与链接不会进入快照上下文', async (t) => {
  const f = await fixture(t);
  f.write('.env.local', 'PROTECTED_RENAME_MARKER\n');
  await runGit(f.repo, ['add', '--', '.env.local']);
  await runGit(f.repo, ['commit', '-m', 'protected baseline']);
  fs.renameSync(path.join(f.repo, '.env.local'), path.join(f.repo, 'renamed.txt'));
  f.write('source.ts', 'export const value = 7;\n');
  f.write('binary.bin', Buffer.from([0, 1, 2]));
  const outside = path.join(f.owned, 'outside.ts');
  fs.writeFileSync(outside, 'OUTSIDE_MARKER\n');
  let linked = false;
  try {
    fs.symlinkSync(outside, path.join(f.repo, 'linked.ts'));
    linked = true;
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
  }
  const preview = await f.reviews.prepare(f.id, 'local');
  assert.ok(preview.skipped.some((item) => item.path === 'renamed.txt'));
  assert.ok(preview.skipped.some((item) => item.path === 'binary.bin'));
  if (linked) assert.ok(preview.skipped.some((item) => item.path === 'linked.ts'));
  await f.reviews.start(f.id, preview.token);
  assert.doesNotMatch(JSON.stringify(f.requests), /PROTECTED_RENAME_MARKER|OUTSIDE_MARKER/);
});

test('问题处置持久化、按范围隔离，并分别记录再次发现与未再发现', async (t) => {
  const f = await fixture(t);
  f.write('source.ts', 'export const value = 1;\n');
  await runGit(f.repo, ['add', '--', 'source.ts']);
  f.answer((input) => ({ summary: '检查默认值', findings: [finding(input)] }));
  let preview = await f.reviews.prepare(f.id);
  let result = await f.reviews.start(f.id, preview.token);
  let request = {
    scope: 'staged',
    reviewId: result.id,
    findingId: result.findings[0].id,
    status: 'handled',
    note: '已交给编码助手，等待复查',
  };
  await f.reviews.saveDisposition(f.id, request);
  const restored = new ReviewService(f.git, f.settings, f.transport);
  assert.equal((await restored.state(f.id)).latest.findings[0].disposition.note, request.note);
  preview = await restored.prepare(f.id);
  result = await restored.start(f.id, preview.token);
  let current = (await restored.state(f.id)).latest;
  assert.equal(current.findings[0].disposition.status, 'handled');
  assert.equal(current.findings[0].recheckStatus, 'found-again');
  await assert.rejects(restored.saveDisposition(f.id, request), { code: 'STALE_REVIEW' });
  const local = await restored.prepare(f.id, 'local');
  await restored.start(f.id, local.token);
  assert.equal(
    (await restored.state(f.id, 'local')).latest.findings[0].disposition.status,
    'pending',
  );
  f.answer(() => ({ summary: '本轮没有返回可定位发现', findings: [] }));
  preview = await restored.prepare(f.id);
  await restored.start(f.id, preview.token);
  current = (await restored.state(f.id)).latest;
  assert.equal(current.findings.length, 0);
  assert.equal(current.previousFindings[0].recheckStatus, 'not-found');
  assert.equal(current.previousFindings[0].disposition.status, 'handled');
  f.write('other.ts', 'export const other = true;\n');
  await runGit(f.repo, ['add', '--', 'other.ts']);
  f.settings.save({ ...f.settings.getPublic(), excludePatterns: 'source.ts' });
  preview = await restored.prepare(f.id);
  await restored.start(f.id, preview.token);
  assert.equal(
    (await restored.state(f.id)).latest.previousFindings[0].recheckStatus,
    'not-covered',
  );
});

test('规范需求与处置输入通过桥接验证，保存后可由新服务读取', async (t) => {
  const f = await fixture(t);
  for (const text of ['草稿一', '草稿二', '最后的需求']) {
    const result = await invoke(f.handlers, 'saveReviewOptions', [
      f.id,
      { standards: '公共接口保持兼容', requirements: text },
    ]);
    assert.equal(result.ok, true);
  }
  const restored = new ReviewService(f.git, f.settings, f.transport);
  assert.equal((await restored.state(f.id)).options.requirements, '最后的需求');
  assert.equal(
    (await invoke(f.handlers, 'prepareReview', [f.id, 'unknown'])).error.code,
    'INVALID_REQUEST',
  );
  assert.equal(
    (
      await invoke(f.handlers, 'saveFindingDisposition', [
        f.id,
        { scope: 'staged', status: 'verified', note: '' },
      ])
    ).error.code,
    'INVALID_REQUEST',
  );
  assert.equal(
    (
      await invoke(f.handlers, 'reviewDiff', [
        f.id,
        { scope: 'staged', reviewId: 'unknown', path: '../outside' },
      ])
    ).ok,
    false,
  );
});

test('历史可加载超过150条，服务端搜索未加载提交、作者和哈希，分支范围独立', async (t) => {
  const f = await fixture(t);
  let data = '';
  for (let i = 1; i <= 165; i++) {
    const message = i === 1 ? 'old-only-needle' : `history entry ${i}`;
    data += `commit refs/heads/archive\nmark :${i}\ncommitter Archive Author <archive@example.invalid> ${1700000000 + i} +0000\ndata ${Buffer.byteLength(message)}\n${message}\n${i > 1 ? `from :${i - 1}\n` : ''}deleteall\n\n`;
  }
  await runGit(f.repo, ['fast-import', '--quiet'], { input: data });
  const first = await f.git.getHistoryPage(f.id, { ref: 'refs/heads/archive' });
  assert.equal(first.commits.length, 150);
  assert.equal(first.hasMore, true);
  const second = await f.git.getHistoryPage(f.id, {
    ref: 'refs/heads/archive',
    skip: first.nextSkip,
  });
  assert.equal(second.commits.length, 15);
  assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.commits, ...second.commits].map((item) => item.hash)).size, 165);
  const found = await f.git.getHistoryPage(f.id, { query: 'old-only-needle' });
  assert.equal(found.commits.length, 1);
  assert.equal(found.hasMore, false);
  const hash = await f.git.getHistoryPage(f.id, { query: found.commits[0].hash.slice(0, 12) });
  assert.equal(hash.commits[0].hash, found.commits[0].hash);
  assert.equal((await f.git.getHistoryPage(f.id, { query: 'archive author' })).commits.length, 150);
  assert.equal(
    (await f.git.getHistoryPage(f.id, { ref: 'refs/heads/main', query: 'old-only-needle' })).commits
      .length,
    0,
  );
  assert.equal(
    (await invoke(f.handlers, 'historyPage', [f.id, { ref: '--all' }])).error.code,
    'INVALID_REF',
  );
  assert.equal(
    (await invoke(f.handlers, 'historyPage', [f.id, { query: 'bad\0query' }])).error.code,
    'INVALID_REQUEST',
  );
});

test('空仓库新增和已跟踪删除均可理解，删除定位保留父版本', async (t) => {
  const f = await fixture(t);
  const empty = path.join(f.owned, 'empty repository');
  fs.mkdirSync(empty);
  await runGit(empty, ['init', '--initial-branch=main']);
  fs.writeFileSync(path.join(empty, 'first.ts'), 'export const first = true;\n');
  const { id } = await f.git.addRepository(empty);
  const preview = await f.reviews.prepare(id, 'local');
  const result = await f.reviews.start(id, preview.token);
  assert.equal(result.head, null);
  assert.deepEqual(result.included, ['first.ts']);
  fs.unlinkSync(path.join(f.repo, 'source.ts'));
  const deleted = await f.reviews.prepare(f.id, 'local');
  const snapshot = await f.reviews.start(f.id, deleted.token);
  assert.match(
    (await f.reviews.diff(f.id, { scope: 'local', reviewId: snapshot.id, path: 'source.ts' })).text,
    /-export const value = 0/,
  );
});

test('本地分析期间的编辑使结果过期，失败保留该范围的上次结果', async (t) => {
  const f = await fixture(t);
  f.write('source.ts', 'export const value = 1;\n');
  f.answer(() => {
    f.write('source.ts', 'export const value = 2;\n');
    return { summary: '固定旧快照', findings: [] };
  });
  const preview = await f.reviews.prepare(f.id, 'local');
  const original = await f.reviews.start(f.id, preview.token);
  assert.equal((await f.reviews.state(f.id, 'local')).latest.stale, true);
  f.answer(() => ({ summary: 'invalid' }));
  const retry = await f.reviews.prepare(f.id, 'local');
  await assert.rejects(f.reviews.start(f.id, retry.token), { code: 'REVIEW_INVALID_RESULT' });
  assert.equal((await f.reviews.state(f.id, 'local')).latest.id, original.id);
  assert.equal((await f.reviews.state(f.id, 'staged')).error, null);
});

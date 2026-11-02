const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { GitService, runGit } = require('../electron/git-service.cjs');
const { ModelSettings, callModel } = require('../electron/model-settings.cjs');
const { ReviewService, normalizeResult, excluded } = require('../electron/review-service.cjs');
const { createHandlers, invoke } = require('../electron/api-controller.cjs');

const goodFinding = {
  priority: 'P1',
  category: 'correctness',
  title: '空输入被当作成功',
  path: 'source.ts',
  side: 'new',
  line: 1,
  evidence: 'export const value = 0;',
  trigger: '调用方传入空值',
  consequence: '返回错误的默认值',
  suggestion: '明确区分空值与合法的零',
};
const goodResult = { summary: '新增默认值处理，需要核对空输入。', findings: [goodFinding] };
const response = (value = goodResult) => ({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
  usage: { total_tokens: 123 },
});

const streamEvent = (value) => `data: ${JSON.stringify(value)}\n\n`;
const streamDelta = (content) => ({
  choices: [{ index: 0, delta: { content }, finish_reason: null }],
});

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codeguard-review-test-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('codeguard-review-test-'));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return directory;
}

// An isolated encrypted test vault; the desktop smoke uses the actual OS safeStorage implementation.
function testVault() {
  const key = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = crypto.randomBytes(12),
        cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString(value) {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString(
        'utf8',
      );
    },
  };
}

async function modelServer(t, handler) {
  const requests = [];
  const server = http.createServer(async (request, result) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push({ url: request.url, authorization: request.headers.authorization, body });
      const value = handler ? await handler(body, result) : response();
      if (!result.writableEnded && !result.destroyed) {
        result.setHeader('Content-Type', 'application/json');
        result.end(JSON.stringify(value));
      }
    } catch {
      if (!result.destroyed) {
        result.statusCode = 500;
        result.end('{}');
      }
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { url: `http://127.0.0.1:${server.address().port}/v1`, requests };
}

async function fixture(t, handler, transport = {}) {
  const directory = temporary(t),
    repo = path.join(directory, '仓库 with space');
  fs.mkdirSync(repo);
  await runGit(repo, ['init', '--initial-branch=main']);
  for (const [key, value] of [
    ['user.name', 'Review Test'],
    ['user.email', 'review@example.invalid'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false'],
    ['core.hooksPath', path.join(repo, '.git/hooks')],
  ])
    await runGit(repo, ['config', key, value]);
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), value);
  };
  write('source.ts', 'export const value = 0;\n');
  await runGit(repo, ['add', '--', 'source.ts']);
  const git = new GitService(path.join(directory, 'settings'));
  const { id } = await git.addRepository(repo);
  const server = await modelServer(t, handler);
  const vault = testVault();
  const settings = new ModelSettings(git.storageDirectory, { safeStorage: vault });
  settings.save({
    baseUrl: server.url,
    model: 'fixture-model',
    apiKey: 'fixture-only-key',
    maxContextChars: 60000,
    excludePatterns: '',
  });
  const reviews = new ReviewService(git, settings, transport);
  return { directory, repo, git, id, settings, reviews, write, server, vault };
}

test('模型配置加密保存、密钥不回传，空值保留、清除和地址校验均生效', async (t) => {
  const f = await fixture(t);
  const raw = fs.readFileSync(f.settings.file, 'utf8');
  assert.ok(!raw.includes('fixture-only-key'));
  assert.ok(!JSON.stringify(f.settings.getPublic()).includes('encryptedKey'));
  assert.ok(!JSON.stringify(f.settings.getPublic()).includes('fixture-only-key'));
  assert.equal(
    new ModelSettings(f.git.storageDirectory, { safeStorage: f.vault }).connection().apiKey,
    'fixture-only-key',
  );
  assert.throws(
    () => new ModelSettings(f.git.storageDirectory, { safeStorage: testVault() }).connection(),
    { code: 'KEY_STORAGE_UNAVAILABLE' },
  );
  const saved = f.settings.getPublic();
  f.settings.save({ ...saved, apiKey: '' });
  assert.equal(f.settings.connection().apiKey, 'fixture-only-key');
  assert.throws(() => f.settings.save({ ...saved, baseUrl: 'http://example.com/v1' }), {
    code: 'INVALID_MODEL_SETTINGS',
  });
  assert.throws(
    () => f.settings.save({ ...saved, baseUrl: 'https://example.com/v1?key=private' }),
    { code: 'INVALID_MODEL_SETTINGS' },
  );
  assert.throws(() => f.settings.save({ ...saved, apiKey: 'header\ninjection' }), {
    code: 'INVALID_MODEL_SETTINGS',
  });
  f.settings.save({ ...saved, clearKey: true });
  assert.equal(f.settings.getPublic().hasApiKey, false);
  const unsupported = new ModelSettings(path.join(f.directory, 'no-vault'));
  assert.throws(() => unsupported.save({ ...saved, apiKey: 'test-key' }), {
    code: 'KEY_STORAGE_UNAVAILABLE',
  });
  assert.equal(fs.existsSync(unsupported.file), false);
});

test('连接测试使用真实 HTTP 接口但不包含仓库代码，接口错误不泄露响应或密钥', async (t) => {
  let fail = false;
  const f = await fixture(t, (_body, res) => {
    if (fail) {
      res.statusCode = 401;
      return { error: 'fixture-only-key source.ts secret body' };
    }
    return response();
  });
  assert.equal((await f.reviews.testConnection()).totalTokens, 123);
  assert.equal(f.server.requests[0].url, '/v1/chat/completions');
  assert.equal(f.server.requests[0].authorization, 'Bearer fixture-only-key');
  assert.ok(!JSON.stringify(f.server.requests[0].body).includes('source.ts'));
  fail = true;
  await assert.rejects(f.reviews.testConnection(), (error) => {
    assert.equal(error.code, 'MODEL_HTTP_ERROR');
    assert.ok(!JSON.stringify(error).includes('fixture-only-key'));
    return true;
  });
  const handlers = createHandlers(f.git, async () => f.repo, f.reviews);
  assert.equal((await invoke(handlers, 'modelSettings', [])).value.hasApiKey, true);
  assert.equal(
    (await invoke(handlers, 'prepareReview', ['invalid'])).error.code,
    'INVALID_REQUEST',
  );
});

test('评审只发送固定暂存版本，排除敏感路径、二进制、链接和自定义路径', async (t) => {
  const f = await fixture(t);
  f.write('.env.local', 'PRIVATE_CANARY=not-for-model\n');
  f.write('private.key', 'PRIVATE_CANARY_KEY');
  f.write('asset.bin', Buffer.from([0, 1, 2, 3]));
  f.write('internal/hidden.ts', 'PRIVATE_CANARY_INTERNAL\n');
  f.write('nested/large.txt', 'X'.repeat(100001));
  f.write('secret-source.ts', 'const apiKey = "PRIVATE_CANARY_CONTENT_12345";\n');
  await runGit(f.repo, ['add', '--all']);
  const linkHash = (
    await runGit(f.repo, ['hash-object', '-w', '--stdin'], { input: '../outside-private' })
  ).stdout.trim();
  await runGit(f.repo, ['update-index', '--add', '--cacheinfo', `120000,${linkHash},link.txt`]);
  f.write('source.ts', 'UNSTAGED_CANARY\n');
  f.settings.save({ ...f.settings.getPublic(), excludePatterns: 'internal/**' });
  const preview = await f.reviews.prepare(f.id);
  assert.deepEqual(
    preview.included.map((entry) => entry.path),
    ['source.ts'],
  );
  assert.equal(preview.skipped.length, 7);
  assert.equal(f.server.requests.length, 0);
  const result = await f.reviews.start(f.id, preview.token);
  const payload = JSON.stringify(f.server.requests[0].body);
  assert.match(payload, /export const value = 0/);
  assert.doesNotMatch(payload, /UNSTAGED_CANARY|PRIVATE_CANARY|outside-private/);
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.usage, { promptTokens: null, completionTokens: null, totalTokens: 123 });
  assert.equal(f.reviews.metrics.get(f.id).usage.totalTokens, 123);
  assert.equal(result.hasRequirements, false);
  assert.equal(result.findings[0].evidenceStatus, 'AI 推断待确认');
  assert.equal((await f.reviews.state(f.id)).latest.stale, false);
  assert.equal(new ReviewService(f.git, f.settings).load(f.id).latest.id, result.id);
  assert.equal(fs.readFileSync(path.join(f.repo, 'source.ts'), 'utf8'), 'UNSTAGED_CANARY\n');
});

test('问题必须有真实差异位置和连续摘录，过滤伪造证据、未知路径与无需求的需求结论', () => {
  const files = [
    {
      path: 'source.ts',
      text: '@@ -1 +1 @@\n-export const value = 1;\n+export const value = 0;\n',
    },
  ];
  const findings = [
    goodFinding,
    goodFinding,
    { ...goodFinding, line: 999 },
    { ...goodFinding, evidence: 'invented();' },
    { ...goodFinding, path: '../outside' },
    { ...goodFinding, category: 'requirements' },
    null,
    { ...goodFinding, title: '旧行', side: 'old', evidence: 'export const value = 1;' },
  ];
  const result = normalizeResult(JSON.stringify({ summary: '变化', findings }), files, false);
  assert.equal(result.findings.length, 2);
  assert.equal(result.unverifiedCount, 5);
  assert.equal(result.findings[1].side, 'old');
  assert.throws(() => normalizeResult('not json', files, false), { code: 'REVIEW_INVALID_RESULT' });
  assert.throws(() => normalizeResult('{"summary":"","findings":[]}', files, false), {
    code: 'REVIEW_INVALID_RESULT',
  });
  assert.equal(excluded('.env', ''), true);
  assert.equal(excluded('.npmrc', ''), true);
  assert.equal(excluded('.aws/config', ''), true);
  assert.equal(excluded('secrets/runtime.json', ''), true);
  assert.equal(excluded('a/generated.ts', '*.ts'), true);
  assert.equal(excluded('a/file.ts', 'a/**'), true);
  assert.equal(excluded('private.ts', '**/private.ts'), true);
  assert.equal(excluded('a/private.ts', '**/private.ts'), true);
  assert.equal(excluded('a/private.ts', './a/'), true);
});

test('发送前暂存、模型或依据变化均使预览失效，完全排除时不调用模型', async (t) => {
  const f = await fixture(t);
  let preview = await f.reviews.prepare(f.id);
  f.write('source.ts', 'changed index\n');
  await runGit(f.repo, ['add', '--', 'source.ts']);
  await assert.rejects(f.reviews.start(f.id, preview.token), { code: 'STALE_REVIEW' });
  preview = await f.reviews.prepare(f.id);
  f.settings.save({ ...f.settings.getPublic(), model: 'changed-model' });
  await assert.rejects(f.reviews.start(f.id, preview.token), { code: 'STALE_REVIEW' });
  preview = await f.reviews.prepare(f.id);
  f.reviews.saveOptions(f.id, { standards: '兼容旧接口', requirements: '' });
  await assert.rejects(f.reviews.start(f.id, preview.token), { code: 'STALE_REVIEW' });
  f.settings.save({ ...f.settings.getPublic(), excludePatterns: '**' });
  preview = await f.reviews.prepare(f.id);
  assert.equal(preview.included.length, 0);
  await assert.rejects(f.reviews.start(f.id, preview.token), { code: 'REVIEW_EMPTY' });
  assert.equal(f.server.requests.length, 0);
});

test('评审期间仍可修改暂存和提交，有问题或过期结果均不阻止提交', async (t) => {
  let entered, release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, async () => {
    entered();
    await gate;
    return response();
  });
  const preview = await f.reviews.prepare(f.id);
  const pending = f.reviews.start(f.id, preview.token);
  await started;
  assert.equal((await f.reviews.state(f.id)).running, true);
  f.write('source.ts', 'export const value = 1;\n');
  await f.git.changeStaging(f.id, 'source.ts', 'stage');
  const commitPreview = await f.git.prepareCommit(f.id);
  const committed = await f.git.commit(f.id, commitPreview.token, 'commit while review runs');
  release();
  assert.ok(committed.hash);
  const result = await pending;
  assert.equal(result.findings.length, 1);
  assert.equal((await f.reviews.state(f.id)).latest.stale, true);
  assert.match(JSON.stringify(f.server.requests[0].body), /value = 0/);
  f.write('other.ts', 'export const other = 1;\n');
  await f.git.changeStaging(f.id, 'other.ts', 'stage');
  const next = await f.git.prepareCommit(f.id);
  assert.equal(
    (await f.git.commit(f.id, next.token, 'commit with stale finding')).treeMatchesPreview,
    true,
  );
});

test('取消、超时、无效响应均保留已有结果与提交草稿', async (t) => {
  let mode = 'success',
    entered;
  let started;
  const f = await fixture(t, async (_body, res) => {
    if (mode === 'hold') {
      entered();
      await new Promise((resolve) => res.on('close', resolve));
      return response();
    }
    if (mode === 'invalid') return response({ summary: 'broken' });
    if (mode === 'incomplete')
      return { choices: [{ finish_reason: 'length', message: { content: '{}' } }] };
    return response();
  });
  f.git.saveDraft(f.id, '保留的提交草稿');
  let preview = await f.reviews.prepare(f.id);
  const initial = await f.reviews.start(f.id, preview.token);
  mode = 'hold';
  started = new Promise((resolve) => {
    entered = resolve;
  });
  preview = await f.reviews.prepare(f.id);
  const cancelled = assert.rejects(f.reviews.start(f.id, preview.token), {
    code: 'REVIEW_CANCELLED',
  });
  await started;
  f.reviews.cancel(f.id);
  await cancelled;
  assert.equal((await f.reviews.state(f.id)).latest.id, initial.id);
  const fast = new ReviewService(f.git, f.settings, { timeoutMs: 30 });
  preview = await fast.prepare(f.id);
  await assert.rejects(fast.start(f.id, preview.token), { code: 'MODEL_TIMEOUT' });
  for (const [nextMode, code] of [
    ['invalid', 'REVIEW_INVALID_RESULT'],
    ['incomplete', 'MODEL_INCOMPLETE'],
  ]) {
    mode = nextMode;
    preview = await f.reviews.prepare(f.id);
    await assert.rejects(f.reviews.start(f.id, preview.token), { code });
    assert.equal((await f.reviews.state(f.id)).latest.id, initial.id);
  }
  assert.equal(f.git.getWorkspace().drafts[f.id], '保留的提交草稿');
  assert.equal((await f.reviews.state(f.id)).running, false);
});

test('评审快照绑定分支、模型和依据，未暂存编辑不会让结果过期', async (t) => {
  const f = await fixture(t);
  await runGit(f.repo, ['commit', '-m', 'baseline']);
  f.write('source.ts', 'export const value = 0;\n// added\n');
  await runGit(f.repo, ['add', '--', 'source.ts']);
  const preview = await f.reviews.prepare(f.id);
  await f.reviews.start(f.id, preview.token);
  f.write('source.ts', 'only worktree changed\n');
  assert.equal((await f.reviews.state(f.id)).latest.stale, false);
  await runGit(f.repo, ['switch', '-c', 'same-head']);
  assert.equal((await f.reviews.state(f.id)).latest.stale, true);
  await runGit(f.repo, ['switch', 'main']);
  assert.equal((await f.reviews.state(f.id)).latest.stale, false);
  f.reviews.saveOptions(f.id, { standards: '', requirements: '新增需求' });
  assert.equal((await f.reviews.state(f.id)).latest.stale, true);
});

test('排除文件重命名后仍不会绕过排除规则', async (t) => {
  const f = await fixture(t);
  f.write('.env.private', 'PRIVATE_RENAME_CANARY=this-is-not-code\n');
  await runGit(f.repo, ['add', '--all']);
  await runGit(f.repo, ['commit', '-m', 'baseline']);
  fs.renameSync(path.join(f.repo, '.env.private'), path.join(f.repo, 'ordinary.txt'));
  f.write('source.ts', 'export const value = 0;\n// staged change\n');
  await runGit(f.repo, ['add', '--all']);
  const preview = await f.reviews.prepare(f.id);
  assert.deepEqual(
    preview.included.map((item) => item.path),
    ['source.ts'],
  );
  assert.ok(preview.skipped.some((item) => item.path === 'ordinary.txt'));
  await f.reviews.start(f.id, preview.token);
  assert.doesNotMatch(JSON.stringify(f.server.requests[0]), /PRIVATE_RENAME_CANARY/);
});

test('纯重命名保留原有关系，不把已有代码重新发送成新增行', async (t) => {
  const f = await fixture(t, () => response({ summary: '仅重命名文件。', findings: [] }));
  await runGit(f.repo, ['commit', '-m', 'baseline']);
  fs.renameSync(path.join(f.repo, 'source.ts'), path.join(f.repo, 'renamed.ts'));
  await runGit(f.repo, ['add', '--all']);
  const preview = await f.reviews.prepare(f.id);
  assert.deepEqual(
    preview.included.map((item) => item.path),
    ['renamed.ts'],
  );
  await f.reviews.start(f.id, preview.token);
  const payload = JSON.parse(
    f.server.requests[0].body.messages.find((message) => message.role === 'user').content,
  );
  assert.equal(payload.files[0].status, 'R');
  assert.match(payload.files[0].text, /rename from source\.ts/);
  assert.match(payload.files[0].text, /rename to renamed\.ts/);
  assert.doesNotMatch(payload.files[0].text, /\+export|new file mode/);
});

test('模型配置损坏不会阻止 Git 使用，重新保存会备份原文件', async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(f.settings.file, '{invalid configuration');
  const recovered = new ModelSettings(f.git.storageDirectory, { safeStorage: f.vault });
  assert.match(recovered.getPublic().warning, /Git 功能仍可使用/);
  assert.equal(recovered.getPublic().baseUrl, '');
  assert.equal((await f.git.getState(f.id)).branch, 'main');
  recovered.save({
    baseUrl: f.server.url,
    model: 'recovered',
    maxContextChars: 60000,
    excludePatterns: '',
  });
  const backup = fs
    .readdirSync(f.git.storageDirectory)
    .find((name) => name.startsWith('model-settings.json.backup-'));
  assert.equal(
    fs.readFileSync(path.join(f.git.storageDirectory, backup), 'utf8'),
    '{invalid configuration',
  );
  assert.equal(recovered.getPublic().warning, null);
});

test('请求不跟随重定向，超大和无效服务响应不会被接受', async (t) => {
  const cases = [
    ['redirect', 'MODEL_NETWORK_ERROR'],
    ['large', 'MODEL_OUTPUT_LIMIT'],
    ['invalid', 'MODEL_INVALID_RESPONSE'],
  ];
  for (const [mode, code] of cases) {
    const server = await modelServer(t, (_body, res) => {
      if (mode === 'redirect') {
        res.writeHead(302, { Location: 'http://127.0.0.1:1/never-send-key' });
        res.end();
      }
      if (mode === 'large') return { padding: 'x'.repeat(2000100) };
      if (mode === 'invalid') {
        res.end('not json');
      }
      return {};
    });
    await assert.rejects(
      callModel({ endpoint: `${server.url}/chat/completions`, model: 'fixture', apiKey: '' }, [
        { role: 'user', content: 'test' },
      ]),
      { code },
    );
  }
});

test('上下文关联暂存函数、直接引用和测试；删除读取父版本，不读未暂存内容', async (t) => {
  const f = await fixture(t, () => response({ summary: '函数变化', findings: [] }));
  f.write('source.ts', 'export function amount(value) {\n  return value ?? 10;\n}\n');
  f.write('caller.ts', 'import { amount } from "./source";\nexport const total = amount(0);\n');
  f.write(
    'tests/source.test.ts',
    'import { amount } from "../source";\nassert.equal(amount(0), 0);\n',
  );
  f.write('gone.py', 'def gone(value):\n    return value + 1\n');
  await runGit(f.repo, ['add', '--all']);
  await runGit(f.repo, ['commit', '-m', 'context baseline']);
  f.write('source.ts', 'export function amount(value) {\n  return value || 10;\n}\n');
  fs.unlinkSync(path.join(f.repo, 'gone.py'));
  await runGit(f.repo, ['add', '--all']);
  f.write('caller.ts', 'UNSTAGED_CALLER_CANARY');
  f.write('source.ts', 'UNSTAGED_SOURCE_CANARY');
  const preview = await f.reviews.prepare(f.id);
  assert.ok(
    preview.contexts.some(
      (item) => item.path === 'source.ts' && item.side === 'new' && item.startLine === 1,
    ),
  );
  assert.equal(
    preview.contexts.find((item) => item.path === 'source.ts' && item.side === 'new').endLine,
    3,
  );
  assert.ok(
    preview.contexts.some((item) => item.path === 'caller.ts' && item.kind.includes('引用')),
  );
  assert.ok(
    preview.contexts.some(
      (item) => item.path === 'tests/source.test.ts' && item.kind.includes('测试'),
    ),
  );
  assert.ok(
    preview.contexts.some(
      (item) => item.path === 'gone.py' && item.side === 'old' && item.revision === preview.head,
    ),
  );
  await f.reviews.start(f.id, preview.token);
  const payload = JSON.parse(f.server.requests[0].body.messages[1].content);
  assert.doesNotMatch(JSON.stringify(payload), /UNSTAGED_/);
  assert.ok(payload.contexts.some((item) => item.text.includes('amount(0)')));
  assert.equal((await f.reviews.state(f.id)).latest.stale, false);
  const nextPreview = await f.reviews.prepare(f.id);
  await runGit(f.repo, ['add', '--', 'caller.ts']);
  assert.equal((await f.reviews.state(f.id)).latest.stale, true);
  await assert.rejects(f.reviews.start(f.id, nextPreview.token), { code: 'STALE_REVIEW' });
});

test('上下文共同遵守排除、密钥检测、链接隔离和总请求预算', async (t) => {
  const f = await fixture(t, () => response({ summary: '检查上下文', findings: [] }));
  f.write('source.ts', 'export function amount(value) {\n  return value ?? 10;\n}\n');
  f.write('hidden.ts', 'amount("EXCLUDED_CONTEXT_CANARY");\n');
  f.write('token-bearing.ts', 'const apiKey = "SECRET_CONTEXT_CANARY_12345";\namount(0);\n');
  f.write('large.ts', 'amount(0);\n' + '// large\n'.repeat(8000));
  await runGit(f.repo, ['add', '--all']);
  const linkHash = (
    await runGit(f.repo, ['hash-object', '-w', '--stdin'], { input: '../outside-private' })
  ).stdout.trim();
  await runGit(f.repo, ['update-index', '--add', '--cacheinfo', `120000,${linkHash},link.ts`]);
  await runGit(f.repo, ['commit', '-m', 'baseline']);
  f.write('source.ts', 'export function amount(value) {\n  return value || 10;\n}\n');
  await runGit(f.repo, ['add', '--', 'source.ts']);
  f.settings.save({
    ...f.settings.getPublic(),
    maxContextChars: 4000,
    excludePatterns: 'hidden.ts',
  });
  const preview = await f.reviews.prepare(f.id);
  assert.ok(
    preview.contextSkipped.some(
      (item) => item.path === 'hidden.ts' && item.reason.includes('排除'),
    ),
  );
  assert.ok(
    preview.contextSkipped.some(
      (item) => item.path === 'token-bearing.ts' && item.reason.includes('密钥'),
    ),
  );
  assert.ok(
    preview.contextSkipped.some(
      (item) => item.path === 'link.ts' && item.reason.includes('符号链接'),
    ),
  );
  assert.ok(preview.contextSkipped.some((item) => item.path === 'large.ts'));
  await f.reviews.start(f.id, preview.token);
  const messages = f.server.requests[0].body.messages;
  assert.ok(messages.reduce((sum, item) => sum + item.content.length, 0) <= 4000);
  assert.doesNotMatch(JSON.stringify(messages), /CONTEXT_CANARY|outside-private/);
});

test('规范需求与结果检测敏感内容；排除路径不进入问题交接，部分行摘录不被接受', async (t) => {
  const f = await fixture(t, () =>
    response({ summary: 'source.ts 与 hidden.ts 的变化', findings: [] }),
  );
  f.write('hidden.ts', 'EXCLUDED_CANARY\n');
  await runGit(f.repo, ['add', '--all']);
  f.settings.save({ ...f.settings.getPublic(), excludePatterns: 'hidden.ts' });
  f.reviews.saveOptions(f.id, {
    standards: 'apiKey = "SECRET_OPTIONS_CANARY_12345"',
    requirements: '',
  });
  await assert.rejects(f.reviews.prepare(f.id), { code: 'REVIEW_SENSITIVE_OPTIONS' });
  f.reviews.saveOptions(f.id, { standards: '查看 hidden.ts', requirements: '' });
  await assert.rejects(f.reviews.prepare(f.id), { code: 'REVIEW_SENSITIVE_OPTIONS' });
  f.reviews.saveOptions(f.id, { standards: '', requirements: '' });
  const preview = await f.reviews.prepare(f.id);
  const result = await f.reviews.start(f.id, preview.token);
  assert.doesNotMatch(result.summary, /hidden.ts/);
  const invalid = normalizeResult(
    JSON.stringify({ summary: '变化', findings: [{ ...goodFinding, evidence: 'value = 0' }] }),
    [{ path: 'source.ts', text: '@@ -0,0 +1 @@\n+export const value = 0;\n' }],
    false,
  );
  assert.equal(invalid.findings.length, 0);
});

test('上下文不足与未支持语言不会擦除已纳入差异的问题；敏感模型结果不保存', async (t) => {
  let unsafe = false;
  const f = await fixture(t, () =>
    response(
      unsafe
        ? { summary: 'apiKey = "UNSAFE_RESULT_CANARY_12345"', findings: [] }
        : {
            summary: '检查 Rust 差异',
            findings: [
              { ...goodFinding, path: 'source.rs', evidence: 'pub const VALUE: i32 = 0;' },
            ],
          },
    ),
  );
  f.write('source.rs', 'pub const VALUE: i32 = 0;\n');
  await runGit(f.repo, ['add', '--all']);
  let preview = await f.reviews.prepare(f.id);
  const result = await f.reviews.start(f.id, preview.token);
  assert.equal(result.findings.length, 1);
  assert.ok(preview.contextSkipped.some((file) => file.path === 'source.rs'));
  unsafe = true;
  preview = await f.reviews.prepare(f.id);
  await assert.rejects(f.reviews.start(f.id, preview.token), { code: 'REVIEW_UNSAFE_RESULT' });
  assert.equal(f.reviews.metrics.get(f.id).usage.totalTokens, 123);
  assert.equal((await f.reviews.state(f.id)).latest.id, result.id);
  assert.doesNotMatch(fs.readFileSync(f.reviews.file(f.id), 'utf8'), /UNSAFE_RESULT_CANARY/);
});

test('四样例验证工具完整运行、报告区分协议与人工语义，失败即停并保留实际用量', async (t) => {
  const { validateModel } = require('../scripts/model-validation-runner.cjs');
  const { cases, scoreCase } = require('./fixtures/review-cases.cjs');
  let fail = false;
  const f = await fixture(t, () =>
    response(fail ? { summary: 'invalid' } : { summary: '合成样例模拟响应', findings: [] }),
  );
  const settingsBefore = fs.readFileSync(f.settings.file, 'utf8');
  const destination = path.join(f.directory, 'reports');
  const progress = [];
  let retainedDirectory;
  t.after(() => {
    if (!retainedDirectory) return;
    const resolved = path.resolve(retainedDirectory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('codeguard-model-validation-'));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const output = await validateModel(f.settings, {
    reportDirectory: destination,
    kind: 'mock-validation-test',
    onProgress: (item) => progress.push(item),
    cleanupImpl: (directory) => {
      retainedDirectory = directory;
      throw Object.assign(new Error('Synthetic cleanup lock'), { code: 'EBUSY' });
    },
  });
  assert.equal(output.report.cleanup.status, 'retained');
  assert.equal(output.report.cleanup.errorCode, 'EBUSY');
  assert.equal(JSON.parse(fs.readFileSync(output.reportFile, 'utf8')).cleanup.errorCode, 'EBUSY');
  assert.equal(output.report.cases.length, 4);
  assert.equal(f.server.requests.length, 4);
  assert.equal(progress.length, 4);
  assert.equal(output.report.kind, 'mock-validation-test');
  for (const record of output.report.cases) {
    assert.equal(record.protocol, 'accepted-json');
    assert.equal(record.usage.totalTokens, 123);
    assert.equal(record.cost, null);
    assert.equal(scoreCase(record).status, 'pending-human-assessment');
    assert.ok(record.preview.contexts.some((item) => item.path.startsWith('test_')));
  }
  for (const request of f.server.requests) {
    const payload = request.body.messages[1].content;
    assert.ok(!payload.includes('expected'));
    for (const item of cases) assert.ok(!payload.includes(item.oracle));
  }
  assert.doesNotMatch(fs.readFileSync(output.reportFile, 'utf8'), /fixture-only-key|encryptedKey/);
  assert.equal(fs.readFileSync(f.settings.file, 'utf8'), settingsBefore);
  fail = true;
  const failed = await validateModel(f.settings, {
    reportDirectory: destination,
    kind: 'mock-validation-test',
  });
  assert.equal(failed.report.cases.length, 1);
  assert.equal(failed.report.cleanup.status, 'completed');
  assert.equal(f.server.requests.length, 5);
  assert.equal(failed.report.cases[0].errorCode, 'REVIEW_INVALID_RESULT');
  assert.equal(failed.report.cases[0].usage.totalTokens, 123);
  assert.equal(scoreCase(failed.report.cases[0]).falseNegatives, null);
});

test('提交信息只发送固定暂存差异，预览不调用模型，草稿由用户确认后填写', async (t) => {
  const f = await fixture(t, () => response({ message: '新增默认值处理\n\n保留零值作为默认值。' }));
  f.write('source.ts', 'WORKTREE_ONLY_MARKER\n');
  f.write('untracked.ts', 'UNTRACKED_ONLY_MARKER\n');
  f.git.saveDraft(f.id, '用户原草稿');
  const before = await runGit(f.repo, ['diff', '--cached']);
  const handlers = createHandlers(f.git, async () => null, f.reviews);
  const preview = await invoke(handlers, 'prepareCommitMessage', [f.id]);
  assert.equal(preview.ok, true);
  assert.deepEqual(
    preview.value.included.map((item) => item.path),
    ['source.ts'],
  );
  assert.equal(f.server.requests.length, 0);
  const result = await invoke(handlers, 'generateCommitMessage', [f.id, preview.value.token]);
  assert.equal(result.ok, true);
  assert.match(result.value.message, /新增默认值处理/);
  assert.equal(result.value.partial, false);
  assert.equal(result.value.totalTokens, 123);
  assert.equal(f.git.getWorkspace().drafts[f.id], '用户原草稿');
  const sent = JSON.stringify(f.server.requests[0].body);
  assert.match(sent, /export const value = 0/);
  assert.doesNotMatch(sent, /WORKTREE_ONLY_MARKER|UNTRACKED_ONLY_MARKER|用户原草稿/);
  assert.equal((await runGit(f.repo, ['diff', '--cached'])).stdout, before.stdout);
  assert.equal(fs.readFileSync(path.join(f.repo, 'source.ts'), 'utf8'), 'WORKTREE_ONLY_MARKER\n');
  assert.equal(
    (await invoke(handlers, 'generateCommitMessage', [f.id, preview.value.token])).ok,
    false,
  );
});

test('提交信息排除敏感路径、内容和二进制，空范围不发送', async (t) => {
  const f = await fixture(t, () => response({ message: '新增处理逻辑' }));
  f.write('.env.local', 'PRIVATE_ENV_MARKER=hidden\n');
  f.write('hidden.ts', 'export const password = "a-long-private-password";\n');
  f.write('ignored.ts', 'EXCLUDED_CONTENT_MARKER\n');
  f.write('binary.bin', Buffer.from([0, 1, 2]));
  await runGit(f.repo, ['add', '--', '.']);
  f.settings.save({ ...f.settings.getPublic(), excludePatterns: 'ignored.ts' });
  const preview = await f.reviews.commitMessages.prepare(f.id);
  assert.deepEqual(
    preview.included.map((file) => file.path),
    ['source.ts'],
  );
  assert.equal(preview.skipped.length, 4);
  const result = await f.reviews.commitMessages.start(f.id, preview.token);
  assert.equal(result.partial, true);
  assert.doesNotMatch(
    JSON.stringify(f.server.requests),
    /PRIVATE_ENV_MARKER|EXCLUDED_CONTENT_MARKER|private-password|ignored.ts|hidden.ts|binary.bin|env.local/,
  );
  f.settings.save({ ...f.settings.getPublic(), excludePatterns: '**' });
  const empty = await f.reviews.commitMessages.prepare(f.id);
  await assert.rejects(f.reviews.commitMessages.start(f.id, empty.token), {
    code: 'COMMIT_MESSAGE_EMPTY',
  });
  assert.equal(f.server.requests.length, 1);
});

test('提交信息生成前的暂存或模型变化拒绝发送，生成后的变化拒绝旧结果', async (t) => {
  const f = await fixture(t, async () => {
    f.write('source.ts', 'export const value = 3;\n');
    await runGit(f.repo, ['add', '--', 'source.ts']);
    return response({ message: '旧版本信息' });
  });
  const old = await f.reviews.commitMessages.prepare(f.id);
  f.settings.save({ ...f.settings.getPublic(), model: 'changed-model' });
  await assert.rejects(f.reviews.commitMessages.start(f.id, old.token), {
    code: 'STALE_COMMIT_MESSAGE',
  });
  assert.equal(f.server.requests.length, 0);
  const preview = await f.reviews.commitMessages.prepare(f.id);
  f.git.saveDraft(f.id, '保留的草稿');
  await assert.rejects(f.reviews.commitMessages.start(f.id, preview.token), {
    code: 'STALE_COMMIT_MESSAGE',
  });
  assert.equal(f.git.getWorkspace().drafts[f.id], '保留的草稿');
  const changed = await f.reviews.commitMessages.prepare(f.id);
  f.write('source.ts', 'export const value = 4;\n');
  await runGit(f.repo, ['add', '--', 'source.ts']);
  await assert.rejects(f.reviews.commitMessages.start(f.id, changed.token), {
    code: 'STALE_COMMIT_MESSAGE',
  });
  assert.equal(f.server.requests.length, 1);
});

test('提交信息错误、无效和敏感结果都保留原草稿', async (t) => {
  for (const result of [
    null,
    { message: '' },
    { message: 'bad\u0000text' },
    { message: 'password = "long-private-secret"' },
  ]) {
    await t.test(JSON.stringify(result), async (t) => {
      const f = await fixture(t, () => response(result));
      f.git.saveDraft(f.id, '原草稿');
      const preview = await f.reviews.commitMessages.prepare(f.id);
      await assert.rejects(f.reviews.commitMessages.start(f.id, preview.token), {
        code: 'COMMIT_MESSAGE_INVALID',
      });
      assert.equal(f.git.getWorkspace().drafts[f.id], '原草稿');
    });
  }
});

test('提交信息取消请求、重复请求互斥且之后可重试', async (t) => {
  let entered;
  const received = new Promise((resolve) => {
    entered = resolve;
  });
  const f = await fixture(t, async () => {
    entered();
    await new Promise((resolve) => setTimeout(resolve, 100));
    return response({ message: '生成的草稿' });
  });
  f.git.saveDraft(f.id, '原草稿');
  const preview = await f.reviews.commitMessages.prepare(f.id);
  const running = f.reviews.commitMessages.start(f.id, preview.token);
  const rejection = assert.rejects(running, { code: 'COMMIT_MESSAGE_CANCELLED' });
  await received;
  await assert.rejects(f.reviews.commitMessages.start(f.id, preview.token), {
    code: 'COMMIT_MESSAGE_RUNNING',
  });
  f.reviews.commitMessages.cancel(f.id);
  await rejection;
  assert.equal(f.git.getWorkspace().drafts[f.id], '原草稿');
  const retry = await f.reviews.commitMessages.prepare(f.id);
  assert.equal((await f.reviews.commitMessages.start(f.id, retry.token)).message, '生成的草稿');
});

test('提交信息预算限制完整差异，排除文件改名后仍不会发送', async (t) => {
  const f = await fixture(t, () => response({ message: '新增普通逻辑' }));
  f.write('excluded.ts', 'SECRET_PATH_MARKER\n');
  await runGit(f.repo, ['add', '--', '.']);
  await runGit(f.repo, ['commit', '-m', 'base']);
  await runGit(f.repo, ['mv', '--', 'excluded.ts', 'renamed.ts']);
  f.write('source.ts', 'export const value = 1;\n');
  f.write('large.ts', 'x'.repeat(30000));
  await runGit(f.repo, ['add', '--', '.']);
  f.settings.save({
    ...f.settings.getPublic(),
    maxContextChars: 8000,
    excludePatterns: 'excluded.ts',
  });
  const preview = await f.reviews.commitMessages.prepare(f.id);
  assert.deepEqual(
    preview.included.map((item) => item.path),
    ['source.ts'],
  );
  assert.ok(preview.skipped.some((item) => item.path === 'renamed.ts'));
  assert.ok(preview.skipped.some((item) => item.path === 'large.ts'));
  assert.ok(preview.chars <= 8000);
  await f.reviews.commitMessages.start(f.id, preview.token);
  const sent = JSON.stringify(f.server.requests.at(-1).body.messages);
  assert.doesNotMatch(sent, /SECRET_PATH_MARKER|excluded.ts|renamed.ts|large.ts/);
  assert.ok(sent.length <= 8000);
});

test('组件化图示绑定暂存证据并持久化，旧记录无图示仍可读取', async (t) => {
  const location = { path: 'source.ts', side: 'new', line: 1, evidence: 'export const value = 0;' };
  const visuals = {
    changes: [{ title: '新增默认值', before: '未提供默认值', after: '提供零值', location }],
    flows: [
      {
        title: '默认值流程',
        nodes: [
          { id: 'read', label: '读取零值', kind: 'start', location },
          { id: 'use', label: '由调用方使用', kind: 'end', location: null },
        ],
        edges: [{ from: 'read', to: 'use', label: '传递' }],
      },
    ],
  };
  const f = await fixture(t, () => response({ ...goodResult, visuals }));
  f.write('source.ts', 'UNSTAGED_VISUAL_MARKER\n');
  const preview = await f.reviews.prepare(f.id);
  const generated = await f.reviews.start(f.id, preview.token);
  assert.deepEqual(generated.visuals, visuals);
  assert.equal(generated.visualsRejected, 0);
  const reloaded = new ReviewService(f.git, f.settings);
  assert.deepEqual((await reloaded.state(f.id)).latest.visuals, visuals);
  assert.doesNotMatch(JSON.stringify(f.server.requests), /UNSTAGED_VISUAL_MARKER/);
  assert.match(f.server.requests[0].body.messages[0].content, /visuals/);
  const data = reloaded.load(f.id);
  delete data.latest.visuals;
  delete data.latest.visualsRejected;
  fs.writeFileSync(reloaded.file(f.id), JSON.stringify(data));
  assert.equal((await reloaded.state(f.id)).latest.summary, goodResult.summary);
  assert.equal((await reloaded.state(f.id)).latest.stale, false);
});

test('SSE 在完成前推送摘要与已核对位置的问题，过程按范围隔离且最终用量正确', async (t) => {
  const gate = Promise.withResolvers(),
    sent = Promise.withResolvers();
  t.after(() => gate.resolve());
  const content = JSON.stringify(goodResult);
  const f = await fixture(t, async (body, output) => {
    assert.equal(body.stream, true);
    output.writeHead(200, { 'Content-Type': 'text/event-stream' });
    output.write(streamEvent(streamDelta(content.slice(0, -2))));
    sent.resolve();
    await gate.promise;
    if (output.destroyed) return;
    output.write(streamEvent(streamDelta(content.slice(-2))));
    output.write(streamEvent({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
    output.write(streamEvent({ choices: [], usage: { total_tokens: 17 } }));
    output.end('data: [DONE]\n\n');
  });
  const events = [];
  const unsubscribe = f.reviews.subscribeProgress((item) => events.push(item));
  t.after(unsubscribe);
  const preview = await f.reviews.prepare(f.id);
  const running = f.reviews.start(f.id, preview.token);
  await sent.promise;
  await new Promise((resolve) => {
    if (f.reviews.reviewProgress(f.id).findings.length) return resolve();
    const remove = f.reviews.subscribeProgress((item) => {
      if (item.findings.length) {
        remove();
        resolve();
      }
    });
    t.after(remove);
  });
  const live = f.reviews.reviewProgress(f.id);
  assert.equal(live.status, 'running');
  assert.equal(live.summary, goodResult.summary);
  assert.equal(live.findings.length, 1);
  assert.equal((await f.reviews.state(f.id)).latest, null);
  assert.equal(f.reviews.reviewProgress(f.id, 'local'), null);
  live.summary = 'mutated';
  assert.equal(f.reviews.reviewProgress(f.id).summary, goodResult.summary);
  gate.resolve();
  const result = await running;
  assert.equal(result.totalTokens, 17);
  assert.equal(result.findings.length, 1);
  assert.equal(f.reviews.reviewProgress(f.id).status, 'completed');
  assert.deepEqual(
    events
      .map((event) => event.phase)
      .filter((phase, index, all) => index === 0 || all[index - 1] !== phase),
    ['validating', 'requesting', 'receiving', 'checking', 'saving', 'completed'],
  );
  assert.ok(!fs.readFileSync(f.reviews.file(f.id), 'utf8').includes('receivedChars'));
});

test('流式取消立即停止等待，不保存半成品并保留上次结果与提交草稿', async (t) => {
  let streaming = false;
  const sent = Promise.withResolvers();
  const f = await fixture(t, (_body, output) => {
    if (!streaming) return response();
    output.writeHead(200, { 'Content-Type': 'text/event-stream' });
    output.write(streamEvent(streamDelta('{"summary":"未完成的摘要')));
    sent.resolve();
    // A streaming service can remain idle until cancellation closes the connection.
    return new Promise((resolve) => output.on('close', resolve));
  });
  const previous = await f.reviews.start(f.id, (await f.reviews.prepare(f.id)).token);
  f.git.saveDraft(f.id, '保留提交说明');
  streaming = true;
  const running = f.reviews.start(f.id, (await f.reviews.prepare(f.id)).token);
  const cancelled = assert.rejects(running, { code: 'REVIEW_CANCELLED' });
  await sent.promise;
  f.reviews.cancel(f.id);
  await cancelled;
  const state = await f.reviews.state(f.id);
  assert.equal(state.latest.id, previous.id);
  assert.equal(state.running, false);
  assert.equal(state.progress.status, 'cancelled');
  assert.equal(state.progress.summary, '');
  assert.equal(f.git.getWorkspace().drafts[f.id], '保留提交说明');
});

test('流式预览屏蔽排除路径、未核对问题和完整敏感字段；失败保留旧结果', async (t) => {
  let mode = 'baseline';
  const gate = Promise.withResolvers(),
    sent = Promise.withResolvers();
  t.after(() => gate.resolve());
  const f = await fixture(t, async (_body, output) => {
    if (mode === 'baseline') return response();
    output.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (mode === 'preview') {
      const value = {
        summary: '检查 private/notes.txt 与 fixture-only-key',
        findings: [{ ...goodFinding, line: 1000 }],
      };
      output.write(streamEvent(streamDelta(JSON.stringify(value).slice(0, -2))));
      sent.resolve();
      await gate.promise;
      if (output.destroyed) return;
      output.write(streamEvent(streamDelta(']}')));
    } else {
      output.write(
        streamEvent(
          streamDelta(
            JSON.stringify({ summary: 'password = "private-stream-secret"', findings: [] }),
          ),
        ),
      );
    }
    output.write(streamEvent({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
    output.end('data: [DONE]\n\n');
  });
  f.settings.save({ ...f.settings.getPublic(), excludePatterns: 'private' });
  const previous = await f.reviews.start(f.id, (await f.reviews.prepare(f.id)).token);
  mode = 'preview';
  const events = [];
  const remove = f.reviews.subscribeProgress((value) => events.push(value));
  t.after(remove);
  const running = f.reviews.start(f.id, (await f.reviews.prepare(f.id)).token);
  await sent.promise;
  await new Promise((resolve) => {
    if (f.reviews.reviewProgress(f.id).summary) return resolve();
    const unsubscribe = f.reviews.subscribeProgress((value) => {
      if (value.summary) {
        unsubscribe();
        resolve();
      }
    });
    t.after(unsubscribe);
  });
  assert.doesNotMatch(JSON.stringify(events), /private\/notes|fixture-only-key/);
  assert.equal(f.reviews.reviewProgress(f.id).findings.length, 0);
  gate.resolve();
  const completed = await running;
  assert.notEqual(completed.id, previous.id);
  mode = 'unsafe';
  await assert.rejects(f.reviews.start(f.id, (await f.reviews.prepare(f.id)).token), {
    code: 'REVIEW_UNSAFE_RESULT',
  });
  assert.doesNotMatch(JSON.stringify(events), /private-stream-secret/);
  assert.equal((await f.reviews.state(f.id)).latest.id, completed.id);
  assert.equal(f.reviews.reviewProgress(f.id).status, 'failed');
});

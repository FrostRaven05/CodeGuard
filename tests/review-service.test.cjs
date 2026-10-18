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

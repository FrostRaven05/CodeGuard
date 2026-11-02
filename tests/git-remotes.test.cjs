const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GitService, runGit, WorkbenchError } = require('../electron/git-service.cjs');
const { GitOperations } = require('../electron/git-operations.cjs');
const { createHandlers, invoke } = require('../electron/api-controller.cjs');

async function fixture(t) {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'codeguard-remotes-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(owned)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(owned).startsWith('codeguard-remotes-test-'));
    fs.rmSync(owned, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const root = path.join(owned, '中文 repo with spaces');
  fs.mkdirSync(root);
  await runGit(root, ['init', '--initial-branch=main']);
  for (const [key, value] of [
    ['user.name', 'Remotes Test'],
    ['user.email', 'remotes@example.invalid'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false'],
    ['core.hooksPath', path.join(root, '.git/hooks')],
  ])
    await runGit(root, ['config', key, value]);
  fs.writeFileSync(path.join(root, 'source.txt'), 'initial\n');
  await runGit(root, ['add', '--', '.']);
  await runGit(root, ['commit', '-m', 'initial']);
  const service = new GitService(path.join(owned, 'settings'));
  const id = (await service.addRepository(root)).id;
  const operations = new GitOperations(service);
  const settings = () => operations.remoteSettings(id);
  const change = async (request) =>
    operations.changeRemote(id, { revision: (await settings()).revision, pushUrl: '', ...request });
  return { owned, root, service, id, operations, settings, change };
}

test('远端管理通过业务接口添加、读取、修改和删除，保留索引、工作区与草稿', async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.root, 'source.txt'), 'staged\n');
  await runGit(f.root, ['add', '--', '.']);
  fs.writeFileSync(path.join(f.root, 'source.txt'), 'unstaged\n');
  f.service.saveDraft(f.id, '保留草稿');
  const before = await f.service.getState(f.id);
  const handlers = createHandlers(f.service, async () => null);
  let state = (await invoke(handlers, 'remoteSettings', [f.id])).value;
  assert.deepEqual(state.remotes, []);
  const fetchUrl = path.join(f.owned, 'remote with spaces.git');
  fs.mkdirSync(fetchUrl);
  let result = await invoke(handlers, 'changeRemote', [
    f.id,
    { kind: 'add', name: 'origin', fetchUrl, pushUrl: '', revision: state.revision },
  ]);
  assert.equal(result.ok, true);
  state = result.value;
  assert.equal(state.remotes[0].fetchUrls[0], fetchUrl);
  assert.deepEqual(state.remotes[0].pushUrls, []);
  result = await invoke(handlers, 'changeRemote', [
    f.id,
    {
      kind: 'edit',
      name: 'origin',
      fetchUrl: 'https://example.invalid/team/repo.git',
      pushUrl: 'git@example.invalid:team/repo.git',
      revision: state.revision,
    },
  ]);
  assert.equal(result.ok, true);
  assert.equal(
    (await f.operations.options(f.id)).remotes[0].pushUrls[0],
    'git@example.invalid:team/repo.git',
  );
  await f.change({ kind: 'edit', name: 'origin', fetchUrl, pushUrl: '' });
  assert.deepEqual((await f.settings()).remotes[0].pushUrls, []);
  assert.deepEqual((await f.operations.options(f.id)).remotes[0].pushUrls, [fetchUrl]);
  await runGit(f.root, ['update-ref', 'refs/remotes/origin/main', before.head]);
  await runGit(f.root, ['config', 'branch.main.remote', 'origin']);
  await runGit(f.root, ['config', 'branch.main.merge', 'refs/heads/main']);
  assert.deepEqual((await f.settings()).remotes[0].upstreamBranches, ['main']);
  await f.change({ kind: 'remove', name: 'origin' });
  assert.deepEqual((await f.settings()).remotes, []);
  assert.notEqual(
    (
      await runGit(f.root, ['show-ref', '--verify', 'refs/remotes/origin/main'], {
        allowFailure: true,
      })
    ).code,
    0,
  );
  assert.notEqual(
    (await runGit(f.root, ['config', '--get', 'branch.main.remote'], { allowFailure: true })).code,
    0,
  );
  assert.ok(fs.existsSync(fetchUrl));
  const after = await f.service.getState(f.id);
  assert.equal(after.head, before.head);
  assert.equal(after.indexRevision, before.indexRevision);
  assert.equal(fs.readFileSync(path.join(f.root, 'source.txt'), 'utf8'), 'unstaged\n');
  assert.equal(f.service.getWorkspace().drafts[f.id], '保留草稿');
});

test('拒绝无效名称、地址、凭据、重复名称以及未知 IPC 请求', async (t) => {
  const f = await fixture(t);
  for (const name of ['-origin', 'a b', 'a..b', 'a\nname', '', '.hidden'])
    await assert.rejects(
      f.change({ kind: 'add', name, fetchUrl: 'https://example.invalid/repo.git' }),
      { code: 'INVALID_REMOTE' },
    );
  for (const fetchUrl of [
    '',
    '-upload-pack=x',
    'https://host/repo\n',
    'ext::run something',
    'https://u:password@host/repo',
    'https://host/repo?token=private',
  ])
    await assert.rejects(f.change({ kind: 'add', name: 'origin', fetchUrl }), {
      code: 'INVALID_REMOTE_URL',
    });
  assert.deepEqual((await f.settings()).remotes, []);
  await f.change({ kind: 'add', name: 'origin', fetchUrl: 'https://example.invalid/repo.git' });
  await f.change({ kind: 'add', name: 'ipv6', fetchUrl: 'ssh://git@[::1]/team/repo.git' });
  assert.ok((await f.settings()).remotes.some((remote) => remote.name === 'ipv6'));
  await assert.rejects(
    f.change({ kind: 'add', name: 'origin', fetchUrl: 'https://example.invalid/other.git' }),
    { code: 'REMOTE_EXISTS' },
  );
  const handlers = createHandlers(f.service, async () => null);
  assert.equal((await invoke(handlers, 'changeRemote', [f.id, { kind: 'shell' }])).ok, false);
  assert.equal((await invoke(handlers, 'remoteSettings', ['../outside'])).ok, false);
});

test('外部配置变化拒绝旧表单，锁失败不冒充成功或删除锁文件', async (t) => {
  const f = await fixture(t);
  await f.change({ kind: 'add', name: 'origin', fetchUrl: 'https://example.invalid/repo.git' });
  const old = await f.settings();
  await runGit(f.root, ['remote', 'set-url', 'origin', 'https://example.invalid/external.git']);
  for (const kind of ['edit', 'remove'])
    await assert.rejects(
      f.operations.changeRemote(f.id, {
        kind,
        name: 'origin',
        revision: old.revision,
        fetchUrl: 'https://example.invalid/overwrite.git',
        pushUrl: '',
      }),
      { code: 'STALE_REMOTE_SETTINGS' },
    );
  const lock = path.join(f.root, '.git/config.lock');
  fs.writeFileSync(lock, 'external lock');
  await assert.rejects(
    f.change({ kind: 'edit', name: 'origin', fetchUrl: 'https://example.invalid/new.git' }),
  );
  assert.equal(fs.readFileSync(lock, 'utf8'), 'external lock');
  assert.deepEqual((await f.settings()).remotes[0].fetchUrls, [
    'https://example.invalid/external.git',
  ]);
});

test('多地址与引入配置明确保留且不被单地址编辑覆盖，地址凭据不回传', async (t) => {
  const f = await fixture(t);
  await runGit(f.root, ['remote', 'add', 'multi', 'https://example.invalid/one.git']);
  await runGit(f.root, ['config', '--add', 'remote.multi.url', 'https://example.invalid/two.git']);
  let multi = (await f.settings()).remotes.find((r) => r.name === 'multi');
  assert.equal(multi.editable, false);
  assert.equal(multi.fetchUrls.length, 2);
  await assert.rejects(
    f.change({ kind: 'edit', name: 'multi', fetchUrl: 'https://example.invalid/replacement.git' }),
    { code: 'REMOTE_READ_ONLY' },
  );
  const included = path.join(f.owned, 'included.gitconfig');
  await runGit(f.root, [
    'config',
    '--file',
    included,
    'remote.inherited.url',
    'https://example.invalid/inherited.git',
  ]);
  await runGit(f.root, ['config', 'include.path', included]);
  const inherited = (await f.settings()).remotes.find((r) => r.name === 'inherited');
  assert.equal(inherited.removable, false);
  await assert.rejects(f.change({ kind: 'remove', name: 'inherited' }), {
    code: 'REMOTE_READ_ONLY',
  });
  await runGit(f.root, [
    'remote',
    'add',
    'private',
    'https://user:secret-password@host/repo.git?token=secret-token',
  ]);
  const publicState = await f.settings();
  assert.doesNotMatch(JSON.stringify(publicState), /secret-password|secret-token/);
  assert.equal(publicState.remotes.find((r) => r.name === 'private').redacted, true);
  assert.equal(
    (await runGit(f.root, ['config', '--get-all', 'remote.multi.url'])).stdout.trim().split('\n')
      .length,
    2,
  );
});

test('分开保存获取与推送地址时，后续写失败如实报告部分完成', async (t) => {
  const f = await fixture(t);
  await f.change({
    kind: 'add',
    name: 'origin',
    fetchUrl: 'https://example.invalid/old.git',
    pushUrl: 'git@host:old.git',
  });
  const git = f.operations.git.bind(f.operations);
  const lock = path.join(f.root, '.git/config.lock');
  f.operations.git = async (root, args, options) => {
    if (
      args[0] === 'config' &&
      args.includes('--replace-all') &&
      args.includes('remote.origin.pushurl')
    )
      fs.writeFileSync(lock, 'external lock');
    return git(root, args, options);
  };
  await assert.rejects(
    f.change({
      kind: 'edit',
      name: 'origin',
      fetchUrl: 'https://example.invalid/new.git',
      pushUrl: 'git@host:new.git',
    }),
    (error) => error instanceof WorkbenchError && error.message.includes('部分配置已写入'),
  );
  f.operations.git = git;
  const actual = (await f.settings()).remotes[0];
  assert.equal(actual.fetchUrls[0], 'https://example.invalid/new.git');
  assert.equal(actual.pushUrls[0], 'git@host:old.git');
  assert.equal(fs.readFileSync(lock, 'utf8'), 'external lock');
});

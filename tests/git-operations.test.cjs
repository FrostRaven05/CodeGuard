const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GitService, runGit } = require('../electron/git-service.cjs');
const { GitOperations } = require('../electron/git-operations.cjs');
const { createHandlers, invoke } = require('../electron/api-controller.cjs');

async function fixture(t) {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'codeguard-sync-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(owned)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(owned).startsWith('codeguard-sync-test-'));
    fs.rmSync(owned, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const remote = path.join(owned, 'remote.git');
  const repo = path.join(owned, 'local with space');
  const other = path.join(owned, 'other');
  fs.mkdirSync(repo);
  await runGit(owned, ['init', '--bare', '--initial-branch=main', remote]);
  await runGit(repo, ['init', '--initial-branch=main']);
  const configure = async (root) => {
    for (const [key, value] of [
      ['user.name', 'Sync Test'],
      ['user.email', 'sync@example.invalid'],
      ['commit.gpgsign', 'false'],
      ['core.autocrlf', 'false'],
      ['core.hooksPath', path.join(root, '.git', 'hooks')],
    ])
      await runGit(root, ['config', key, value]);
  };
  await configure(repo);
  const write = (root, file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  const commit = async (root, file, content, message = 'change') => {
    write(root, file, content);
    await runGit(root, ['add', '--', file]);
    await runGit(root, ['commit', '-m', message]);
    return (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
  };
  const base = await commit(repo, 'source.txt', 'base\n', 'initial');
  await runGit(repo, ['remote', 'add', 'origin', remote]);
  await runGit(repo, ['push', '-u', 'origin', 'main']);
  await runGit(owned, ['clone', remote, other]);
  await configure(other);
  const service = new GitService(path.join(owned, 'settings'));
  const id = (await service.addRepository(repo)).id;
  const operations = new GitOperations(service);
  const perform = async (request) =>
    operations.execute(id, (await operations.prepare(id, request)).token);
  const head = async (root = repo) => (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
  return {
    owned,
    remote,
    repo,
    other,
    service,
    id,
    operations,
    perform,
    commit,
    write,
    head,
    base,
  };
}

test('获取更新远端跟踪引用，不改变 HEAD、工作区、暂存内容或草稿', async (t) => {
  const f = await fixture(t);
  const next = await f.commit(f.other, 'source.txt', 'remote\n');
  await runGit(f.other, ['push']);
  f.write(f.repo, 'local.txt', 'staged\n');
  await runGit(f.repo, ['add', '--', 'local.txt']);
  f.write(f.repo, 'local.txt', 'unstaged\n');
  f.service.saveDraft(f.id, 'keep draft');
  const before = await f.service.getState(f.id);
  const options = await f.operations.options(f.id);
  assert.equal(options.upstreamRemote, 'origin');
  assert.equal(options.upstreamBranch, 'main');
  await f.perform({ kind: 'fetch', remote: 'origin' });
  const after = await f.service.getState(f.id);
  assert.equal(after.head, before.head);
  assert.equal(after.indexRevision, before.indexRevision);
  assert.equal(after.behind, 1);
  assert.ok(after.branches.some((b) => b.hash === next && b.remote));
  assert.equal(fs.readFileSync(path.join(f.repo, 'local.txt'), 'utf8'), 'unstaged\n');
  assert.equal(f.service.getWorkspace().drafts[f.id], 'keep draft');
});

test('拉取预览先获取，执行只快进且不受 pull.rebase 和 merge.ff 配置影响', async (t) => {
  const f = await fixture(t);
  await runGit(f.repo, ['config', 'pull.rebase', 'true']);
  await runGit(f.repo, ['config', 'merge.ff', 'false']);
  const next = await f.commit(f.other, 'source.txt', 'remote\n');
  await runGit(f.other, ['push']);
  const p = await f.operations.prepare(f.id, { kind: 'pull', remote: 'origin', branch: 'main' });
  assert.equal(await f.head(), f.base);
  assert.equal(p.target, next);
  assert.equal(p.incoming, 1);
  assert.equal(p.canExecute, true);
  assert.equal(p.files[0].path, 'source.txt');
  await f.operations.execute(f.id, p.token);
  assert.equal(await f.head(), next);
  assert.equal(fs.readFileSync(path.join(f.repo, 'source.txt'), 'utf8'), 'remote\n');
});

test('分叉拉取不执行，显式合并才生成双父提交，草稿保持', async (t) => {
  const f = await fixture(t);
  const local = await f.commit(f.repo, 'local.txt', 'local\n');
  const remote = await f.commit(f.other, 'remote.txt', 'remote\n');
  await runGit(f.other, ['push']);
  f.service.saveDraft(f.id, 'saved');
  const p = await f.operations.prepare(f.id, { kind: 'pull', remote: 'origin', branch: 'main' });
  assert.equal(p.canExecute, false);
  assert.equal(p.localOnly, 1);
  assert.equal(p.incoming, 1);
  await assert.rejects(f.operations.execute(f.id, p.token), { code: 'STALE_PREVIEW' });
  assert.equal(await f.head(), local);
  const merge = await f.operations.prepare(f.id, { kind: 'merge', pullToken: p.token });
  await f.operations.execute(f.id, merge.token);
  const parents = (await runGit(f.repo, ['rev-list', '--parents', '-1', 'HEAD'])).stdout
    .trim()
    .split(' ');
  assert.deepEqual(parents.slice(1), [local, remote]);
  assert.equal(f.service.getWorkspace().drafts[f.id], 'saved');
});

test('无上游须显式选择目标，普通推送仅发送已预览提交，可明确设置上游', async (t) => {
  const f = await fixture(t);
  await runGit(f.repo, ['switch', '-c', 'feature/publish']);
  const sha = await f.commit(f.repo, 'new.txt', 'publish\n');
  assert.equal((await f.operations.options(f.id)).upstreamRemote, '');
  await assert.rejects(f.operations.prepare(f.id, { kind: 'push' }), { code: 'REMOTE_REQUIRED' });
  const p = await f.operations.prepare(f.id, {
    kind: 'push',
    remote: 'origin',
    branch: 'published',
    setUpstream: true,
  });
  assert.equal(p.head, sha);
  await f.operations.execute(f.id, p.token);
  assert.equal((await runGit(f.remote, ['rev-parse', 'refs/heads/published'])).stdout.trim(), sha);
  assert.equal((await f.operations.options(f.id)).upstreamBranch, 'published');
  assert.equal((await runGit(f.remote, ['rev-parse', 'refs/heads/main'])).stdout.trim(), f.base);
});

test('远端在推送预览后变化会拒绝执行，分叉不会提供强制推送', async (t) => {
  const f = await fixture(t);
  await f.commit(f.repo, 'local.txt', 'local\n');
  const p = await f.operations.prepare(f.id, { kind: 'push', remote: 'origin', branch: 'main' });
  const remote = await f.commit(f.other, 'remote.txt', 'remote\n');
  await runGit(f.other, ['push']);
  await assert.rejects(f.operations.execute(f.id, p.token), { code: 'STALE_PREVIEW' });
  const blocked = await f.operations.prepare(f.id, {
    kind: 'push',
    remote: 'origin',
    branch: 'main',
  });
  assert.equal(blocked.canExecute, false);
  await assert.rejects(f.operations.execute(f.id, blocked.token), { code: 'STALE_PREVIEW' });
  assert.equal((await runGit(f.remote, ['rev-parse', 'refs/heads/main'])).stdout.trim(), remote);
});

test('分支切换保留无覆盖风险改动，覆盖风险由 Git 拒绝，不 stash 或强制切换', async (t) => {
  const f = await fixture(t);
  await runGit(f.repo, ['switch', '-c', 'feature']);
  await f.commit(f.repo, 'source.txt', 'feature\n');
  await runGit(f.repo, ['switch', 'main']);
  f.write(f.repo, 'untracked.txt', 'keep\n');
  await f.perform({ kind: 'switch', source: 'refs/heads/feature' });
  assert.equal((await f.service.getState(f.id)).branch, 'feature');
  assert.equal(fs.readFileSync(path.join(f.repo, 'untracked.txt'), 'utf8'), 'keep\n');
  f.write(f.repo, 'source.txt', 'important local change\n');
  await assert.rejects(
    f.perform({ kind: 'switch', source: 'refs/heads/main' }),
    /overwritten|local changes/i,
  );
  assert.equal((await f.service.getState(f.id)).branch, 'feature');
  assert.equal(
    fs.readFileSync(path.join(f.repo, 'source.txt'), 'utf8'),
    'important local change\n',
  );
  assert.equal((await runGit(f.repo, ['stash', 'list'])).stdout, '');
});

async function conflict(f) {
  await runGit(f.repo, ['switch', '-c', 'feature']);
  await f.commit(f.repo, 'source.txt', 'feature\n');
  await runGit(f.repo, ['switch', 'main']);
  await f.commit(f.repo, 'source.txt', 'main\n');
  await assert.rejects(f.perform({ kind: 'merge', source: 'refs/heads/feature' }), {
    code: 'MERGE_INCOMPLETE',
  });
  assert.equal((await f.service.getState(f.id)).operation, 'merge');
  assert.equal((await f.service.getState(f.id)).files[0].conflict, true);
}

test('合并冲突保留现场，解决并暂存后可预览继续并核对双父提交', async (t) => {
  const f = await fixture(t);
  await conflict(f);
  await assert.rejects(f.operations.prepare(f.id, { kind: 'continueMerge' }), {
    code: 'CONFLICTS',
  });
  f.write(f.repo, 'source.txt', 'resolved\n');
  await f.service.changeStaging(f.id, 'source.txt', 'stage');
  const p = await f.operations.prepare(f.id, { kind: 'continueMerge' });
  assert.match(p.message, /Merge/);
  await f.operations.execute(f.id, p.token);
  assert.equal((await f.service.getState(f.id)).operation, null);
  assert.equal(
    (await runGit(f.repo, ['rev-list', '--parents', '-1', 'HEAD'])).stdout.trim().split(' ').length,
    3,
  );
  assert.equal(fs.readFileSync(path.join(f.repo, 'source.txt'), 'utf8'), 'resolved\n');
});

test('中止合并需要预览，冲突处理再变化使旧预览失效，重新确认后恢复', async (t) => {
  const f = await fixture(t);
  await conflict(f);
  const before = await f.head();
  const p = await f.operations.prepare(f.id, { kind: 'abortMerge' });
  f.write(f.repo, 'source.txt', 'partial resolution\n');
  await assert.rejects(f.operations.execute(f.id, p.token), { code: 'STALE_PREVIEW' });
  await f.perform({ kind: 'abortMerge' });
  assert.equal((await f.service.getState(f.id)).operation, null);
  assert.equal(await f.head(), before);
  assert.equal(fs.readFileSync(path.join(f.repo, 'source.txt'), 'utf8'), 'main\n');
});

test('来源、远端配置、本地状态或锁变化使预览失效，IPC 拒绝任意参数', async (t) => {
  const f = await fixture(t);
  await runGit(f.repo, ['branch', 'feature']);
  const p = await f.operations.prepare(f.id, { kind: 'switch', source: 'refs/heads/feature' });
  await f.commit(f.repo, 'source.txt', 'moved\n');
  await assert.rejects(f.operations.execute(f.id, p.token), { code: 'STALE_PREVIEW' });
  const sourcePreview = await f.operations.prepare(f.id, {
    kind: 'switch',
    source: 'refs/heads/feature',
  });
  await runGit(f.repo, ['update-ref', 'refs/heads/feature', await f.head()]);
  await assert.rejects(f.operations.execute(f.id, sourcePreview.token), { code: 'STALE_PREVIEW' });
  const fetch = await f.operations.prepare(f.id, { kind: 'fetch', remote: 'origin' });
  await runGit(f.repo, ['config', 'remote.origin.pushurl', f.other]);
  await assert.rejects(f.operations.execute(f.id, fetch.token), { code: 'STALE_PREVIEW' });
  const locked = await f.operations.prepare(f.id, { kind: 'switch', source: 'refs/heads/feature' });
  fs.writeFileSync(path.join(f.repo, '.git', 'index.lock'), 'test');
  await assert.rejects(f.operations.execute(f.id, locked.token), { code: 'INDEX_LOCKED' });
  assert.equal(fs.readFileSync(path.join(f.repo, '.git', 'index.lock'), 'utf8'), 'test');
  fs.unlinkSync(path.join(f.repo, '.git', 'index.lock'));
  const handlers = createHandlers(f.service, async () => null);
  for (const request of [
    { kind: 'reset' },
    { kind: 'push', remote: '--force', branch: 'main' },
    { kind: 'switch', source: 'HEAD~1' },
    { kind: 'push', remote: 'origin', branch: 'main:refs/heads/overwrite' },
  ]) {
    const response = await invoke(handlers, 'prepareOperation', [f.id, request]);
    assert.equal(response.ok, false);
  }
});

test('多个推送地址拒绝执行，普通推送保留 pre-push 钩子和失败详情', async (t) => {
  const f = await fixture(t);
  await f.commit(f.repo, 'local.txt', 'local\n');
  await runGit(f.repo, ['config', '--add', 'remote.origin.pushurl', f.remote]);
  await runGit(f.repo, ['config', '--add', 'remote.origin.pushurl', f.other]);
  await assert.rejects(
    f.operations.prepare(f.id, { kind: 'push', remote: 'origin', branch: 'main' }),
    { code: 'MULTIPLE_PUSH_URLS' },
  );
  await runGit(f.repo, ['config', '--unset-all', 'remote.origin.pushurl']);
  fs.writeFileSync(
    path.join(f.repo, '.git', 'hooks', 'pre-push'),
    '#!/bin/sh\necho "test-pre-push-rejected" >&2\nexit 1\n',
    { mode: 0o755 },
  );
  await assert.rejects(
    f.perform({ kind: 'push', remote: 'origin', branch: 'main' }),
    /test-pre-push-rejected/,
  );
  assert.equal((await runGit(f.remote, ['rev-parse', 'refs/heads/main'])).stdout.trim(), f.base);
});

test('脏工作区拒绝拉取与合并；游离 HEAD 可安全切回本地分支', async (t) => {
  const f = await fixture(t);
  await runGit(f.repo, ['branch', 'feature']);
  f.write(f.repo, 'source.txt', 'unsaved\n');
  for (const request of [
    { kind: 'pull', remote: 'origin', branch: 'main' },
    { kind: 'merge', source: 'refs/heads/feature' },
  ])
    await assert.rejects(f.operations.prepare(f.id, request), { code: 'DIRTY_WORKTREE' });
  assert.equal(fs.readFileSync(path.join(f.repo, 'source.txt'), 'utf8'), 'unsaved\n');
  await runGit(f.repo, ['switch', '--detach', f.base]);
  await assert.rejects(
    f.operations.prepare(f.id, { kind: 'push', remote: 'origin', branch: 'main' }),
    { code: 'BRANCH_REQUIRED' },
  );
  await f.perform({ kind: 'switch', source: 'refs/heads/main' });
  assert.equal((await f.service.getState(f.id)).branch, 'main');
  assert.equal(fs.readFileSync(path.join(f.repo, 'source.txt'), 'utf8'), 'unsaved\n');
});

test('认证和网络错误分类且隐藏 URL 凭据；无远端不猜测目标', async (t) => {
  const http = require('node:http');
  const f = await fixture(t);
  let status = 401;
  const server = http.createServer((_req, res) => {
    res.writeHead(status, { 'WWW-Authenticate': 'Basic realm="test"' });
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await runGit(f.repo, ['config', 'credential.helper', '']);
  const fakeUrl = `http://fixture-user:fixture-password@127.0.0.1:${server.address().port}/repo`;
  await runGit(f.repo, ['remote', 'set-url', 'origin', fakeUrl]);
  assert.ok(!JSON.stringify(await f.operations.options(f.id)).includes('fixture-password'));
  await assert.rejects(f.perform({ kind: 'fetch', remote: 'origin' }), (error) => {
    assert.equal(error.code, 'REMOTE_AUTH');
    assert.ok(!`${error.message}${error.details}`.includes('fixture-password'));
    return true;
  });
  status = 503;
  await assert.rejects(f.perform({ kind: 'fetch', remote: 'origin' }), { code: 'REMOTE_NETWORK' });
  await runGit(f.repo, ['remote', 'remove', 'origin']);
  assert.equal((await f.operations.options(f.id)).remotes.length, 0);
  await assert.rejects(f.operations.prepare(f.id, { kind: 'fetch', remote: 'origin' }), {
    code: 'REMOTE_REQUIRED',
  });
});

test('远端未获取的新分支可检出并设置上游，随后拉取只更新该分支', async (t) => {
  const f = await fixture(t);
  await runGit(f.other, ['switch', '-c', 'feature/new']);
  const remoteHead = await f.commit(f.other, 'new.txt', 'remote new\n');
  await runGit(f.other, ['push', 'origin', 'HEAD:refs/heads/feature/new']);
  f.write(f.repo, 'keep.txt', 'local untracked\n');
  f.service.saveDraft(f.id, 'keep new branch draft');
  const preview = await f.operations.prepare(f.id, {
    kind: 'checkout',
    remote: 'origin',
    branch: 'feature/new',
    localBranch: 'feature/new-local',
  });
  assert.equal(await f.head(), f.base);
  assert.equal(preview.target, remoteHead);
  assert.equal((await f.operations.options(f.id)).state.branch, 'main');
  const checked = await f.operations.execute(f.id, preview.token);
  assert.equal(checked.warning, null);
  assert.equal(checked.state.branch, 'feature/new-local');
  assert.equal(checked.state.head, remoteHead);
  assert.equal(fs.readFileSync(path.join(f.repo, 'keep.txt'), 'utf8'), 'local untracked\n');
  assert.equal(f.service.getWorkspace().drafts[f.id], 'keep new branch draft');
  const options = await f.operations.options(f.id);
  assert.equal(options.upstreamRemote, 'origin');
  assert.equal(options.upstreamBranch, 'feature/new');
  fs.unlinkSync(path.join(f.repo, 'keep.txt'));
  const next = await f.commit(f.other, 'new.txt', 'remote next\n');
  await runGit(f.other, ['push', 'origin', 'HEAD:refs/heads/feature/new']);
  await f.perform({ kind: 'pull', remote: options.upstreamRemote, branch: options.upstreamBranch });
  assert.equal(await f.head(), next);
  assert.equal((await runGit(f.repo, ['rev-parse', 'refs/heads/main'])).stdout.trim(), f.base);
});

test('新建分支保留暂存内容和草稿，重复名称、非法名称与预览后同名创建拒绝执行', async (t) => {
  const f = await fixture(t);
  f.write(f.repo, 'staged.txt', 'staged\n');
  await runGit(f.repo, ['add', '--', 'staged.txt']);
  const before = await f.service.getState(f.id);
  f.service.saveDraft(f.id, 'keep create draft');
  const stagedTree = (await runGit(f.repo, ['write-tree'])).stdout;
  const result = await f.perform({ kind: 'createBranch', localBranch: 'feature/local' });
  assert.equal(result.state.branch, 'feature/local');
  assert.equal(result.state.head, f.base);
  assert.equal((await runGit(f.repo, ['write-tree'])).stdout, stagedTree);
  assert.deepEqual(result.state.files, before.files);
  assert.equal(f.service.getWorkspace().drafts[f.id], 'keep create draft');
  await assert.rejects(
    f.operations.prepare(f.id, { kind: 'createBranch', localBranch: 'feature/local' }),
    { code: 'BRANCH_EXISTS' },
  );
  for (const localBranch of ['-bad', '../bad', 'a..b', 'bad\nname'])
    await assert.rejects(f.operations.prepare(f.id, { kind: 'createBranch', localBranch }), {
      code: 'INVALID_TARGET',
    });
  const preview = await f.operations.prepare(f.id, {
    kind: 'createBranch',
    localBranch: 'feature/raced',
  });
  await runGit(f.repo, ['branch', 'feature/raced']);
  await assert.rejects(f.operations.execute(f.id, preview.token), { code: 'STALE_PREVIEW' });
  assert.equal((await f.service.getState(f.id)).branch, 'feature/local');
});

test('远端检出拒绝来源变化与覆盖本地文件，失败不创建分支或改写工作文件', async (t) => {
  const f = await fixture(t);
  await runGit(f.other, ['switch', '-c', 'feature/checkout']);
  await f.commit(f.other, 'source.txt', 'remote change\n');
  await runGit(f.other, ['push', 'origin', 'HEAD:refs/heads/feature/checkout']);
  const request = {
    kind: 'checkout',
    remote: 'origin',
    branch: 'feature/checkout',
    localBranch: 'feature/checkout',
  };
  let preview = await f.operations.prepare(f.id, request);
  await runGit(f.repo, ['update-ref', 'refs/remotes/origin/feature/checkout', f.base]);
  await assert.rejects(f.operations.execute(f.id, preview.token), { code: 'STALE_PREVIEW' });
  // Ref moves back only in this disposable test fixture, never in a user repository.
  preview = await f.operations.prepare(f.id, request);
  f.write(f.repo, 'source.txt', 'local must survive\n');
  preview = await f.operations.prepare(f.id, request);
  await assert.rejects(f.operations.execute(f.id, preview.token));
  assert.equal((await f.service.getState(f.id)).branch, 'main');
  assert.equal(fs.readFileSync(path.join(f.repo, 'source.txt'), 'utf8'), 'local must survive\n');
  assert.equal(
    (
      await runGit(f.repo, ['show-ref', '--verify', '--quiet', 'refs/heads/feature/checkout'], {
        allowFailure: true,
      })
    ).code,
    1,
  );
});

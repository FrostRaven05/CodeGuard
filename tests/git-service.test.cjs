const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GitService, runGit } = require('../electron/git-service.cjs');
const { createHandlers, invoke } = require('../electron/api-controller.cjs');

async function fixture(t) {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'codeguard-test-'));
  const repo = path.join(owned, 'repository with space');
  fs.mkdirSync(repo);
  t.after(() => {
    const resolved = path.resolve(owned);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('codeguard-test-'));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  await runGit(repo, ['init', '--initial-branch=main']);
  for (const [key, value] of [
    ['user.name', 'CodeGuard Test'],
    ['user.email', 'codeguard@example.invalid'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false'],
    ['core.hooksPath', path.join(repo, '.git', 'hooks')],
  ])
    await runGit(repo, ['config', key, value]);
  const storage = path.join(owned, 'settings');
  const service = new GitService(storage);
  const repository = await service.addRepository(repo);
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), value);
  };
  const commitAll = async (message) => {
    await runGit(repo, ['add', '--all']);
    await runGit(repo, ['commit', '-m', message]);
  };
  return { repo, owned, storage, service, id: repository.id, write, commitAll };
}

test('仓库列表、当前选择与草稿可持久化，移除仅解除关联', async (t) => {
  const f = await fixture(t);
  f.service.saveDraft(f.id, '保留的提交草稿\n\n正文');
  const reopened = new GitService(f.storage);
  assert.equal(reopened.getWorkspace().activeRepositoryId, f.id);
  assert.equal(reopened.getWorkspace().drafts[f.id], '保留的提交草稿\n\n正文');
  assert.equal((await reopened.addRepository(f.repo)).id, f.id);
  assert.equal(reopened.getWorkspace().repositories.length, 1);
  reopened.removeRepository(f.id);
  assert.equal(reopened.getWorkspace().repositories.length, 0);
  assert.ok(fs.existsSync(path.join(f.repo, '.git')));
});

test('空仓库显示真实分支和空历史，空暂存区不能提交', async (t) => {
  const f = await fixture(t),
    state = await f.service.getState(f.id);
  assert.equal(state.branch, 'main');
  assert.equal(state.head, null);
  assert.deepEqual(state.files, []);
  assert.deepEqual(await f.service.getHistory(f.id), []);
  await assert.rejects(f.service.prepareCommit(f.id), { code: 'EMPTY_INDEX' });
});

test('多个仓库可切换并记住选择，无效目录不会加入列表', async (t) => {
  const f = await fixture(t);
  const other = path.join(f.owned, 'second repository');
  fs.mkdirSync(other);
  await runGit(other, ['init', '--initial-branch=other']);
  const second = await f.service.addRepository(other);
  assert.notEqual(second.id, f.id);
  assert.equal((await f.service.getState(second.id)).branch, 'other');
  f.service.selectRepository(f.id);
  assert.equal(new GitService(f.storage).getWorkspace().activeRepositoryId, f.id);
  await assert.rejects(f.service.addRepository(path.join(f.owned, 'missing')), {
    code: 'INVALID_PATH',
  });
  await assert.rejects(f.service.addRepository(f.storage), { code: 'GIT_ERROR' });
  assert.equal(f.service.getWorkspace().repositories.length, 2);
  f.service.removeRepository(second.id);
  assert.equal(f.service.getWorkspace().activeRepositoryId, f.id);
  assert.ok(fs.existsSync(other));
});

test('所有者不匹配时解释 Git 信任限制，显式信任后可重新打开且不自动修改配置', async (t) => {
  const f = await fixture(t);
  const config = path.join(f.owned, 'isolated-global.gitconfig');
  fs.writeFileSync(config, '');
  const overrides = {
    GIT_TEST_ASSUME_DIFFERENT_OWNER: '1',
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '0',
  };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, overrides);
    const fresh = new GitService(path.join(f.owned, 'fresh-settings'));
    await assert.rejects(fresh.addRepository(f.repo), (error) => {
      assert.equal(error.code, 'DUBIOUS_OWNERSHIP');
      assert.match(error.message, /所有者.*当前账户/);
      assert.match(error.message, /信任.*重新打开/);
      assert.match(error.details, /fatal: detected dubious ownership/);
      assert.match(error.details, /safe\.directory/);
      return true;
    });
    assert.deepEqual(fresh.getWorkspace().repositories, []);
    assert.equal(fs.readFileSync(config, 'utf8'), '');
    await runGit(f.owned, [
      'config',
      '--global',
      '--add',
      'safe.directory',
      f.repo.replaceAll('\\', '/'),
    ]);
    const repository = await fresh.addRepository(f.repo);
    assert.equal((await fresh.getState(repository.id)).branch, 'main');
    const trusted = await runGit(f.owned, ['config', '--global', '--get-all', 'safe.directory']);
    assert.equal(trusted.stdout.trim(), f.repo.replaceAll('\\', '/'));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('读取仓库不执行配置的 fsmonitor，索引锁被保留并明确报告', async (t) => {
  const f = await fixture(t);
  const monitor = path.join(f.repo, '.git', 'hooks', 'fixture-monitor');
  fs.writeFileSync(monitor, '#!/bin/sh\necho executed > monitor-executed.txt\n', { mode: 0o755 });
  await runGit(f.repo, ['config', 'core.fsmonitor', monitor]);
  f.write('a.txt', 'staged\n');
  await f.service.changeStaging(f.id, 'a.txt', 'stage');
  const lock = path.join(f.repo, '.git', 'index.lock');
  fs.writeFileSync(lock, 'test lock');
  const state = await f.service.getState(f.id);
  assert.equal(state.locked, true);
  assert.equal(fs.existsSync(path.join(f.repo, 'monitor-executed.txt')), false);
  await assert.rejects(f.service.prepareCommit(f.id), { code: 'INDEX_LOCKED' });
  assert.equal(fs.readFileSync(lock, 'utf8'), 'test lock');
});

test('同一文件的已暂存和未暂存差异分别对应索引与工作区，提交只使用索引', async (t) => {
  const f = await fixture(t);
  f.write('source.ts', 'baseline\n');
  await f.commitAll('baseline');
  f.write('source.ts', 'staged version\n');
  await f.service.changeStaging(f.id, 'source.ts', 'stage');
  f.write('source.ts', 'worktree version\n');
  const state = await f.service.getState(f.id);
  assert.equal(state.files[0].indexStatus, 'M');
  assert.equal(state.files[0].worktreeStatus, 'M');
  const indexDiff = await f.service.getDiff(f.id, { scope: 'index', path: 'source.ts' });
  const worktreeDiff = await f.service.getDiff(f.id, { scope: 'worktree', path: 'source.ts' });
  assert.match(indexDiff.text, /\+staged version/);
  assert.doesNotMatch(indexDiff.text, /worktree version/);
  assert.match(worktreeDiff.text, /\+worktree version/);
  assert.match(worktreeDiff.text, /-staged version/);
  const preview = await f.service.prepareCommit(f.id);
  const result = await f.service.commit(f.id, preview.token, 'commit staged only');
  assert.equal(result.treeMatchesPreview, true);
  assert.equal((await runGit(f.repo, ['show', 'HEAD:source.ts'])).stdout, 'staged version\n');
  assert.equal(fs.readFileSync(path.join(f.repo, 'source.ts'), 'utf8'), 'worktree version\n');
  assert.equal((await f.service.getState(f.id)).files[0].indexStatus, '.');
});

test('初始提交前取消暂存，不删除文件也不丢失之后的编辑', async (t) => {
  const f = await fixture(t);
  f.write('--new file.txt', 'staged\n');
  await f.service.changeStaging(f.id, '--new file.txt', 'stage');
  f.write('--new file.txt', 'edited after staging\n');
  await f.service.changeStaging(f.id, '--new file.txt', 'unstage');
  const state = await f.service.getState(f.id);
  assert.equal(state.files[0].untracked, true);
  assert.equal(
    fs.readFileSync(path.join(f.repo, '--new file.txt'), 'utf8'),
    'edited after staging\n',
  );
});

test('中文、空格、引号和看似命令的文件名被当作字面路径', async (t) => {
  const f = await fixture(t);
  const names = ["中文 space 'quote.txt", '$(echo hello).txt', '--config=test.txt'];
  for (const name of names) {
    f.write(name, `${name}\n`);
    const diff = await f.service.getDiff(f.id, { scope: 'worktree', path: name });
    assert.match(diff.text, /new file mode/);
  }
  await Promise.all(names.map((name) => f.service.changeStaging(f.id, name, 'stage')));
  assert.equal(
    (await f.service.getState(f.id)).files.filter((file) => file.indexStatus === 'A').length,
    names.length,
  );
  for (const name of names) await f.service.changeStaging(f.id, name, 'unstage');
  assert.ok(names.every((name) => fs.existsSync(path.join(f.repo, name))));
});

test('重命名与删除可查看、暂存并取消，工作区内容保持不变', async (t) => {
  const f = await fixture(t);
  f.write('before.txt', 'rename content\n');
  f.write('delete.txt', 'delete content\n');
  await f.commitAll('baseline');
  fs.renameSync(path.join(f.repo, 'before.txt'), path.join(f.repo, 'after file.txt'));
  fs.unlinkSync(path.join(f.repo, 'delete.txt'));
  for (const name of ['before.txt', 'after file.txt', 'delete.txt'])
    await f.service.changeStaging(f.id, name, 'stage');
  const state = await f.service.getState(f.id);
  const renamed = state.files.find((file) => file.indexStatus === 'R');
  assert.equal(renamed.path, 'after file.txt');
  assert.equal(renamed.previousPath, 'before.txt');
  const diff = await f.service.getDiff(f.id, { scope: 'index', path: renamed.path });
  assert.match(diff.text, /rename from before.txt/);
  await f.service.changeStaging(f.id, renamed.path, 'unstage');
  await f.service.changeStaging(f.id, 'delete.txt', 'unstage');
  assert.ok(fs.existsSync(path.join(f.repo, 'after file.txt')));
  assert.equal(fs.existsSync(path.join(f.repo, 'before.txt')), false);
  assert.equal(fs.existsSync(path.join(f.repo, 'delete.txt')), false);
});

test('暂存版本变化后拒绝旧提交预览，并保留提交草稿', async (t) => {
  const f = await fixture(t);
  f.write('a.txt', 'first\n');
  await f.service.changeStaging(f.id, 'a.txt', 'stage');
  const preview = await f.service.prepareCommit(f.id);
  f.write('a.txt', 'second\n');
  await f.service.changeStaging(f.id, 'a.txt', 'stage');
  await assert.rejects(f.service.commit(f.id, preview.token, 'keep this draft'), {
    code: 'STALE_PREVIEW',
  });
  assert.equal(f.service.getWorkspace().drafts[f.id], 'keep this draft');
  assert.deepEqual(await f.service.getHistory(f.id), []);
});

test('即使新分支指向同一提交，切换分支仍会使旧预览失效', async (t) => {
  const f = await fixture(t);
  f.write('a.txt', 'base\n');
  await f.commitAll('base');
  f.write('a.txt', 'change\n');
  await f.service.changeStaging(f.id, 'a.txt', 'stage');
  const preview = await f.service.prepareCommit(f.id);
  await runGit(f.repo, ['switch', '-c', 'other']);
  await assert.rejects(f.service.commit(f.id, preview.token, 'wrong target'), {
    code: 'STALE_PREVIEW',
  });
});

test('钩子失败显示真实错误并保存草稿，修正后可以重新提交', async (t) => {
  const f = await fixture(t);
  f.write('a.txt', 'value\n');
  await f.service.changeStaging(f.id, 'a.txt', 'stage');
  const hook = path.join(f.repo, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\necho "fixture hook rejected" >&2\nexit 1\n', { mode: 0o755 });
  const preview = await f.service.prepareCommit(f.id);
  await assert.rejects(
    f.service.commit(f.id, preview.token, 'preserved message'),
    /fixture hook rejected/,
  );
  assert.equal(f.service.getWorkspace().drafts[f.id], 'preserved message');
  assert.equal((await f.service.getState(f.id)).head, null);
  fs.unlinkSync(hook);
  const result = await f.service.commit(f.id, preview.token, 'preserved message');
  assert.match(result.hash, /^[a-f0-9]{40}$/);
  assert.equal(f.service.getWorkspace().drafts[f.id], '');
});

test('钩子改变索引时核对实际提交，不跳过钩子或自动回滚', async (t) => {
  const f = await fixture(t);
  f.write('a.txt', 'before hook\n');
  await f.service.changeStaging(f.id, 'a.txt', 'stage');
  const hook = path.join(f.repo, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\nprintf "hook changed\\n" > a.txt\ngit add -- a.txt\n', {
    mode: 0o755,
  });
  const preview = await f.service.prepareCommit(f.id);
  const result = await f.service.commit(f.id, preview.token, 'hook result');
  assert.equal(result.treeMatchesPreview, false);
  assert.ok(result.warning);
  assert.equal((await runGit(f.repo, ['show', 'HEAD:a.txt'])).stdout, 'hook changed\n');
  assert.equal(fs.readFileSync(path.join(f.repo, 'a.txt'), 'utf8'), 'hook changed\n');
});

test('根提交、分支与合并提交的第一父差异可读取，历史浏览不改工作区', async (t) => {
  const f = await fixture(t);
  f.write('root.txt', 'root\n');
  await f.commitAll('root');
  const rootHash = (await runGit(f.repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const root = await f.service.getCommit(f.id, rootHash);
  assert.equal(root.commit.parents.length, 0);
  assert.equal(root.files[0].path, 'root.txt');
  assert.match(
    (await f.service.getDiff(f.id, { scope: 'commit', commit: rootHash, path: 'root.txt' })).text,
    /\+root/,
  );
  await runGit(f.repo, ['switch', '-c', 'side']);
  f.write('side.go', 'package side\n');
  await f.commitAll('side');
  await runGit(f.repo, ['switch', 'main']);
  f.write('main.py', 'value = 1\n');
  await f.commitAll('main');
  await runGit(f.repo, ['merge', '--no-ff', 'side', '-m', 'merge side']);
  const before = await f.service.getState(f.id),
    history = await f.service.getHistory(f.id);
  assert.equal(history.length, 4);
  assert.equal(history[0].parents.length, 2);
  const merge = await f.service.getCommit(f.id, history[0].hash);
  assert.equal(merge.firstParentView, true);
  assert.deepEqual(
    merge.files.map((file) => file.path),
    ['side.go'],
  );
  assert.match(
    (await f.service.getDiff(f.id, { scope: 'commit', commit: merge.commit.hash, path: 'side.go' }))
      .text,
    /\+package side/,
  );
  const after = await f.service.getState(f.id);
  assert.equal(after.head, before.head);
  assert.equal(after.branch, 'main');
  assert.deepEqual(after.files, []);
});

test('二进制和超大未跟踪文件有明确提示，目录外路径与任意命令被拒绝', async (t) => {
  const f = await fixture(t);
  f.write('binary.bin', Buffer.from([0, 10, 20]));
  f.write('large.txt', 'x'.repeat(800_000));
  assert.equal(
    (await f.service.getDiff(f.id, { scope: 'worktree', path: 'binary.bin' })).binary,
    true,
  );
  assert.equal(
    (await f.service.getDiff(f.id, { scope: 'worktree', path: 'large.txt' })).truncated,
    true,
  );
  await assert.rejects(f.service.getDiff(f.id, { scope: 'worktree', path: '../outside.txt' }), {
    code: 'INVALID_PATH',
  });
  const handlers = createHandlers(f.service, () => null);
  const unknown = await invoke(handlers, 'executeShell', ['echo unexpected']);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'INVALID_REQUEST');
  assert.equal((await invoke(handlers, 'state', ['not-a-repository'])).ok, false);
});

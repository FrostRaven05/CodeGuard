const { app } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GitService, runGit } = require('../electron/git-service.cjs');
const { createWorkbenchWindow } = require('../electron/workbench-window.cjs');
const { startMockModel } = require('./fixtures/mock-model.cjs');

const owned = process.env.CODEGUARD_SMOKE_ROOT;
if (!owned || !path.basename(owned).startsWith('codeguard-desktop-test-'))
  throw new Error('A dedicated temporary test profile is required.');
const profile = path.join(owned, 'profile');
fs.mkdirSync(profile);
app.setPath('userData', profile);
app
  .whenReady()
  .then(async () => {
    const root = path.join(owned, 'repository');
    fs.mkdirSync(root);
    await runGit(root, ['init', '--initial-branch=main']);
    for (const [key, value] of [
      ['user.name', 'Desktop Test'],
      ['user.email', 'desktop@example.invalid'],
      ['commit.gpgsign', 'false'],
      ['core.autocrlf', 'false'],
      ['core.hooksPath', path.join(root, '.git', 'hooks')],
    ])
      await runGit(root, ['config', key, value]);
    fs.writeFileSync(path.join(root, 'source.ts'), 'staged version\n');
    await runGit(root, ['add', '--', 'source.ts']);
    fs.writeFileSync(path.join(root, 'source.ts'), 'worktree version\n');
    const service = new GitService(path.join(owned, 'workspace'));
    const window = await createWorkbenchWindow(service, {
      visible: false,
      chooseDirectory: async () => root,
    });
    // Exercise the actual sandboxed preload and validated IPC boundary, rather than a mock transport.
    const isolation = await window.webContents.executeJavaScript(
      '({ nodeVisible: typeof require !== "undefined", bridgeVisible: typeof window.codeguard === "object" })',
    );
    assert.equal(isolation.nodeVisible, false);
    assert.equal(isolation.bridgeVisible, true);
    const call = async (method, ...args) => {
      const result = await window.webContents.executeJavaScript(
        `window.codeguard[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
      );
      assert.equal(result.ok, true, JSON.stringify(result));
      return result.value;
    };
    assert.equal((await call('workspace')).repositories.length, 0);
    const repository = await call('pickRepository');
    const state = await call('state', repository.id);
    assert.equal(state.branch, 'main');
    assert.equal(state.files[0].indexStatus, 'A');
    assert.equal(state.files[0].worktreeStatus, 'M');
    const diff = await call('diff', repository.id, { scope: 'index', path: 'source.ts' });
    assert.match(diff.text, /staged version/);
    assert.doesNotMatch(diff.text, /worktree version/);
    const mock = await startMockModel();
    try {
      const configured = await call('saveModelSettings', {
        baseUrl: mock.baseUrl,
        model: 'desktop-fixture',
        apiKey: 'desktop-fixture-key',
        maxContextChars: 60000,
        excludePatterns: '',
      });
      assert.equal(configured.hasApiKey, true);
      assert.ok(!JSON.stringify(configured).includes('desktop-fixture-key'));
      assert.ok(
        !fs
          .readFileSync(path.join(owned, 'workspace', 'model-settings.json'), 'utf8')
          .includes('desktop-fixture-key'),
      );
      assert.match((await call('testModelConnection')).message, /连接成功/);
      await call('saveReviewOptions', repository.id, { standards: '', requirements: '' });
      const sending = await call('prepareReview', repository.id);
      assert.deepEqual(
        sending.included.map((item) => item.path),
        ['source.ts'],
      );
      const reviewed = await call('startReview', repository.id, sending.token);
      assert.equal(reviewed.findings.length, 1);
      assert.equal(reviewed.findings[0].line, 1);
      assert.equal((await call('reviewState', repository.id)).latest.stale, false);
      assert.match(JSON.stringify(mock.requests.at(-1)), /staged version/);
      assert.doesNotMatch(JSON.stringify(mock.requests.at(-1)), /worktree version/);
    } finally {
      await mock.close();
    }
    await call('saveDraft', repository.id, 'desktop IPC smoke');
    assert.equal(
      new GitService(path.join(owned, 'workspace')).getWorkspace().drafts[repository.id],
      'desktop IPC smoke',
    );
    const preview = await call('prepareCommit', repository.id);
    const result = await call('commit', repository.id, preview.token, 'desktop IPC smoke');
    assert.equal(result.treeMatchesPreview, true);
    assert.equal((await call('reviewState', repository.id)).latest.stale, true);
    assert.equal((await call('history', repository.id))[0].hash, result.hash);
    assert.equal((await runGit(root, ['show', 'HEAD:source.ts'])).stdout, 'staged version\n');
    assert.equal(fs.readFileSync(path.join(root, 'source.ts'), 'utf8'), 'worktree version\n');
    console.log(
      'Desktop smoke passed: isolated renderer, preload/IPC, encrypted model settings, model HTTP, staged review, advisory finding, stale state, draft, commit and history.',
    );
    window.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

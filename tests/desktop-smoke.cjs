const { app, screen, safeStorage } = require('electron');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GitService, runGit } = require('../electron/git-service.cjs');
const { createWorkbenchWindow } = require('../electron/workbench-window.cjs');
const { startMockModel } = require('./fixtures/mock-model.cjs');
const { ModelSettings } = require('../electron/model-settings.cjs');

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
    // Keep React scheduler work active while this test window stays hidden.
    // Chromium may otherwise defer UI updates as the background run gets longer.
    window.webContents.setBackgroundThrottling(false);
    const executeFixtureScript = window.webContents.executeJavaScript.bind(window.webContents);
    window.webContents.executeJavaScript = async (script, ...args) => {
      try {
        return await executeFixtureScript(script, ...args);
      } catch (error) {
        throw new Error(`${error.message}\nFixture script: ${script.slice(0, 700)}`, {
          cause: error,
        });
      }
    };
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
    const secondRoot = path.join(owned, 'second-repository');
    fs.mkdirSync(secondRoot);
    await runGit(secondRoot, ['init', '--initial-branch=main']);
    const secondRepository = await service.addRepository(secondRoot);
    service.selectRepository(repository.id);
    // Reload the real renderer with the fixture repository, then verify titlebar safe areas.
    await window.loadFile(path.resolve('dist/index.html'));
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (document.querySelector('.current-branch')) { clearInterval(timer); clearTimeout(deadline); resolve(true); }
      }, 25);
      const deadline = setTimeout(() => { clearInterval(timer); reject(new Error('Repository UI did not load')); }, 5000);
    })`);
    const waitForChangesUI = (condition) =>
      window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const timer = setInterval(() => { if (${condition}) { clearInterval(timer); clearTimeout(deadline); resolve(true); } }, 25);
        const deadline = setTimeout(() => { clearInterval(timer); reject(new Error('Changed files UI did not settle')); }, 5000);
      })`);
    await waitForChangesUI("document.querySelectorAll('.sidebar .file-select').length === 2");
    assert.equal(
      await window.webContents.executeJavaScript(
        "!!document.querySelector('.sidebar .branch-item, .sidebar .sidebar-section, .main-panel .change-group')",
      ),
      false,
    );
    // Both versions of the same file live in the sidebar; clicking one selects its real diff.
    await window.webContents.executeJavaScript(
      "document.querySelectorAll('.sidebar .file-select')[1].click()",
    );
    await waitForChangesUI(
      "document.querySelector('.diff-lines')?.textContent.includes('staged version') && document.querySelector('.scope-chip')?.textContent.includes('已暂存')",
    );
    assert.equal(
      await window.webContents.executeJavaScript("!!document.querySelector('.diff-file-nav')"),
      false,
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        "document.querySelectorAll('.sidebar .file-select[aria-current=true]').length",
      ),
      1,
    );
    assert.doesNotMatch(
      await window.webContents.executeJavaScript(
        "document.querySelector('.diff-lines').textContent",
      ),
      /worktree version/,
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('.sidebar .group-heading').click()",
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        "document.querySelectorAll('.sidebar .file-select').length",
      ),
      1,
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('.sidebar .group-heading').click(); [...document.querySelectorAll('.view-tabs button')].find(b=>b.textContent.includes('提交历史')).click()",
    );
    await waitForChangesUI("document.querySelector('.history-panel')");
    await window.webContents.executeJavaScript(
      "document.querySelector('.sidebar .file-select').click()",
    );
    await waitForChangesUI(
      "document.querySelector('.diff-lines')?.textContent.includes('worktree version') && document.querySelector('.scope-chip')?.textContent.includes('未暂存')",
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        "document.querySelector('.view-tabs .active').textContent.startsWith('当前改动')",
      ),
      true,
    );
    if (process.env.CODEGUARD_SMOKE_SIDEBAR_DIR) {
      for (const [width, height] of [
        [1080, 700],
        [1440, 950],
      ]) {
        window.setSize(width, height);
        window.showInactive();
        window.webContents.setBackgroundThrottling(false);
        await new Promise((resolve) => setTimeout(resolve, 150));
        window.webContents.invalidate();
        fs.writeFileSync(
          path.join(process.env.CODEGUARD_SMOKE_SIDEBAR_DIR, `sidebar-diff-${width}.png`),
          (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG(),
        );
        window.hide();
      }
    }
    await window.webContents.executeJavaScript("document.querySelector('.back-button').click()");
    console.log(
      'Changed files sidebar passed: grouped versions, collapse, selected diff, history-to-changes navigation, no duplicate list.',
    );
    if (process.platform === 'win32') {
      const probe = async (width) => {
        const points = await window.webContents.executeJavaScript(`(() => {
          const drag = document.querySelector('.titlebar-drag-region').getBoundingClientRect();
          const picker = document.querySelector('.repository-trigger').getBoundingClientRect();
          const button = document.querySelector('.toolbar button').getBoundingClientRect();
          return [0.1, 0.5, 0.9].map((part, index) => ({ name: 'blank-' + index, x: drag.x + drag.width * part, y: 28 })).concat([
            { name: 'picker', x: picker.x + picker.width / 2, y: picker.y + picker.height / 2 },
            { name: 'button', x: button.x + button.width / 2, y: button.y + button.height / 2 }]);
        })()`);
        const bounds = window.getContentBounds();
        const pointsFile = path.join(owned, 'titlebar-points.json');
        fs.writeFileSync(
          pointsFile,
          JSON.stringify(
            points.map((point) => ({
              name: point.name,
              ...screen.dipToScreenPoint({
                x: Math.round(bounds.x + point.x),
                y: Math.round(bounds.y + point.y),
              }),
            })),
          ),
        );
        const output = await new Promise((resolve, reject) => {
          const child = spawn(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              fs.readFileSync(path.join(__dirname, 'windows-titlebar-probe.ps1'), 'utf8'),
            ],
            {
              env: {
                ...process.env,
                CODEGUARD_PROBE_POINTS: pointsFile,
                CODEGUARD_PROBE_HANDLE: window.getNativeWindowHandle().readBigUInt64LE().toString(),
              },
              windowsHide: true,
            },
          );
          let stdout = '',
            stderr = '';
          child.stdout.on('data', (value) => {
            stdout += value;
          });
          child.stderr.on('data', (value) => {
            stderr += value;
          });
          child.on('error', reject);
          child.on('exit', (code) => (code ? reject(new Error(stderr)) : resolve(stdout)));
        });
        const hits = JSON.parse(output);
        console.log(`Native titlebar hit test (${width}): ${JSON.stringify(hits)}`);
        for (const item of hits.filter((item) => item.name.startsWith('blank-')))
          assert.equal(item.hit, 2, 'Blank titlebar must be HTCAPTION');
        assert.equal(
          hits.find((item) => item.name === 'picker').hit,
          1,
          'Repository picker must be HTCLIENT',
        );
        assert.equal(
          hits.find((item) => item.name === 'button').hit,
          1,
          'Toolbar button must be HTCLIENT',
        );
      };
      for (const width of [1080, 1440]) {
        window.setSize(width, 950);
        await new Promise((resolve) => setTimeout(resolve, 100));
        const layout = await window.webContents.executeJavaScript(`(() => {
          const bar = document.querySelector('.topbar');
          const toolbar = document.querySelector('.toolbar');
          const area = navigator.windowControlsOverlay?.getTitlebarAreaRect();
          return { top: bar.getBoundingClientRect().top, height: bar.getBoundingClientRect().height,
            drag: getComputedStyle(bar).getPropertyValue('-webkit-app-region'),
            buttonDrag: getComputedStyle(toolbar.querySelector('button')).getPropertyValue('-webkit-app-region'),
            right: toolbar.getBoundingClientRect().right,
            safeRight: area?.width ? area.x + area.width : innerWidth - 138 };
        })()`);
        assert.equal(layout.top, 0);
        assert.equal(layout.height, 56);
        assert.equal(layout.drag, 'drag');
        assert.equal(layout.buttonDrag, 'no-drag');
        assert.ok(layout.right <= layout.safeRight, JSON.stringify(layout));
        await probe(width);
      }
      const waitForUI = async (condition) =>
        window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const timer = setInterval(() => { if (${condition}) { clearInterval(timer); clearTimeout(deadline); resolve(true); } }, 25);
        const deadline = setTimeout(() => { clearInterval(timer); reject(new Error('Menu interaction did not settle')); }, 5000);
      })`);
      const menuKey = async (key) =>
        window.webContents.executeJavaScript(
          `document.querySelector('.repository-trigger').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`,
        );
      const openMenu = async () => {
        await waitForUI("!document.querySelector('.repository-trigger').disabled");
        await window.webContents.executeJavaScript(
          "document.querySelector('.repository-trigger').focus(); document.querySelector('.repository-trigger').click()",
        );
        await waitForUI("document.querySelectorAll('[role=option]').length === 2");
      };
      await openMenu();
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.querySelector('[role=option][aria-selected=true] strong').textContent",
        ),
        repository.name,
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          "!!document.querySelector('select[aria-label=当前仓库]')",
        ),
        false,
      );
      await menuKey('Escape');
      await waitForUI("!document.querySelector('.repository-menu')");
      await openMenu();
      await menuKey('ArrowDown');
      await waitForUI(
        "document.querySelector('[role=option].highlighted strong').textContent === 'second-repository'",
      );
      await menuKey('Enter');
      await waitForUI(
        "document.querySelector('.repository-trigger span').textContent === 'second-repository'",
      );
      assert.equal(service.getWorkspace().activeRepositoryId, secondRepository.id);
      await openMenu();
      await window.webContents.executeJavaScript(
        "document.querySelectorAll('[role=option]')[0].click()",
      );
      await waitForUI(
        `document.querySelector('.repository-trigger span').textContent === ${JSON.stringify(repository.name)}`,
      );
      assert.equal(service.getWorkspace().activeRepositoryId, repository.id);
      await openMenu();
      await window.webContents.executeJavaScript(
        "document.querySelector('.view-tabs').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))",
      );
      await waitForUI("!document.querySelector('.repository-menu')");
      if (process.env.CODEGUARD_SMOKE_CAPTURE) {
        window.showInactive();
        await new Promise((resolve) => setTimeout(resolve, 100));
        await openMenu();
        window.webContents.setBackgroundThrottling(false);
        window.webContents.invalidate();
        await new Promise((resolve) => setTimeout(resolve, 150));
        const capture = await window.webContents.capturePage(undefined, { stayHidden: true });
        fs.writeFileSync(process.env.CODEGUARD_SMOKE_CAPTURE, capture.toPNG());
        window.hide();
      }
      await menuKey('Escape');
    }
    const mock = await startMockModel({
      commitMessageDelayMs: 200,
      reviewChunkDelayMs: 25,
      investigate: true,
    });
    try {
      await window.webContents.executeJavaScript(
        "[...document.querySelectorAll('.toolbar button')].find(item => item.textContent.includes('模型设置')).click()",
      );
      const waitForSettings = (condition) =>
        window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const timer = setInterval(() => { if (${condition}) { clearInterval(timer); clearTimeout(deadline); resolve(true); } }, 25);
        const deadline = setTimeout(() => { clearInterval(timer); reject(new Error('Settings UI did not settle')); }, 5000);
      })`);
      await waitForSettings("document.querySelector('.settings-form [role=combobox]')");
      const settingsCombo = (label) =>
        `([...document.querySelectorAll('.settings-form [role=combobox]')].find(item => document.getElementById(item.getAttribute('aria-labelledby')).textContent === ${JSON.stringify(label)}))`;
      const selectSetting = async (label, option) => {
        await window.webContents.executeJavaScript(`${settingsCombo(label)}.click()`);
        await waitForSettings("document.querySelector('.settings-options')");
        await window.webContents.executeJavaScript(
          `([...document.querySelectorAll('.settings-options [role=option]')].find(item => item.textContent === ${JSON.stringify(option)})).click()`,
        );
        await waitForSettings("!document.querySelector('.settings-options')");
      };
      const fillSetting = async (selector, value) => {
        await window.webContents.executeJavaScript(`(() => {
          const input = document.querySelector('.settings-form ' + ${JSON.stringify(selector)});
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
      };
      assert.equal(
        await window.webContents.executeJavaScript(
          "!!document.querySelector('.settings-form input[type=url], .settings-form input:not([type])')",
        ),
        false,
      );
      await selectSetting('模型', 'DeepSeek V4 Pro');
      await window.webContents.executeJavaScript(`${settingsCombo('模型')}.click()`);
      await window.webContents.executeJavaScript(
        "document.querySelector('.dialog-subtitle').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))",
      );
      await waitForSettings("!document.querySelector('.settings-options')");
      assert.equal(
        (await call('modelSettings')).baseUrl,
        '',
        'Choosing a preset must not save settings',
      );
      await selectSetting('模型', '自定义模型');
      await waitForSettings("document.querySelector('.settings-form input:not([type])')");
      await fillSetting('input:not([type])', 'private-deepseek');
      await selectSetting('模型', 'DeepSeek Flash');
      await selectSetting('模型', '自定义模型');
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.querySelector('.settings-form input:not([type])').value",
        ),
        'private-deepseek',
      );
      await window.webContents.executeJavaScript(`${settingsCombo('模型服务')}.click()`);
      await window.webContents.executeJavaScript(
        `${settingsCombo('模型服务')}.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}))`,
      );
      await waitForSettings(
        "!document.querySelector('.settings-options') && document.querySelector('.settings-form')",
      );
      await window.webContents.executeJavaScript(
        `${settingsCombo('模型服务')}.dispatchEvent(new KeyboardEvent('keydown', {key:'End', bubbles:true, cancelable:true}))`,
      );
      await window.webContents.executeJavaScript(
        `${settingsCombo('模型服务')}.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}))`,
      );
      await waitForSettings("document.querySelector('.settings-form input[type=url]')");
      for (const [selector, value] of [
        ['input[type=url]', mock.baseUrl],
        ['input:not([type])', 'desktop-fixture'],
        ['input[type=password]', 'desktop-fixture-key'],
      ]) {
        await fillSetting(selector, value);
      }
      await selectSetting('模型服务', 'DeepSeek 官方');
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.querySelector('.settings-form input:not([type])').value",
        ),
        'private-deepseek',
      );
      await selectSetting('模型服务', '自定义服务');
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.querySelector('.settings-form input[type=url]').value",
        ),
        mock.baseUrl,
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.querySelector('.settings-form input:not([type])').value",
        ),
        'desktop-fixture',
      );
      assert.equal(mock.requests.length, 0, 'Changing choices must not call the model');
      await window.webContents.executeJavaScript(
        "[...document.querySelectorAll('.settings-form button')].find(item => item.textContent.includes('保存并测试')).click()",
      );
      await waitForSettings(
        "document.querySelector('.settings-form .review-success')?.textContent.includes('连接成功')",
      );
      const configured = await call('modelSettings');
      assert.equal(configured.hasApiKey, true);
      assert.equal(configured.baseUrl, mock.baseUrl);
      assert.equal(configured.model, 'desktop-fixture');
      const reloaded = new ModelSettings(path.join(owned, 'workspace'), { safeStorage });
      assert.equal(reloaded.getPublic().revision, configured.revision);
      assert.equal(reloaded.connection().apiKey, 'desktop-fixture-key');
      await window.webContents.executeJavaScript(
        "document.querySelector('[aria-label=关闭模型服务]').click()",
      );
      const reopenSettings = async () => {
        await window.webContents.executeJavaScript(
          "[...document.querySelectorAll('.toolbar button')].find(item => item.textContent.includes('模型设置')).click()",
        );
        await waitForSettings("document.querySelector('.settings-form [role=combobox]')");
      };
      await reopenSettings();
      assert.equal(
        await window.webContents.executeJavaScript(`${settingsCombo('模型服务')}.textContent`),
        '自定义服务',
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.querySelector('.settings-form input[type=url]').value",
        ),
        mock.baseUrl,
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.querySelector('.settings-form input:not([type])').value",
        ),
        'desktop-fixture',
      );
      await selectSetting('模型服务', 'DeepSeek 官方');
      await selectSetting('模型', 'DeepSeek V4 Pro');
      await window.webContents.executeJavaScript(
        "document.querySelector('.settings-form button.primary').click()",
      );
      await waitForSettings(
        "document.querySelector('.settings-form .review-success')?.textContent.includes('已保存')",
      );
      const preset = await call('modelSettings');
      assert.equal(preset.baseUrl, 'https://api.deepseek.com');
      assert.equal(preset.model, 'deepseek-v4-pro');
      assert.equal(
        new ModelSettings(path.join(owned, 'workspace'), { safeStorage }).connection().apiKey,
        'desktop-fixture-key',
      );
      assert.equal(mock.requests.length, 1, 'Saving a preset must not send a connection test');
      await window.webContents.executeJavaScript(
        "document.querySelector('[aria-label=关闭模型服务]').click()",
      );
      await reopenSettings();
      assert.equal(
        await window.webContents.executeJavaScript(`${settingsCombo('模型服务')}.textContent`),
        'DeepSeek 官方',
      );
      assert.equal(
        await window.webContents.executeJavaScript(`${settingsCombo('模型')}.textContent`),
        'DeepSeek V4 Pro',
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          "!!document.querySelector('.settings-form input[type=url], .settings-form input:not([type])')",
        ),
        false,
      );
      if (process.env.CODEGUARD_SMOKE_SETTINGS_CAPTURE) {
        window.showInactive();
        window.webContents.setBackgroundThrottling(false);
        await window.webContents.executeJavaScript(`${settingsCombo('模型')}.click()`);
        window.webContents.invalidate();
        await new Promise((resolve) => setTimeout(resolve, 150));
        fs.writeFileSync(
          process.env.CODEGUARD_SMOKE_SETTINGS_CAPTURE,
          (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG(),
        );
        window.hide();
      }
      await window.webContents.executeJavaScript(
        "document.querySelector('[aria-label=关闭模型服务]').click()",
      );
      await call('saveModelSettings', configured);
      console.log(
        'Settings UI save/test persisted, independent disk reload and system key decrypt passed.',
      );
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
      const waitVisualUI = (condition) =>
        window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
        const timer=setInterval(()=>{if(${condition}){clearInterval(timer);clearTimeout(deadline);resolve(true);}},25);
        const deadline=setTimeout(()=>{clearInterval(timer);reject(new Error('Visual review did not settle: '+${JSON.stringify(condition)}+' | '+document.querySelector('.review-error')?.textContent));},8000);
      })`);
      const visualTab = async (name) =>
        window.webContents.executeJavaScript(
          `([...document.querySelectorAll('.visual-review-tabs button')].find(b=>b.textContent.startsWith(${JSON.stringify(name)}))).click()`,
        );
      const captureVisual = async (name) => {
        if (!process.env.CODEGUARD_SMOKE_VISUALS_DIR) return;
        window.webContents.setBackgroundThrottling(false);
        window.webContents.invalidate();
        await new Promise((resolve) => setTimeout(resolve, 150));
        fs.writeFileSync(
          path.join(process.env.CODEGUARD_SMOKE_VISUALS_DIR, name + '.png'),
          (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG(),
        );
      };
      assert.equal(reviewed.visuals.changes.length, 1);
      assert.equal(reviewed.visuals.flows.length, 1);
      assert.equal(reviewed.investigation.items.length, 1);
      await window.webContents.executeJavaScript(`(() => {
        window.__reviewPopupSeen = false;
        window.__reviewPopupObserver = new MutationObserver(() => {
          if(document.querySelector('[role=dialog]')) window.__reviewPopupSeen = true;
        });
        window.__reviewPopupObserver.observe(document.body, {childList:true,subtree:true});
      })()`);
      assert.equal(
        await window.webContents.executeJavaScript(
          "!!document.querySelector('.review-scope-switch')",
        ),
        false,
      );
      const originalLocalCapture = service.captureLocalReview.bind(service);
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.querySelectorAll('.review-actions .secondary').length",
        ),
        1,
      );
      await waitVisualUI(
        "document.querySelector('.analysis-button')?.textContent.includes('评审本次提交') && !document.querySelector('.analysis-button').disabled",
      );
      const originalStagedBlob = (await runGit(root, ['rev-parse', ':source.ts'])).stdout.trim();
      // Change the real index while the renderer still has the previous state.
      // Routing must use the new state read after the click, rather than the old label.
      await service.changeStaging(repository.id, 'source.ts', 'unstage');
      let releaseLocalCapture;
      let enteredLocalCapture;
      const localCaptureEntered = new Promise((resolve) => {
        enteredLocalCapture = resolve;
      });
      const localCaptureGate = new Promise((resolve) => {
        releaseLocalCapture = resolve;
      });
      service.captureLocalReview = async (...args) => {
        enteredLocalCapture();
        await localCaptureGate;
        return originalLocalCapture(...args);
      };
      const requestsBeforePreparation = mock.requests.length;
      await window.webContents.executeJavaScript(
        "document.querySelector('.analysis-button').click()",
      );
      await waitVisualUI("document.querySelector('.review-workspace .review-preparation')");
      await Promise.race([
        localCaptureEntered,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Automatic local route did not reach snapshot preparation')),
            5000,
          ),
        ),
      ]);
      assert.equal(mock.requests.length, requestsBeforePreparation);
      await window.webContents.executeJavaScript(
        "document.querySelector('.review-actions .text-button').click()",
      );
      releaseLocalCapture();
      await waitVisualUI(
        "!document.querySelector('.analysis-button').disabled && document.querySelector('.review-workspace .review-error')?.textContent.includes('已取消准备')",
      );
      assert.equal(mock.requests.length, requestsBeforePreparation);
      service.captureLocalReview = async () => {
        throw new Error('fixture-preparation-failed');
      };
      await window.webContents.executeJavaScript(
        "document.querySelector('.analysis-button').click()",
      );
      await waitVisualUI(
        "!document.querySelector('.analysis-button').disabled && document.querySelector('.review-workspace .review-error')?.textContent.includes('fixture-preparation-failed')",
      );
      assert.equal(mock.requests.length, requestsBeforePreparation);
      service.captureLocalReview = originalLocalCapture;
      const indexBeforeUnderstanding = fs.readFileSync(path.join(root, '.git', 'index'));
      await window.webContents.executeJavaScript(
        "document.querySelector('.analysis-button').click();document.querySelector('.analysis-button').click()",
      );
      await waitVisualUI(
        "document.querySelector('.review-process.running .review-stream-summary')",
      );
      assert.equal((await call('reviewProgress', repository.id, 'local')).status, 'running');
      await waitVisualUI(
        "document.querySelector('.visual-change-card')?.textContent.includes('固定工作区快照') && !document.querySelector('.review-actions .spin')",
      );
      assert.equal(mock.requests.length, requestsBeforePreparation + 2);
      assert.match(JSON.stringify(mock.requests.at(-1)), /worktree version/);
      assert.deepEqual(fs.readFileSync(path.join(root, '.git', 'index')), indexBeforeUnderstanding);
      await window.webContents.executeJavaScript(
        "document.querySelector('.toolbar [aria-label=刷新]').click()",
      );
      await waitVisualUI(
        "document.querySelector('.analysis-button')?.textContent.includes('理解全部本地改动') && !document.querySelector('.analysis-button').disabled",
      );
      await runGit(root, [
        'update-index',
        '--add',
        '--cacheinfo',
        '100644',
        originalStagedBlob,
        'source.ts',
      ]);
      await window.webContents.executeJavaScript(
        "document.querySelector('.toolbar [aria-label=刷新]').click()",
      );
      await waitVisualUI(
        "document.querySelector('.analysis-button')?.textContent.includes('评审本次提交') && !document.querySelector('.analysis-button').disabled",
      );
      const beforeStagedReview = mock.requests.length;
      await window.webContents.executeJavaScript(
        "document.querySelector('.analysis-button').click();document.querySelector('.analysis-button').click()",
      );
      await waitVisualUI(
        "document.querySelector('.review-process.running .review-stream-summary') && document.querySelector('.review-process.running .review-stream-finding')",
      );
      assert.match(
        await window.webContents.executeJavaScript(
          "document.querySelector('.review-process').textContent",
        ),
        /正在接收模型输出/,
      );
      assert.equal((await call('reviewProgress', repository.id, 'staged')).status, 'running');
      await captureVisual('review-streaming');
      await waitVisualUI(
        "document.querySelector('.visual-change-card') && !document.querySelector('.review-actions .spin')",
      );
      assert.equal((await call('reviewProgress', repository.id, 'staged')).status, 'completed');
      assert.equal(mock.requests.length, beforeStagedReview + 2);
      const displayed = await window.webContents.executeJavaScript(
        "document.querySelector('.review-workspace').dataset.reviewId",
      );
      assert.equal(
        displayed,
        (await call('reviewState', repository.id, 'staged')).latest.id,
        'Completed UI must show this run, not the previous result awaiting reload',
      );
      assert.match(JSON.stringify(mock.requests.at(-1)), /staged version/);
      assert.doesNotMatch(JSON.stringify(mock.requests.at(-1)), /worktree version/);
      assert.equal(await window.webContents.executeJavaScript('window.__reviewPopupSeen'), false);
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.querySelectorAll('.review-actions .secondary').length",
        ),
        1,
      );
      await window.webContents.executeJavaScript('window.__reviewPopupObserver.disconnect()');
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.querySelector('.review-process-toggle').getAttribute('aria-expanded')",
        ),
        'false',
      );
      assert.match(
        await window.webContents.executeJavaScript(
          "document.querySelector('.visual-change-card').textContent",
        ),
        /未暂存编辑保持独立/,
      );
      await captureVisual('review-behavior');
      await waitVisualUI(
        "document.querySelector('.investigation-card') && document.querySelector('.explanation-steps')",
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.querySelectorAll('.visual-change-list .visual-flow-card').length",
        ),
        0,
        'Behavior overview must not duplicate the impact flow',
      );
      await window.webContents.executeJavaScript(
        "document.querySelector('.investigation-proof summary').click()",
      );
      await window.webContents.executeJavaScript(
        "document.querySelector('.search-match summary').click()",
      );
      assert.match(
        await window.webContents.executeJavaScript(
          "document.querySelector('.search-match pre').textContent",
        ),
        /staged version/,
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.querySelectorAll('.visual-file-tree').length",
        ),
        0,
      );
      for (const width of [1080, 1440]) {
        window.setSize(width, 950);
        assert.equal(
          await window.webContents.executeJavaScript(
            "document.querySelector('.visual-review-content').getBoundingClientRect().width > 400",
          ),
          true,
        );
      }
      // The overview also contains flow nodes. Wait for the target panel itself,
      // rather than a node count or the parent tab highlight shared by both views.
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt) {
          await visualTab('改动图解');
          await waitVisualUI(
            "document.querySelector('.explanation-steps') && !document.querySelector('.flow-disclaimer')",
          );
        }
        await visualTab('影响流程');
        await waitVisualUI(
          "document.querySelector('.flow-disclaimer') && !document.querySelector('.explanation-steps') && document.querySelectorAll('.flow-node').length === 3",
        );
        await window.webContents.executeJavaScript(
          "document.querySelectorAll('.flow-node')[1].click()",
        );
        await waitVisualUI(
          "document.querySelectorAll('.flow-node')[1]?.getAttribute('aria-pressed') === 'true' && document.querySelector('.flow-node-detail pre')?.textContent.includes('staged version')",
        );
      }
      await window.webContents.executeJavaScript(
        "document.querySelector('[aria-label=放大流程图]').click()",
      );
      assert.match(
        await window.webContents.executeJavaScript(
          "document.querySelector('[aria-label=重置流程图缩放]').textContent",
        ),
        /115/,
      );
      await window.webContents.executeJavaScript(
        "document.querySelector('[aria-label=重置流程图缩放]').click()",
      );
      await captureVisual('review-flow');
      assert.equal(
        await window.webContents.executeJavaScript(
          "parseFloat(getComputedStyle(document.querySelector('.flow-node span')).fontSize)>=14 && getComputedStyle(document.querySelector('.flow-node span')).webkitLineClamp==='none'",
        ),
        true,
        'Flow labels stay readable without line clamping',
      );
      await visualTab('问题与建议');
      await waitVisualUI("document.querySelector('.visual-risk')");
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.querySelectorAll('.finding-disposition,.finding-filter,.visual-risk textarea,.visual-risk select').length",
        ),
        0,
        'Suggestions do not expose manual disposition forms',
      );
      await window.webContents.executeJavaScript(
        `(() => {
          const select = document.querySelector('[aria-label="图解文件筛选"]');
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'source.ts');
          select.dispatchEvent(new Event('change',{bubbles:true}));
        })()`,
      );
      await waitVisualUI(
        "document.querySelector('.visual-filter')?.textContent.includes('source.ts')",
      );
      await captureVisual('review-risks');
      await window.webContents.executeJavaScript(
        "document.querySelector('.visual-risk .visual-code-link').click()",
      );
      await waitVisualUI(
        "document.querySelector('.finding-highlight')?.textContent.includes('staged version')",
      );
      await window.webContents.executeJavaScript("document.querySelector('.back-button').click()");
      await waitVisualUI(
        "document.querySelector('.visual-review-tabs .active')?.textContent.startsWith('问题与建议') && document.querySelector('.visual-filter')",
      );
      await window.webContents.executeJavaScript(`(() => {
        document.querySelector('.review-options').open=true;
        const input=document.querySelector('.review-options textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'修改评审依据');
        input.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await waitVisualUI(
        "document.querySelector('.visual-review-status')?.textContent.includes('旧版本')",
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          "[...document.querySelectorAll('.visual-code-link')].every(b=>b.disabled)",
        ),
        true,
      );
      await window.webContents.executeJavaScript(`(() => {
        const input=document.querySelector('.review-options textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'');
        input.dispatchEvent(new Event('input',{bubbles:true}));
        document.querySelector('.review-options').open=false;
      })()`);
      await waitVisualUI(
        "document.querySelector('.visual-review-status')?.textContent.includes('已完成')",
      );
      await window.webContents.executeJavaScript(
        "[...document.querySelectorAll('.view-tabs button')].find(b=>b.textContent.startsWith('当前改动')).click()",
      );
      console.log(
        'Visual review UI passed: behavior cards, flow nodes/zoom, file filters, risk cards, cited diff and return, stale-state navigation disabled.',
      );
      const waitForCommitUI = (condition) =>
        window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const timer = setInterval(() => { if (${condition}) { clearInterval(timer); clearTimeout(deadline); resolve(true); } }, 25);
        const deadline = setTimeout(() => { clearInterval(timer); reject(new Error('Commit message UI did not settle: ' + ${JSON.stringify(condition)} + ' | ' + document.querySelector('.commit-generation-feedback')?.textContent)); }, 5000);
      })`);
      const beforeGeneration = mock.requests.length;
      await waitForCommitUI(
        "document.querySelector('[aria-label=生成提交信息]') && !document.querySelector('[aria-label=生成提交信息]').disabled",
      );
      assert.match(
        await window.webContents.executeJavaScript(
          "document.querySelector('[aria-label=生成提交信息]').textContent",
        ),
        /生成提交信息/,
      );
      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('#commit-message');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '旧草稿');
        input.dispatchEvent(new Event('input', { bubbles:true }));
        window.__commitDialogSeen = false;
        window.__commitDialogObserver = new MutationObserver(() => {
          if(document.querySelector('[role=dialog][aria-label=生成提交信息]')) window.__commitDialogSeen = true;
        });
        window.__commitDialogObserver.observe(document.body, { childList:true, subtree:true });
      })()`);
      await window.webContents.executeJavaScript(
        "document.querySelector('[aria-label=生成提交信息]').click(); document.querySelector('[aria-label=生成提交信息]').click()",
      );
      await waitForCommitUI(
        "document.querySelector('#commit-message')?.value.includes('新增暂存版本内容')",
      );
      await waitForCommitUI("!document.querySelector('[aria-label=生成提交信息]').disabled");
      assert.equal(mock.requests.length, beforeGeneration + 1);
      assert.match(
        await window.webContents.executeJavaScript(
          "document.querySelector('#commit-message').value",
        ),
        /^feat: 新增暂存版本内容\n\n/,
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          "window.__commitDialogSeen || !!document.querySelector('[role=dialog][aria-label=生成提交信息]')",
        ),
        false,
      );
      assert.match(JSON.stringify(mock.requests.at(-1)), /staged version/);
      assert.doesNotMatch(JSON.stringify(mock.requests.at(-1)), /worktree version/);
      await waitForCommitUI(
        "document.querySelector('.commit-generation-feedback').textContent.includes('已根据暂存内容生成')",
      );
      // Common actions must fit the first screen, including when a review exists.
      for (const [width, height] of [
        [1080, 700],
        [1440, 950],
      ]) {
        window.setSize(width, height);
        await new Promise((resolve) => setTimeout(resolve, 120));
        const compact = await window.webContents.executeJavaScript(`(() => {
          const panel = document.querySelector('.detail-panel');
          const bounds = panel.getBoundingClientRect();
          const selectors = ['.generate-commit-button', '.commit-button', '.review-actions .secondary', '.review-open-workspace'];
          return {
            height: panel.clientHeight, content: panel.scrollHeight,
            changedFiles: (() => {
              const sidebar = document.querySelector('.sidebar');
              const list = document.querySelector('.sidebar-changes');
              return { width: sidebar.getBoundingClientRect().width, overflow: getComputedStyle(list).overflowY,
                horizontalOverflow: list.scrollWidth > list.clientWidth,
                inSidebar: [...document.querySelectorAll('.file-select')].every(file => sidebar.contains(file)) };
            })(),
            layout: [...panel.children, ...document.querySelector('.review-panel').children].map(item => ({
              name: item.className, height: item.getBoundingClientRect().height,
              top: getComputedStyle(item).marginTop, bottom: getComputedStyle(item).marginBottom,
            })),
            width: bounds.width,
            font: getComputedStyle(document.querySelector('#commit-message')).fontSize,
            actions: selectors.map(selector => {
              const button = document.querySelector(selector);
              const rect = button.getBoundingClientRect();
              return { selector, visible: rect.top >= bounds.top && rect.bottom <= bounds.bottom && rect.left >= bounds.left && rect.right <= bounds.right };
            }),
            clutter: !!document.querySelector('.target-box, .repository-status, .sidebar-review-summary, .phase-note'),
          };
        })()`);
        assert.ok(
          compact.content <= compact.height + 1,
          JSON.stringify({ width, height, compact }),
        );
        assert.ok(compact.width >= 330);
        assert.ok(compact.changedFiles.width >= 240);
        assert.equal(compact.changedFiles.overflow, 'auto');
        assert.equal(compact.changedFiles.horizontalOverflow, false);
        assert.equal(compact.changedFiles.inSidebar, true);
        assert.equal(compact.font, '14px');
        assert.equal(compact.clutter, false);
        assert.ok(
          compact.actions.every((action) => action.visible),
          JSON.stringify(compact),
        );
        await window.webContents.executeJavaScript(
          "document.querySelector('.review-options').open = true",
        );
        assert.equal(
          await window.webContents.executeJavaScript(`(() => {
          const panel = document.querySelector('.detail-panel').getBoundingClientRect();
          return ['.generate-commit-button', '.commit-button', '.review-actions .secondary'].every(selector => document.querySelector(selector).getBoundingClientRect().bottom <= panel.bottom);
        })()`),
          true,
        );
        await window.webContents.executeJavaScript(
          "document.querySelector('.review-options').open = false",
        );
        if (process.env.CODEGUARD_SMOKE_COMPACT_DIR) {
          window.showInactive();
          window.webContents.setBackgroundThrottling(false);
          window.webContents.invalidate();
          await new Promise((resolve) => setTimeout(resolve, 150));
          fs.writeFileSync(
            path.join(process.env.CODEGUARD_SMOKE_COMPACT_DIR, 'workbench-' + width + '.png'),
            (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG(),
          );
          window.hide();
        }
      }
      console.log(
        'Compact workbench passed: readable text, all primary actions and review results visible without sidebar scrolling at 1080×700 and 1440×950.',
      );
      const generatedDraft = await window.webContents.executeJavaScript(
        "document.querySelector('#commit-message').value",
      );
      // Wait for the actual draft persistence queue, then verify an independent disk load.
      for (let attempt = 0; attempt < 50; attempt++) {
        if (
          new GitService(path.join(owned, 'workspace')).getWorkspace().drafts[repository.id] ===
          generatedDraft
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(
        new GitService(path.join(owned, 'workspace')).getWorkspace().drafts[repository.id],
        generatedDraft,
      );
      if (process.env.CODEGUARD_SMOKE_COMMIT_CAPTURE) {
        window.showInactive();
        window.webContents.setBackgroundThrottling(false);
        window.webContents.invalidate();
        await new Promise((resolve) => setTimeout(resolve, 150));
        fs.writeFileSync(
          process.env.CODEGUARD_SMOKE_COMMIT_CAPTURE,
          (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG(),
        );
        window.hide();
      }
      console.log(
        'Commit message UI: one-click generation without a dialog, duplicate clicks send one request, conventional draft and persistence passed.',
      );
      await window.webContents.executeJavaScript(
        "document.querySelector('[aria-label=生成提交信息]').click()",
      );
      await waitForCommitUI(
        "document.querySelector('.draft-caption').textContent.includes('正在生成')",
      );
      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('#commit-message');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '生成期间的人工编辑');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await waitForCommitUI(
        "document.querySelector('.commit-generation-feedback').textContent.includes('已保留你的内容')",
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.querySelector('#commit-message').value",
        ),
        '生成期间的人工编辑',
      );
      await window.webContents.executeJavaScript(
        "document.querySelector('[aria-label=生成提交信息]').click()",
      );
      await waitForCommitUI(
        "document.querySelector('.draft-caption')?.textContent.includes('正在生成')",
      );
      await window.webContents.executeJavaScript(
        "document.querySelector('.draft-caption button').click()",
      );
      await waitForCommitUI(
        "document.querySelector('.commit-generation-feedback').textContent.includes('生成已取消')",
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.querySelector('#commit-message').value",
        ),
        '生成期间的人工编辑',
      );
      assert.equal(await window.webContents.executeJavaScript('window.__commitDialogSeen'), false);
      await window.webContents.executeJavaScript('window.__commitDialogObserver.disconnect()');
      console.log(
        'Commit message UI: concurrent manual edits and cancellation preserve the draft.',
      );
    } finally {
      await mock.close();
    }
    await call('saveDraft', repository.id, 'desktop IPC smoke');
    assert.equal(
      new GitService(path.join(owned, 'workspace')).getWorkspace().drafts[repository.id],
      'desktop IPC smoke',
    );
    const waitCommitUI = (condition) =>
      window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
      const timer=setInterval(()=>{if(${condition}){clearInterval(timer);clearTimeout(deadline);resolve(true);}},25);
      const deadline=setTimeout(()=>{clearInterval(timer);reject(new Error('Direct commit UI failed: '+${JSON.stringify(condition)}+' | '+document.querySelector('.notice')?.textContent));},7000);
    })`);
    await window.webContents.executeJavaScript(`(() => {
      window.__commitPopupSeen=false;
      window.__commitPopupObserver=new MutationObserver(()=>{if(document.querySelector('[role=dialog]'))window.__commitPopupSeen=true;});
      window.__commitPopupObserver.observe(document.body,{childList:true,subtree:true});
      const input=document.querySelector('#commit-message');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await waitCommitUI("document.querySelector('.commit-button').disabled");
    await window.webContents.executeJavaScript(`(() => {
      const input=document.querySelector('#commit-message');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'test: 验证直接提交');input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await waitCommitUI("!document.querySelector('.commit-button').disabled");
    assert.equal(
      await window.webContents.executeJavaScript(
        "document.querySelector('.commit-button').textContent.trim()",
      ),
      '提交',
    );
    const preCommitHook = path.join(root, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(preCommitHook, '#!/bin/sh\necho fixture-commit-hook-rejected >&2\nexit 1\n', {
      mode: 0o755,
    });
    await window.webContents.executeJavaScript(
      "document.querySelector('.commit-button').click();document.querySelector('.commit-button').click()",
    );
    await waitCommitUI(
      "!document.querySelector('.commit-button').disabled && document.querySelector('.notice.error')?.textContent.includes('fixture-commit-hook-rejected')",
    );
    assert.equal((await service.getState(repository.id)).head, null);
    assert.equal(
      await window.webContents.executeJavaScript("document.querySelector('#commit-message').value"),
      'test: 验证直接提交',
    );
    assert.equal(service.getWorkspace().drafts[repository.id], 'test: 验证直接提交');
    fs.unlinkSync(preCommitHook);
    const originalPrepareCommit = service.prepareCommit.bind(service);
    const originalBlob = (await runGit(root, ['rev-parse', ':source.ts'])).stdout.trim();
    let preparationCount = 0;
    service.prepareCommit = async (id) => {
      preparationCount++;
      const prepared = await originalPrepareCommit(id);
      const blob = (
        await runGit(root, ['hash-object', '-w', '--stdin'], { input: 'concurrent index edit\n' })
      ).stdout.trim();
      await runGit(root, ['update-index', '--cacheinfo', '100644', blob, 'source.ts']);
      return prepared;
    };
    await window.webContents.executeJavaScript("document.querySelector('.commit-button').click()");
    await waitCommitUI(
      "!document.querySelector('.commit-button').disabled && document.querySelector('.notice.error')?.textContent.includes('暂存内容或当前分支已变化')",
    );
    assert.equal(preparationCount, 1);
    assert.equal((await service.getState(repository.id)).head, null);
    assert.equal(service.getWorkspace().drafts[repository.id], 'test: 验证直接提交');
    service.prepareCommit = originalPrepareCommit;
    await runGit(root, ['update-index', '--cacheinfo', '100644', originalBlob, 'source.ts']);
    await window.webContents.executeJavaScript(
      "document.querySelector('.commit-button').click();document.querySelector('.commit-button').click()",
    );
    await waitCommitUI(
      "document.querySelector('.notice.success')?.textContent.includes('提交成功') && document.querySelector('#commit-message').value === ''",
    );
    const result = { hash: (await service.getState(repository.id)).head };
    assert.equal((await runGit(root, ['rev-list', '--count', 'HEAD'])).stdout.trim(), '1');
    assert.equal(await window.webContents.executeJavaScript('window.__commitPopupSeen'), false);
    await window.webContents.executeJavaScript('window.__commitPopupObserver.disconnect()');
    console.log(
      'Direct commit UI passed: no dialog, empty message disabled, hook failure and stale snapshot preserve drafts, double click commits exactly once.',
    );
    assert.equal((await call('reviewState', repository.id)).latest.stale, true);
    assert.equal((await call('history', repository.id))[0].hash, result.hash);
    assert.equal((await runGit(root, ['show', 'HEAD:source.ts'])).stdout, 'staged version\n');
    assert.equal(fs.readFileSync(path.join(root, 'source.ts'), 'utf8'), 'worktree version\n');
    const waitRemoteUI = (condition) =>
      window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
      const timer=setInterval(()=>{if(${condition}){clearInterval(timer);clearTimeout(deadline);resolve(true);}},25);
      const deadline=setTimeout(()=>{clearInterval(timer);reject(new Error('Remote UI did not settle: '+${JSON.stringify(condition)}+' | '+document.querySelector('.remote-manager')?.textContent));},7000);
    })`);
    const remoteButton = (label) =>
      window.webContents.executeJavaScript(
        `([...document.querySelectorAll('.remote-manager button')].find(b=>b.textContent.trim() === ${JSON.stringify(label)})).click()`,
      );
    const fillRemote = (name, value) =>
      window.webContents.executeJavaScript(`(() => {
      const input=document.querySelector('.remote-form input[name=' + ${JSON.stringify(name)} + ']');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    const saveRemote = async () => {
      await window.webContents.executeJavaScript(
        "document.querySelector('.remote-form').requestSubmit()",
      );
      await waitRemoteUI(
        "!document.querySelector('.remote-form') && document.querySelector('.remote-manager .review-success')",
      );
    };
    await window.webContents.executeJavaScript(
      "document.querySelector('.sync-toolbar button[title=获取远端状态]').click()",
    );
    await waitRemoteUI("document.querySelector('.operation-form .field-help .text-button')");
    await window.webContents.executeJavaScript(
      "document.querySelector('.operation-form .field-help .text-button').click()",
    );
    await waitRemoteUI("document.querySelector('.remote-empty')");
    assert.equal(
      await window.webContents.executeJavaScript(
        "[...document.querySelectorAll('.remote-manager button')].find(b=>b.textContent.includes('继续获取远端')).disabled",
      ),
      true,
    );
    await remoteButton('添加远程仓库');
    await waitRemoteUI("document.querySelector('.remote-form')");
    await fillRemote('remoteName', 'return-flow');
    await fillRemote('fetchUrl', 'https://example.invalid/return.git');
    await saveRemote();
    await remoteButton('继续获取远端');
    await waitRemoteUI("document.querySelector('.operation-form .settings-select button')");
    assert.match(
      await window.webContents.executeJavaScript(
        "document.querySelector('.operation-form').textContent",
      ),
      /return-flow/,
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('[aria-label=关闭获取远端]').click()",
    );
    const returningRemote = await call('remoteSettings', repository.id);
    await call('changeRemote', repository.id, {
      kind: 'remove',
      name: 'return-flow',
      revision: returningRemote.revision,
    });
    await window.webContents.executeJavaScript(
      "document.querySelector('.repository-trigger').click()",
    );
    await waitRemoteUI("document.querySelector('.repository-manage-remotes')");
    await window.webContents.executeJavaScript(
      "document.querySelector('.repository-trigger').dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}))",
    );
    assert.equal(
      await window.webContents.executeJavaScript('document.activeElement.className'),
      'repository-manage-remotes',
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('.repository-manage-remotes').click()",
    );
    await waitRemoteUI("document.querySelector('.remote-empty')");
    await remoteButton('添加远程仓库');
    await waitRemoteUI("document.querySelector('.remote-form')");
    await fillRemote('remoteName', 'ui-backup');
    await fillRemote('fetchUrl', 'https://example.invalid/team/ui.git');
    await window.webContents.executeJavaScript(
      "document.querySelector('.remote-push-option input').click()",
    );
    await waitRemoteUI("document.querySelector('.remote-form input[name=pushUrl]')");
    await fillRemote('pushUrl', 'git@example.invalid:team/ui.git');
    if (process.env.CODEGUARD_SMOKE_REMOTES_FORM_CAPTURE) {
      window.showInactive();
      window.webContents.setBackgroundThrottling(false);
      window.webContents.invalidate();
      await new Promise((resolve) => setTimeout(resolve, 150));
      fs.writeFileSync(
        process.env.CODEGUARD_SMOKE_REMOTES_FORM_CAPTURE,
        (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG(),
      );
      window.hide();
    }
    await saveRemote();
    let managed = await call('remoteSettings', repository.id);
    assert.equal(managed.remotes[0].name, 'ui-backup');
    assert.deepEqual(managed.remotes[0].pushUrls, ['git@example.invalid:team/ui.git']);
    assert.equal((await call('operationOptions', repository.id)).remotes[0].name, 'ui-backup');
    if (process.env.CODEGUARD_SMOKE_REMOTES_CAPTURE) {
      window.showInactive();
      window.webContents.setBackgroundThrottling(false);
      window.webContents.invalidate();
      await new Promise((resolve) => setTimeout(resolve, 150));
      fs.writeFileSync(
        process.env.CODEGUARD_SMOKE_REMOTES_CAPTURE,
        (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG(),
      );
      window.hide();
    }
    await remoteButton('添加远程仓库');
    await waitRemoteUI("document.querySelector('.remote-form')");
    await fillRemote('remoteName', 'ui-backup');
    await fillRemote('fetchUrl', 'https://example.invalid/duplicate.git');
    await window.webContents.executeJavaScript(
      "document.querySelector('.remote-form').requestSubmit()",
    );
    await waitRemoteUI(
      "document.querySelector('.remote-manager [role=alert]')?.textContent.includes('已存在')",
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        "document.querySelector('.remote-form input[name=fetchUrl]').value",
      ),
      'https://example.invalid/duplicate.git',
    );
    await remoteButton('取消');
    await window.webContents.executeJavaScript(
      'document.querySelector(\'[aria-label="编辑远端 ui-backup"]\').click()',
    );
    await waitRemoteUI("document.querySelector('.remote-form')");
    assert.equal(
      await window.webContents.executeJavaScript(
        "document.querySelector('.remote-form input[name=remoteName]').disabled",
      ),
      true,
    );
    await fillRemote('fetchUrl', 'https://example.invalid/team/updated.git');
    await window.webContents.executeJavaScript(
      "document.querySelector('.remote-push-option input').click()",
    );
    await saveRemote();
    managed = await call('remoteSettings', repository.id);
    assert.deepEqual(managed.remotes[0].fetchUrls, ['https://example.invalid/team/updated.git']);
    assert.deepEqual(managed.remotes[0].pushUrls, []);
    await window.webContents.executeJavaScript(
      'document.querySelector(\'[aria-label="删除远端 ui-backup"]\').click()',
    );
    await waitRemoteUI("document.querySelector('.remote-delete-confirm')");
    await remoteButton('取消');
    assert.equal((await call('remoteSettings', repository.id)).remotes.length, 1);
    await window.webContents.executeJavaScript(
      'document.querySelector(\'[aria-label="删除远端 ui-backup"]\').click()',
    );
    await waitRemoteUI("document.querySelector('.remote-delete-confirm')");
    await remoteButton('确认删除 ui-backup');
    await waitRemoteUI("document.querySelector('.remote-empty')");
    assert.deepEqual((await call('remoteSettings', repository.id)).remotes, []);
    assert.equal(fs.readFileSync(path.join(root, 'source.ts'), 'utf8'), 'worktree version\n');
    await window.webContents.executeJavaScript(
      "document.querySelector('[aria-label=关闭远程仓库管理]').click()",
    );
    console.log(
      'Remote management UI passed: empty sync entry, keyboard menu, add, duplicate error, edit fetch/push, delete cancel/confirm and actual Git configuration.',
    );
    // Exercise the actual new toolbar and branch-menu UI against a disposable bare remote.
    fs.writeFileSync(path.join(root, 'bulk-ui.txt'), 'bulk stage UI\n');
    await window.webContents.executeJavaScript(
      "document.querySelector('.toolbar [aria-label=刷新]').click()",
    );
    await window.webContents.executeJavaScript(
      "[...document.querySelectorAll('.view-tabs button')].find(b=>b.textContent.startsWith('当前改动')).click()",
    );
    await waitRemoteUI(
      "[...document.querySelectorAll('.file-select')].some(b=>b.title === 'bulk-ui.txt') && !document.querySelector('[aria-label=暂存全部]').disabled",
    );
    // Read a changed file and stage it without returning to the overview.
    await window.webContents.executeJavaScript(
      "[...document.querySelectorAll('.file-select')].find(b=>b.title === 'bulk-ui.txt').click()",
    );
    await waitRemoteUI(
      "document.querySelector('.diff-staging-actions') && !document.querySelector('.diff-staging-actions .secondary').disabled",
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('.diff-staging-actions .secondary').click()",
    );
    await waitRemoteUI(
      "document.querySelector('.scope-chip')?.textContent.includes('已暂存') && !document.querySelector('.diff-staging-actions .secondary').disabled",
    );
    assert.equal((await runGit(root, ['show', ':bulk-ui.txt'])).stdout, 'bulk stage UI\n');
    await window.webContents.executeJavaScript(
      "document.querySelector('.diff-staging-actions .secondary').click()",
    );
    await waitRemoteUI(
      "document.querySelector('.scope-chip')?.textContent.includes('未暂存') && !document.querySelector('[aria-label=暂存全部]').disabled",
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('[aria-label=暂存全部]').click()",
    );
    await waitRemoteUI(
      "document.querySelector('.commit-selection-summary b')?.textContent === '2' && document.querySelector('.notice.success')?.textContent.includes('已暂存全部')",
    );
    const bulkState = await service.getState(repository.id);
    assert.equal(bulkState.files.length, 2);
    assert.ok(bulkState.files.every((file) => file.worktreeStatus === '.' && !file.untracked));
    assert.equal(
      await window.webContents.executeJavaScript(
        "document.querySelector('[aria-label=暂存全部]').disabled",
      ),
      true,
    );
    assert.equal((await runGit(root, ['show', ':bulk-ui.txt'])).stdout, 'bulk stage UI\n');
    assert.match(
      await window.webContents.executeJavaScript(
        "document.querySelector('.scope-chip').textContent",
      ),
      /已暂存/,
    );
    console.log(
      'Stage all UI passed: modified and untracked files staged together, counts refreshed and empty action disabled.',
    );
    const cleanPreview = await service.prepareCommit(repository.id);
    await service.commit(repository.id, cleanPreview.token, 'prepare sync fixture');
    await runGit(root, ['switch', '-c', 'feature/menu']);
    fs.writeFileSync(path.join(root, 'feature.txt'), 'feature\n');
    await runGit(root, ['add', '--', 'feature.txt']);
    await runGit(root, ['commit', '-m', 'feature for menu']);
    const featureHead = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['switch', 'main']);
    const remote = path.join(owned, 'sync-remote.git');
    await runGit(owned, ['init', '--bare', '--initial-branch=main', remote]);
    await runGit(root, ['remote', 'add', 'origin', remote]);
    await runGit(root, ['push', '-u', 'origin', 'main']);
    const peer = path.join(owned, 'sync-peer');
    await runGit(owned, ['clone', remote, peer]);
    for (const [key, value] of [
      ['user.name', 'Desktop Peer'],
      ['user.email', 'peer@example.invalid'],
      ['commit.gpgsign', 'false'],
      ['core.autocrlf', 'false'],
      ['core.hooksPath', path.join(peer, '.git', 'hooks')],
    ])
      await runGit(peer, ['config', key, value]);
    fs.writeFileSync(path.join(peer, 'remote.txt'), 'remote update\n');
    await runGit(peer, ['add', '--', 'remote.txt']);
    await runGit(peer, ['commit', '-m', 'remote update']);
    await runGit(peer, ['push']);
    const remoteHead = (await runGit(peer, ['rev-parse', 'HEAD'])).stdout.trim();
    const waitOperationUI = (condition) =>
      window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
      const timer=setInterval(()=>{if(${condition}){clearInterval(timer);clearTimeout(deadline);resolve(true);}},25);
      const deadline=setTimeout(()=>{clearInterval(timer);reject(new Error('Operation UI did not settle: '+${JSON.stringify(condition)}+' | '+document.querySelector('.operation-form')?.textContent));},10000);
    })`);
    const clickOperationButton = async (text) =>
      window.webContents.executeJavaScript(
        `([...document.querySelectorAll('.operation-form button')].find(b=>b.textContent === ${JSON.stringify(text)})).click()`,
      );
    const refreshUI = async () => {
      const revision = (await service.getState(repository.id)).head;
      await window.webContents.executeJavaScript(
        "document.querySelector('.toolbar [aria-label=刷新]').click()",
      );
      await waitOperationUI(
        `document.querySelector('.current-branch span')?.textContent === 'main' && !document.querySelector('.toolbar [aria-label=刷新]').disabled`,
      );
      return revision;
    };
    await refreshUI();
    const toolbarOperation = async (title) => {
      await window.webContents.executeJavaScript(
        `([...document.querySelectorAll('.sync-toolbar button')].find(b=>b.title === ${JSON.stringify(title)})).click()`,
      );
      await waitOperationUI("document.querySelector('.operation-form')");
    };
    const previewAndExecute = async (label, prepareLabel = '预览操作') => {
      await clickOperationButton(prepareLabel);
      await waitOperationUI(
        "document.querySelector('.operation-preview') && !document.querySelector('.operation-form .primary').disabled",
      );
      await clickOperationButton('确认' + label);
      await waitOperationUI(
        "!document.querySelector('.operation-form') && !document.querySelector('.toolbar [aria-label=刷新]').disabled",
      );
    };
    await toolbarOperation('获取远端状态');
    await previewAndExecute('获取远端');
    assert.equal((await service.getState(repository.id)).behind, 1);
    await toolbarOperation('拉取（仅快进）');
    await previewAndExecute('拉取', '获取并预览');
    assert.equal((await service.getState(repository.id)).head, remoteHead);
    fs.writeFileSync(path.join(root, 'publish.txt'), 'publish from UI\n');
    await runGit(root, ['add', '--', 'publish.txt']);
    await runGit(root, ['commit', '-m', 'publish from UI']);
    const published = (await service.getState(repository.id)).head;
    await refreshUI();
    await toolbarOperation('预览并推送');
    await previewAndExecute('推送');
    assert.equal((await runGit(remote, ['rev-parse', 'refs/heads/main'])).stdout.trim(), published);
    await window.webContents.executeJavaScript("document.querySelector('.current-branch').click()");
    await waitOperationUI("document.querySelector('.branch-menu')");
    await window.webContents.executeJavaScript(
      "[...document.querySelectorAll('.branch-menu .branch-name')].find(button => button.getAttribute('aria-label') === '浏览 feature/menu 历史').click()",
    );
    await waitOperationUI(
      "document.querySelector('.history-scope')?.textContent.includes('feature/menu')",
    );
    assert.equal((await service.getState(repository.id)).branch, 'main');
    assert.equal(
      await window.webContents.executeJavaScript(
        "!!document.querySelector('.sidebar .branch-item')",
      ),
      false,
    );
    const branchAction = async (name, action) => {
      await window.webContents.executeJavaScript(
        "document.querySelector('.current-branch').click()",
      );
      await waitOperationUI("document.querySelector('.branch-menu')");
      await window.webContents.executeJavaScript(
        `(() => {const row=[...document.querySelectorAll('.branch-menu-row')].find(item=>item.querySelector('.branch-name').textContent.trim() === ${JSON.stringify(name)});[...row.querySelectorAll('.branch-menu-actions button')].find(b=>b.textContent === ${JSON.stringify(action)}).click();})()`,
      );
      await waitOperationUI("document.querySelector('.operation-form')");
    };
    await branchAction('feature/menu', '切换');
    await previewAndExecute('切换分支');
    assert.equal((await service.getState(repository.id)).branch, 'feature/menu');
    await branchAction('main', '切换');
    await previewAndExecute('切换分支');
    await branchAction('feature/menu', '合并…');
    await clickOperationButton('预览操作');
    await waitOperationUI(
      "document.querySelector('.operation-preview') && !document.querySelector('.operation-form .primary').disabled",
    );
    if (process.env.CODEGUARD_SMOKE_MERGE_CAPTURE) {
      window.showInactive();
      window.webContents.setBackgroundThrottling(false);
      window.webContents.invalidate();
      await new Promise((resolve) => setTimeout(resolve, 150));
      fs.writeFileSync(
        process.env.CODEGUARD_SMOKE_MERGE_CAPTURE,
        (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG(),
      );
      window.hide();
    }
    await clickOperationButton('确认合并到当前分支');
    await waitOperationUI(
      "!document.querySelector('.operation-form') && !document.querySelector('.toolbar [aria-label=刷新]').disabled",
    );
    const parents = (await runGit(root, ['rev-list', '--parents', '-1', 'HEAD'])).stdout
      .trim()
      .split(' ');
    assert.deepEqual(parents.slice(1), [published, featureHead]);
    await window.webContents.executeJavaScript(
      "[...document.querySelectorAll('.view-tabs button')].find(button=>button.textContent.startsWith('当前改动')).click()",
    );
    await waitOperationUI(
      "document.querySelector('.analysis-button')?.disabled && document.querySelector('.analysis-button').textContent.includes('理解全部本地改动')",
    );
    assert.equal((await service.getState(repository.id)).files.length, 0);
    if (process.env.CODEGUARD_SMOKE_SYNC_CAPTURE) {
      window.showInactive();
      window.webContents.setBackgroundThrottling(false);
      await window.webContents.executeJavaScript(
        "document.querySelector('.current-branch').click()",
      );
      window.webContents.invalidate();
      await new Promise((resolve) => setTimeout(resolve, 150));
      fs.writeFileSync(
        process.env.CODEGUARD_SMOKE_SYNC_CAPTURE,
        (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG(),
      );
      window.hide();
    }
    console.log(
      'Sync UI passed: toolbar fetch/pull/push, branch-menu switch/merge, explicit previews and actual bare-remote results.',
    );
    fs.mkdirSync(path.join(root, 'feature', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(root, 'feature', 'nested', 'tree.ts'), 'export const tree = 1;\n');
    await window.webContents.executeJavaScript(
      "document.querySelector('.toolbar [aria-label=刷新]').click()",
    );
    await waitForChangesUI(
      "document.querySelector('.file-tree-directory[open] .file-tree-directory[open] .file-select')",
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('.file-tree-directory > summary').click()",
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        "document.querySelector('.file-tree-directory').open",
      ),
      false,
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('.file-tree-directory > summary').click(); document.querySelector('.file-tree .file-select').click()",
    );
    await waitForChangesUI(
      "document.querySelector('.diff-title').textContent.includes('feature/nested/tree.ts')",
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('.file-tree .file-action').click()",
    );
    await waitForChangesUI(
      "document.querySelector('.diff-toolbar').textContent.includes('取消暂存')",
    );
    assert.equal(
      (await service.getState(repository.id)).files.find(
        (file) => file.path === 'feature/nested/tree.ts',
      ).indexStatus,
      'A',
    );
    console.log(
      'File tree passed: nested directories, collapse/expand, file selection, and staging in a disposable repository.',
    );
    // Both paths coexist in Git's change set during file-to-directory replacement.
    fs.writeFileSync(path.join(root, 'shape'), 'old file\n');
    await runGit(root, ['add', '--', 'shape']);
    await runGit(root, ['commit', '-m', 'fixture: file before directory replacement']);
    fs.unlinkSync(path.join(root, 'shape'));
    fs.mkdirSync(path.join(root, 'shape'));
    fs.writeFileSync(path.join(root, 'shape', 'new.ts'), 'export const replacement = true;\n');
    await runGit(root, ['add', '--all']);
    await window.webContents.executeJavaScript(
      "document.querySelector('.toolbar [aria-label=刷新]').click()",
    );
    await waitForChangesUI(
      "document.querySelector('.sidebar .file-select[title=shape]') && document.querySelector('.sidebar .file-select[title=\"shape/new.ts\"]')",
    );
    console.log(
      'File tree replacement passed: deleted file and same-name added directory both remain visible.',
    );
    // Seed a separate repository before showing it, so background status refreshes
    // cannot contend with fixture setup for the index lock.
    const historyRoot = path.join(owned, 'history-tree-repository');
    fs.mkdirSync(path.join(historyRoot, 'history', 'deep'), { recursive: true });
    await runGit(historyRoot, ['init', '--initial-branch=main']);
    for (const [key, value] of [
      ['user.name', 'History Tree Test'],
      ['user.email', 'history@example.invalid'],
      ['commit.gpgsign', 'false'],
      ['core.autocrlf', 'false'],
      ['core.hooksPath', path.join(historyRoot, '.git', 'hooks')],
    ])
      await runGit(historyRoot, ['config', key, value]);
    fs.writeFileSync(
      path.join(historyRoot, 'history', 'deep', 'alpha.ts'),
      'export const alpha = "committed alpha";\n',
    );
    fs.writeFileSync(
      path.join(historyRoot, 'history', 'deep', 'beta.ts'),
      'export const beta = "committed beta";\n',
    );
    await runGit(historyRoot, ['add', '--all']);
    await runGit(historyRoot, ['commit', '-m', 'test: history file tree']);
    fs.writeFileSync(
      path.join(historyRoot, 'history', 'deep', 'beta.ts'),
      'WORKTREE_ONLY_HISTORY_CANARY\n',
    );
    const historyRepository = await service.addRepository(historyRoot);
    service.selectRepository(historyRepository.id);
    await window.loadFile(path.resolve('dist/index.html'));
    await waitForChangesUI("document.querySelector('.analysis-button')");
    await window.webContents.executeJavaScript(
      "[...document.querySelectorAll('.view-tabs button')].find(button=>button.textContent.startsWith('提交历史')).click()",
    );
    await waitForChangesUI(
      'document.querySelector(\'.commit-row[title="test: history file tree"]\')',
    );
    await window.webContents.executeJavaScript(
      'document.querySelector(\'.commit-row[title="test: history file tree"]\').click()',
    );
    await waitForChangesUI(
      'document.querySelector(\'.history-files .file-tree-directory .file-tree-directory .history-file[title="history/deep/alpha.ts"]\')',
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('.history-files summary[title=history]').click()",
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        "document.querySelector('.history-files summary[title=history]').parentElement.open",
      ),
      false,
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('.history-files summary[title=history]').click(); document.querySelector('.history-file[title=\"history/deep/alpha.ts\"]').click()",
    );
    await waitForChangesUI(
      "document.querySelector('.diff-title')?.textContent.includes('history/deep/alpha.ts') && document.querySelector('.history-file[aria-current=true]')?.title === 'history/deep/alpha.ts'",
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        "!!document.querySelector('.diff-file-nav, [aria-label=切换差异文件列表]')",
      ),
      false,
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        "document.querySelector('.diff-browser').getBoundingClientRect().width === document.querySelector('.diff-document').getBoundingClientRect().width",
      ),
      true,
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('[aria-label=下一文件]').click()",
    );
    await waitForChangesUI(
      "document.querySelector('.history-file[aria-current=true]')?.title === 'history/deep/beta.ts' && document.querySelector('.diff-lines')?.textContent.includes('committed beta')",
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        "document.querySelector('.diff-lines').textContent.includes('WORKTREE_ONLY_HISTORY_CANARY')",
      ),
      false,
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('[aria-label=上一文件]').click()",
    );
    await waitForChangesUI(
      "document.querySelector('.history-file[aria-current=true]')?.title === 'history/deep/alpha.ts'",
    );
    await window.webContents.executeJavaScript("document.querySelector('.back-button').click()");
    await waitForChangesUI(
      "document.querySelector('.history-panel') && document.querySelector('.history-files .file-tree')",
    );
    console.log(
      'History file tree passed: nested folders, collapse/expand, selection, previous/next highlight, committed snapshot and no duplicate diff list.',
    );
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

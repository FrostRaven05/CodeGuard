const { app } = require('electron');
const { EventEmitter } = require('node:events');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { GitService } = require('../electron/git-service.cjs');
const { createWorkbenchWindow } = require('../electron/workbench-window.cjs');
const { UpdateService } = require('../electron/update-service.cjs');
const owned = process.env.CODEGUARD_SMOKE_ROOT;
if (!owned || !path.basename(owned).startsWith('codeguard-desktop-test-'))
  throw new Error('Isolated profile required');
app.setPath('userData', path.join(owned, 'profile'));
app
  .whenReady()
  .then(async () => {
    const updater = new EventEmitter();
    const calls = [];
    updater.checkForUpdates = async () => updater.emit('update-available', { version: '0.1.6' });
    updater.downloadUpdate = async () => {
      calls.push('download');
      updater.emit('update-downloaded');
    };
    updater.quitAndInstall = (...args) => calls.push(['install', ...args]);
    const updates = new UpdateService({
      app: { isPackaged: true, getVersion: () => '0.1.5' },
      updater,
      shell: { openExternal: async () => {} },
      platform: 'win32',
    });
    const window = await createWorkbenchWindow(new GitService(path.join(owned, 'workspace')), {
      visible: false,
      updates,
    });
    window.webContents.setBackgroundThrottling(false);
    const evaluate = (code) => window.webContents.executeJavaScript(code);
    const wait = (condition) =>
      evaluate(`new Promise((resolve, reject) => {
    const timer = setInterval(() => { if (${condition}) { clearInterval(timer); clearTimeout(deadline); resolve(true); } }, 25);
    const deadline = setTimeout(() => { clearInterval(timer); reject(new Error('Update UI did not settle')); }, 5000);
  })`);
    const click = (label) =>
      evaluate(
        `Array.from(document.querySelectorAll('button')).find(b => b.textContent === ${JSON.stringify(label)}).click()`,
      );
    await wait(`document.querySelector('[aria-label="软件更新"]')`);
    await evaluate(`document.querySelector('[aria-label="软件更新"]').click()`);
    await wait(`document.querySelector('[role="dialog"]')?.textContent.includes('0.1.5')`);
    await click('检查更新');
    await wait(`document.querySelector('[role="dialog"]').textContent.includes('0.1.6')`);
    assert.deepEqual(calls, []);
    await click('下载更新');
    await wait(`document.querySelector('[role="dialog"]').textContent.includes('重启安装')`);
    await click('重启安装');
    assert.deepEqual(calls, ['download']);
    await wait(`document.querySelector('[role="dialog"]').textContent.includes('确认重启安装')`);
    await click('确认重启安装');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.deepEqual(calls, ['download', ['install', false, true]]);
    const invalid = await evaluate(
      `window.codeguard.installUpdate('https://example.invalid/malicious.exe')`,
    );
    assert.equal(invalid.ok, true); // Extra arguments never become a download or executable path.
    assert.equal(calls.length, 2);
    fs.mkdirSync(path.join(owned, 'evidence'), { recursive: true });
    fs.writeFileSync(
      path.join(owned, 'evidence/update-ui.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
    console.log(
      'Update desktop UI passed: isolated IPC, version discovery, explicit download and two-step restart, fixed destination.',
    );
    window.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

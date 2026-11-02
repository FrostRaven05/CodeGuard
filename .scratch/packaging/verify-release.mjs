import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

// Run the actual packaged entry point with a disposable profile and repository.
// The debugging port is local and exists only for this verification process.
for (const target of process.argv.slice(2)) {
  const executable = path.resolve(target);
  assert.ok(fs.existsSync(executable), executable);
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'codeguard-package-test-'));
  const repo = path.join(owned, 'repository');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '--initial-branch=main', repo], { windowsHide: true });
  fs.writeFileSync(path.join(repo, 'package-check.txt'), 'packaged application fixture\n');
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CODEGUARD_DEV_URL;
  const child = spawn(executable, [
    `--user-data-dir=${path.join(owned, 'profile')}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    `--repo=${repo}`,
  ], { env, windowsHide: true, stdio: 'ignore' });
  const closed = once(child, 'close');
  let socket;
  try {
    let page;
    for (let attempt = 0; attempt < 90; attempt++) {
      assert.equal(child.exitCode, null, 'Packaged process exited before the UI loaded');
      try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, {
          signal: AbortSignal.timeout(1000),
        })).json();
        page = pages.find((item) => item.type === 'page' && item.url.endsWith('/dist/index.html'));
        if (page) break;
      } catch { /* The portable launcher needs time to extract its runtime. */ }
      await delay(500);
    }
    assert.ok(page, 'Packaged renderer did not load');
    assert.match(page.url, /app\.asar/);
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await once(socket, 'open');
    let nextId = 0;
    const evaluate = (expression) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        socket.removeEventListener('message', onMessage);
        reject(new Error('Packaged renderer evaluation timed out'));
      }, 10000);
      const onMessage = (event) => {
        const result = JSON.parse(event.data);
        if (result.id !== id) return;
        clearTimeout(timer);
        socket.removeEventListener('message', onMessage);
        if (result.error || result.result.exceptionDetails) reject(new Error(JSON.stringify(result)));
        else resolve(result.result.result.value);
      };
      socket.addEventListener('message', onMessage);
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: {
        expression, awaitPromise: true, returnByValue: true,
      } }));
    });
    let result;
    for (let attempt = 0; attempt < 30; attempt++) {
      result = await evaluate(`(async () => {
        const workspace = await window.codeguard.workspace();
        const repository = workspace.value?.repositories[0];
        return {
          nodeVisible: typeof require !== 'undefined',
          workspace,
          state: repository ? await window.codeguard.state(repository.id) : null,
          text: document.body.innerText,
        };
      })()`);
      if (result.text.includes('package-check.txt')) break;
      await delay(250);
    }
    assert.equal(result.nodeVisible, false);
    assert.equal(result.workspace.ok, true);
    assert.equal(result.workspace.value.repositories.length, 1);
    assert.equal(path.resolve(result.workspace.value.repositories[0].root), repo);
    assert.equal(result.state.ok, true);
    assert.equal(result.state.value.branch, 'main');
    assert.ok(result.state.value.files.some((file) => file.path === 'package-check.txt'));
    assert.match(result.text, /package-check\.txt/);
    assert.ok(fs.existsSync(path.join(owned, 'profile', 'workspace.json')));
    console.log(JSON.stringify({ executable, passed: true,
      checks: ['ASAR entry', 'renderer', 'sandboxed preload IPC', 'system Git', 'isolated profile'],
    }));
    await evaluate('setTimeout(() => window.close(), 100); true');
    await Promise.race([closed, delay(5000)]);
  } finally {
    socket?.close();
    if (child.exitCode === null) {
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); }
      catch { /* The child may have exited between the check and taskkill. */ }
      await Promise.race([closed, delay(3000)]);
    }
    const resolved = path.resolve(owned);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('codeguard-package-test-'));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

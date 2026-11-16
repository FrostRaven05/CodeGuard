import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'codeguard-desktop-test-'));
const env = { ...process.env, CODEGUARD_SMOKE_ROOT: owned };
delete env.ELECTRON_RUN_AS_NODE;
const fixture = process.argv.includes('--updates')
  ? 'tests/update-ui.cjs'
  : process.argv.includes('--commit-message')
    ? 'tests/commit-message-ui.cjs'
    : 'tests/desktop-smoke.cjs';
const child = spawn(require('electron'), [path.resolve(fixture)], {
  env,
  stdio: 'inherit',
  windowsHide: true,
});
const timer = setTimeout(() => {
  console.error('Desktop smoke test timed out.');
  child.kill();
}, 60_000);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  clearTimeout(timer);
  const resolved = path.resolve(owned);
  if (
    path.dirname(resolved) === path.resolve(os.tmpdir()) &&
    path.basename(resolved).startsWith('codeguard-desktop-test-')
  ) {
    try {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      console.error('Temporary profile cleanup:', error.message);
    }
  }
  process.exitCode = code || 0;
});

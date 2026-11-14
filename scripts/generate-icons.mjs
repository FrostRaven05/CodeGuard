import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
const require = createRequire(import.meta.url);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
const child = spawn(require('electron'), [path.resolve('scripts/generate-icons.cjs')], {
  env,
  stdio: 'inherit',
  windowsHide: true,
});
child.on('error', () => {
  console.error('无法启动图标生成程序。');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});

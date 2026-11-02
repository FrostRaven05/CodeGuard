import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
if (args[0] === '--score' && args.length === 2) {
  const { scoreCase } = require('../tests/fixtures/review-cases.cjs');
  const report = JSON.parse(fs.readFileSync(path.resolve(args[1]), 'utf8'));
  console.log(
    JSON.stringify(
      report.cases.map((item) => ({ id: item.id, ...scoreCase(item) })),
      null,
      2,
    ),
  );
} else if (args.length <= 1 && (!args.length || ['--inspect', '--run'].includes(args[0]))) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    require('electron'),
    [path.resolve('scripts/validate-model.cjs'), args[0] || '--inspect'],
    { env, windowsHide: true, stdio: 'inherit' },
  );
  child.on('error', () => {
    console.error('无法启动桌面验证运行时。');
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    if (code) console.error('桌面验证运行时退出失败，请检查运行权限和本地配置。');
    process.exitCode = code ?? 1;
  });
} else {
  console.error('用法：node scripts/validate-model.mjs [--inspect | --run | --score report.json]');
  process.exitCode = 1;
}

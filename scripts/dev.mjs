import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const server = await createServer();
await server.listen();
server.printUrls();
const require = createRequire(import.meta.url);
const env = { ...process.env, CODEGUARD_DEV_URL: 'http://127.0.0.1:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code || 0);
});
child.on('error', async (error) => {
  console.error(error.message);
  await server.close();
  process.exit(1);
});
process.on('SIGINT', () => child.kill());

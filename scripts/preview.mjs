import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { GitService, runGit } = require('../electron/git-service.cjs');
const { createHandlers, invoke } = require('../electron/api-controller.cjs');
const { ModelSettings } = require('../electron/model-settings.cjs');
const { ReviewService } = require('../electron/review-service.cjs');
const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'codeguard-preview-'));
const repository = path.join(owned, 'atlas-console');
fs.mkdirSync(repository);
const write = (name, content) => {
  const file = path.join(repository, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
await runGit(repository, ['init', '--initial-branch=main']);
for (const [key, value] of [
  ['user.name', 'CodeGuard Preview'],
  ['user.email', 'preview@example.invalid'],
  ['commit.gpgsign', 'false'],
  ['core.autocrlf', 'false'],
  ['core.hooksPath', path.join(repository, '.git', 'hooks')],
])
  await runGit(repository, ['config', key, value]);
write('README.md', '# Atlas Console\n\nCodeGuard 的临时演示仓库，不包含用户源码。\n');
write(
  'src/api/client.ts',
  'export async function request(url: string) {\n  const response = await fetch(url);\n  return response.json();\n}\n',
);
write('src/app.ts', 'export const application = "Atlas Console";\n');
await runGit(repository, ['add', '--all']);
await runGit(repository, ['commit', '-m', '建立应用与请求入口']);
await runGit(repository, ['switch', '-c', 'feature/request-timeout']);
write(
  'src/api/client.ts',
  'export async function request(url: string, signal?: AbortSignal) {\n  const response = await fetch(url, { signal });\n  return response.json();\n}\n',
);
await runGit(repository, ['add', '--all']);
await runGit(repository, ['commit', '-m', '为请求增加取消信号']);
await runGit(repository, ['switch', 'main']);
write('docs/development.md', '# 开发说明\n\n本地运行前检查配置。\n');
await runGit(repository, ['add', '--all']);
await runGit(repository, ['commit', '-m', '补充本地开发说明']);
await runGit(repository, ['switch', 'feature/request-timeout']);
await runGit(repository, ['merge', '--no-ff', 'main', '-m', '合并 main 的开发说明']);
write(
  'src/api/client.ts',
  'export async function request(url: string, signal?: AbortSignal) {\n  const response = await fetch(url, { signal });\n  if (!response.ok) {\n    throw new Error(`请求失败：${response.status}`);\n  }\n  return response.json();\n}\n',
);
write(
  'src/api/errors.ts',
  'export class RequestError extends Error {\n  constructor(public status: number, message: string) {\n    super(message);\n    this.name = "RequestError";\n  }\n}\n',
);
await runGit(repository, ['add', '--', 'src/api/client.ts', 'src/api/errors.ts']);
write(
  'src/api/client.ts',
  'export async function request(url: string, signal?: AbortSignal) {\n  const timeout = AbortSignal.timeout(15_000);\n  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;\n  const response = await fetch(url, { signal: combined });\n  if (!response.ok) {\n    throw new Error(`请求失败：${response.status}`);\n  }\n  return response.json();\n}\n',
);
write(
  'README.md',
  '# Atlas Console\n\nCodeGuard 的临时演示仓库，不包含用户源码。\n\n请求支持取消，并准备加入超时处理。\n',
);
write(
  'tests/request.test.ts',
  'import { request } from "../src/api/client";\n\n// 准备补充请求取消与超时的测试。\nexport const subject = request;\n',
);
write('src/config/runtime.ts', 'export const requestTimeoutMs = 15_000;\n');

const service = new GitService(path.join(owned, 'settings'));
await service.addRepository(repository);
const reviews = new ReviewService(
  service,
  new ModelSettings(path.join(owned, 'settings'), { sessionOnly: true }),
);
let mockModel;
if (process.argv.includes('--mock-model')) {
  const { startMockModel } = require('../tests/fixtures/mock-model.cjs');
  mockModel = await startMockModel();
  reviews.settings.save({
    baseUrl: mockModel.baseUrl,
    model: '模拟服务 · 仅交互验收',
    maxContextChars: 60000,
    excludePatterns: '',
  });
}
const handlers = createHandlers(service, async () => repository, reviews);
const origin = 'http://127.0.0.1:5173';
const server = await createServer({
  plugins: [
    {
      name: 'codeguard-disposable-preview',
      configureServer(vite) {
        vite.middlewares.use('/__codeguard/invoke', (request, response) => {
          if (
            request.method !== 'POST' ||
            request.headers['x-codeguard-preview'] !== '1' ||
            (request.headers.origin && request.headers.origin !== origin) ||
            !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)
          ) {
            response.writeHead(403);
            response.end('Forbidden');
            return;
          }
          let size = 0;
          const chunks = [];
          request.on('data', (chunk) => {
            size += chunk.length;
            if (size > 1_000_000) {
              response.writeHead(413);
              response.end('Request too large');
              request.destroy();
            } else chunks.push(chunk);
          });
          request.on('end', async () => {
            if (response.writableEnded) return;
            try {
              const { method, args } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              const result = await invoke(handlers, method, args);
              response.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
              });
              response.end(JSON.stringify(result));
            } catch {
              response.writeHead(400);
              response.end('Invalid request');
            }
          });
        });
      },
    },
  ],
});
await server.listen();
console.log(`临时仓库预览：${origin}（所有写操作仅作用于本次创建的演示仓库）`);
console.log(`临时目录：${owned}`);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  for (const controller of reviews.running.values()) controller.abort();
  await server.close();
  await mockModel?.close();
  const resolved = path.resolve(owned);
  if (
    path.dirname(resolved) === path.resolve(os.tmpdir()) &&
    path.basename(resolved).startsWith('codeguard-preview-')
  )
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  process.exit(0);
}
process.on('SIGINT', close);
process.on('SIGTERM', close);

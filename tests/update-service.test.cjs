const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { UpdateService, DOWNLOAD_PAGE } = require('../electron/update-service.cjs');

function fixture(options = {}) {
  const updater = new EventEmitter();
  const calls = [];
  updater.checkForUpdates = async () => {
    calls.push('check');
    updater.emit('update-available', { version: '0.1.6' });
  };
  updater.downloadUpdate = async () => {
    calls.push('download');
    updater.emit('download-progress', { percent: 50 });
    updater.emit('update-downloaded');
  };
  updater.quitAndInstall = () => calls.push('install');
  const service = new UpdateService({
    app: { isPackaged: true, getVersion: () => '0.1.5' },
    updater,
    shell: { openExternal: async (url) => calls.push(url) },
    platform: 'win32',
    ...options,
  });
  return { service, updater, calls };
}

test('checking never downloads; downloaded update remains ready across checks', async () => {
  const { service, updater, calls } = fixture();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
  service.install();
  await service.download();
  assert.deepEqual(calls, []);
  await service.check();
  assert.equal(service.state().status, 'available');
  assert.deepEqual(calls, ['check']);
  await service.download();
  assert.equal(service.state().status, 'downloaded');
  assert.equal(service.state().percent, 100);
  await service.check();
  await service.download();
  assert.deepEqual(calls, ['check', 'download']);
});

test('portable opens fixed download page without running installer', async () => {
  const { service, calls } = fixture({ portable: true });
  await service.check();
  await service.download();
  service.install();
  assert.deepEqual(calls, ['check', DOWNLOAD_PAGE]);
});

test('failures recover and concurrent checking cannot duplicate the request', async () => {
  const { service, updater, calls } = fixture();
  let release;
  updater.checkForUpdates = () => {
    calls.push('check');
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const first = service.check();
  await service.check();
  assert.deepEqual(calls, ['check']);
  updater.emit('error', new Error('private diagnostic'));
  release();
  await first;
  assert.equal(service.state().status, 'error');
  assert.doesNotMatch(service.state().message, /private/);
  updater.checkForUpdates = async () => updater.emit('update-not-available');
  await service.check();
  assert.equal(service.state().status, 'current');
});

test('failed integrity/download never enables installation', async () => {
  const { service, updater, calls } = fixture();
  await service.check();
  updater.downloadUpdate = async () => {
    throw new Error('checksum mismatch');
  };
  await service.download();
  service.install();
  assert.equal(service.state().status, 'error');
  assert.deepEqual(calls, ['check']);
});

test('development build does not contact update server', async () => {
  const { service, calls } = fixture({ app: { isPackaged: false, getVersion: () => '0.1.5' } });
  service.start();
  await service.check();
  await service.download();
  service.install();
  assert.equal(service.state().status, 'unsupported');
  assert.deepEqual(calls, []);
  service.dispose();
});

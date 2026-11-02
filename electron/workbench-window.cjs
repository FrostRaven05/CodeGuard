const { BrowserWindow, dialog, ipcMain, safeStorage } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHandlers, invoke } = require('./api-controller.cjs');
const { ModelSettings } = require('./model-settings.cjs');
const { ReviewService } = require('./review-service.cjs');

async function createWorkbenchWindow(
  service,
  { developmentUrl, visible = true, chooseDirectory, reviews } = {},
) {
  if (developmentUrl && developmentUrl !== 'http://127.0.0.1:5173')
    throw new Error('Invalid development URL');
  const entry = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;
  const window = new BrowserWindow({
    width: 1440,
    height: 950,
    minWidth: 1080,
    minHeight: 700,
    title: 'CodeGuard',
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: { color: '#1a1e25', symbolColor: '#c5cdd9', height: 55 },
        }
      : {}),
    backgroundColor: '#12151b',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== entry && url !== `${developmentUrl}/`) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.webContents.on('preload-error', (_event, _file, error) =>
    console.error('Preload failed:', error.message),
  );
  reviews ||= new ReviewService(
    service,
    new ModelSettings(path.dirname(service.storageFile), { safeStorage }),
  );
  const unsubscribeProgress = reviews.subscribeProgress((progress) => {
    if (!window.isDestroyed()) window.webContents.send('codeguard:review-progress', progress);
  });
  const handlers = createHandlers(
    service,
    chooseDirectory ||
      (async () => {
        const result = await dialog.showOpenDialog(window, {
          title: '选择已有 Git 仓库',
          properties: ['openDirectory'],
        });
        return result.canceled ? null : result.filePaths[0];
      }),
    reviews,
  );
  ipcMain.handle('codeguard:invoke', async (event, method, args) => {
    const url = event.senderFrame?.url;
    const trustedUrl = developmentUrl ? url?.startsWith(`${developmentUrl}/`) : url === entry;
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !trustedUrl
    )
      return { ok: false, error: { message: '请求来源无效。', code: 'UNTRUSTED_FRAME' } };
    return invoke(handlers, method, args);
  });
  window.on('focus', () => window.webContents.send('codeguard:changed'));
  window.on('closed', () => {
    unsubscribeProgress();
    ipcMain.removeHandler('codeguard:invoke');
    for (const controller of reviews.running.values()) controller.abort();
    for (const controller of reviews.commitMessages.running.values()) controller.abort();
  });
  if (visible) window.once('ready-to-show', () => window.show());
  if (developmentUrl) await window.loadURL(developmentUrl);
  else await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  return window;
}

module.exports = { createWorkbenchWindow };

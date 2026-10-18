const { app, dialog, Menu } = require('electron');
const path = require('node:path');
const { GitService } = require('./git-service.cjs');
const { createWorkbenchWindow } = require('./workbench-window.cjs');

if (!app.isPackaged) app.setPath('userData', path.join(__dirname, '..', '.local', 'desktop'));
app.setAppUserModelId('local.codeguard.desktop');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let window;
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      const service = new GitService(app.getPath('userData'));
      const initialPath = process.argv.find((arg) => arg.startsWith('--repo='))?.slice(7);
      if (initialPath) {
        try {
          await service.addRepository(initialPath);
        } catch (error) {
          service.loadWarning = error.message;
        }
      }
      Menu.setApplicationMenu(null);
      window = await createWorkbenchWindow(service, {
        developmentUrl: process.env.CODEGUARD_DEV_URL,
      });
    })
    .catch((error) => {
      dialog.showErrorBox('CodeGuard 无法启动', error.message);
      app.quit();
    });
  app.on('window-all-closed', () => app.quit());
}

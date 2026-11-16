const DOWNLOAD_PAGE = 'https://codereview.frostraven05.com/#download';

class UpdateService {
  constructor({ app, updater, shell, portable = false, platform = process.platform }) {
    this.app = app;
    this.updater = updater;
    this.shell = shell;
    this.supported = app.isPackaged && platform === 'win32';
    this.portable = portable;
    this.value = {
      status: this.supported ? 'idle' : 'unsupported',
      currentVersion: app.getVersion(),
      version: null,
      percent: 0,
      portable,
      message: this.supported ? '可检查新版本。' : '请在 Windows 正式发布版中检查更新。',
    };
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.disableWebInstaller = true;
    updater.on('checking-for-update', () => this.set('checking', '正在检查更新…'));
    updater.on('update-available', (info) => {
      this.value.version = info.version;
      this.set(
        'available',
        portable ? '发现新版本，请下载新版免安装程序。' : '发现新版本，可下载更新。',
      );
    });
    updater.on('update-not-available', () => {
      this.value.version = null;
      this.set('current', '当前已是最新版本。');
    });
    updater.on('download-progress', (info) => {
      this.value.percent = Math.max(0, Math.min(100, Number(info.percent) || 0));
      this.set('downloading', '正在下载更新…');
    });
    updater.on('update-downloaded', () => {
      this.value.percent = 100;
      this.set('downloaded', '更新已下载。准备好后重启安装。');
    });
    updater.on('error', () => this.set('error', '更新失败，请检查网络后重试，或前往官网下载。'));
  }
  set(status, message) {
    this.value.status = status;
    this.value.message = message;
  }
  state() {
    return { ...this.value };
  }
  async check() {
    if (
      !this.supported ||
      ['checking', 'downloading', 'downloaded', 'installing'].includes(this.value.status)
    )
      return this.state();
    this.set('checking', '正在检查更新…');
    try {
      await this.updater.checkForUpdates();
    } catch {
      this.set('error', '无法检查更新，请检查网络后重试。');
    }
    return this.state();
  }
  async download() {
    if (!this.supported || this.value.status !== 'available') return this.state();
    if (this.portable) {
      await this.openDownload();
      return this.state();
    }
    this.value.percent = 0;
    this.set('downloading', '正在下载更新…');
    try {
      await this.updater.downloadUpdate();
    } catch {
      this.set('error', '下载或校验失败，请重新检查更新后重试。');
    }
    return this.state();
  }
  install() {
    if (!this.supported || this.portable || this.value.status !== 'downloaded') return this.state();
    this.set('installing', '正在退出并安装更新…');
    // Let the IPC response settle before the updater closes the window.
    setTimeout(() => {
      try {
        this.updater.quitAndInstall(false, true);
      } catch {
        this.set('error', '无法启动安装程序，请前往官网下载。');
      }
    }, 1000);
    return this.state();
  }
  async openDownload() {
    await this.shell.openExternal(DOWNLOAD_PAGE);
    return this.state();
  }
  start() {
    if (!this.supported) return;
    this.initialTimer = setTimeout(() => void this.check(), 10_000);
    this.timer = setInterval(() => void this.check(), 6 * 60 * 60 * 1000);
    this.initialTimer.unref();
    this.timer.unref();
  }
  dispose() {
    clearTimeout(this.initialTimer);
    clearInterval(this.timer);
  }
}

module.exports = { UpdateService, DOWNLOAD_PAGE };

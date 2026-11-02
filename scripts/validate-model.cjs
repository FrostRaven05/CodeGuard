const { app, safeStorage } = require('electron');
const path = require('node:path');
const { ModelSettings } = require('../electron/model-settings.cjs');
const { validateModel } = require('./model-validation-runner.cjs');

app
  .whenReady()
  .then(async () => {
    const settings = new ModelSettings(path.resolve('.local/desktop'), { safeStorage });
    const publicSettings = settings.getPublic();
    console.log(JSON.stringify({ configuration: publicSettings, networkRequests: 0 }));
    if (process.argv.at(-1) !== '--run') return;
    if (!publicSettings.baseUrl || !publicSettings.model || publicSettings.warning) {
      console.log('尚未配置有效模型。请在 CodeGuard 模型设置中填写并保存，再运行 --run。');
      return;
    }
    // Decrypt only within the Electron process; no keys, headers or raw exceptions are logged.
    const { reportFile, report } = await validateModel(settings, {
      reportDirectory: path.resolve('.local/model-validation'),
      onProgress: (value) => console.log(JSON.stringify(value)),
    });
    console.log(`验证记录：${reportFile}`);
    if (report.cleanup?.status === 'retained')
      console.log(`临时目录尚未清理；评审记录已保存（${report.cleanup.errorCode}）。`);
    if (report.cases.some((item) => item.protocol === 'failed')) process.exitCode = 1;
  })
  .catch(() => {
    console.error(
      '验证未完成。请检查桌面模型配置、系统密钥保护与临时目录权限；未输出密钥或服务原始响应。',
    );
    process.exitCode = 1;
  })
  .finally(() => app.exit(process.exitCode || 0));

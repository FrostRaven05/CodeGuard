# CodeGuard 落地页

独立、无第三方运行时依赖的中文静态页面，沿用桌面软件的配色和图标。不会改变 Electron 的启动入口。

在项目根目录运行：

```powershell
npm --prefix website start
```

打开 http://127.0.0.1:4174 。构建命令为 `npm --prefix website run build`，可将 `website/dist/` 部署到任意静态托管服务。

也可直接用浏览器打开构建后的 `dist/index.html`，所有资源均使用相对路径，无需联网加载字体或脚本。按用户要求仅保留本地页面，没有上传源码、截图或发布在线站点。

`assets/` 中的四张截图来自 `docs/images/`，使用独立临时仓库和模拟模型，仅用于展示界面。更换产品截图时同步替换这些文件。正式站点为 https://codereview.frostraven05.com，下载按钮指向同站 `/updates/` 中实际发布的安装版、免安装版及 SHA-256 清单。发布步骤见 `../deploy/README.md`；新版本需同步更新下载链接。

页面提供截图切换、图片放大与键盘导航、移动导航和 FAQ 展开；没有统计追踪或表单数据收集。

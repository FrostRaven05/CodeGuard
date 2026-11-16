# 01 — 桌面更新与独立更新站点

**What to build:** 安装版启动检查及手动检查、下载、进度、确认重启安装；免安装版检查并前往官网下载。将官网与更新源部署到用户指定服务器的 codereview.frostraven05.com，使用 HTTPS，保留其他站点。

**Blocked by:** 无。

**Status:** done

## Acceptance criteria

- 更新操作仅通过受信主窗口的白名单 IPC 暴露；不接受任意下载地址。
- 下载由用户发起，退出不自动安装，拒绝降级；错误可重试。
- 安装版生成 latest.yml、安装程序、blockmap；官网下载提供安装版和免安装版。
- HTTPS 证书有效、版本清单可读、下载与 Range 请求可用、服务器资产校验匹配。
- Git 写验证使用临时仓库；保留现有工作区及暂存区。

## Verification

2026-11-16：

- `npm run build` 通过；`npm test` 在允许临时本地服务的环境下 126/126 通过。初次沙箱执行受本地网络与钩子限制，未将该次失败当作产品回归。
- `npm run test:desktop` 完整通过；`node scripts/desktop-smoke.mjs --updates` 通过真实沙箱 preload/IPC 验证版本发现、用户下载、二次确认及安装器调用参数，安装器由测试替身接收，没有覆盖本机安装。
- 正式 NSIS 安装包、blockmap、免安装程序和 latest.yml 已生成并部署。两种正式运行包均使用独立配置与临时仓库启动成功，并从真实线上更新源返回“当前已是最新版本”；免安装标识正确。
- ASAR 内更新模块及主进程桥接文件逐字节匹配最终源码，版本 0.1.5、electron-updater 6.8.11，4777 个文件，无 `.local`、`.git`、`.env` 或 workspace.json 混入。
- 服务器上传逐个核对 SHA-256；官网目录以符号链接原子切换，latest.yml 在所有资产上传核对后发布。公开 HTTPS、首页下载链接、healthz、清单内容与 no-store、两种 EXE 大小、单段/多段 Range 206、blockmap 和 SHA256SUMS 精确内容均已通过外部验证。
- Nginx 配置检查通过，现有 frostraven05.com 与 todo.frostraven05.com 均继续返回 200。域名 SNI 仅新增 127.0.0.1:8444 路由，保留原规则。证书有效期至 2027-02-14，每日两次的续期 timer 已启用。
- 暂存区仍为空，未提交、暂存或推送用户仓库；已有官网、截图、文档改动保留。凭据仅在 SSH 交互提示中使用，未写入部署脚本、站点或发布包。

安装包 SHA-256：`a4b82fe300c81a2dd37056256b4f3e4a561c2f43b38344c2b9704b20b0188f32`。

免安装版 SHA-256：`6e7af20c85da70440eb5ade9e9d3f80654d15260833472d3f1e7aa986aab0155`。

真实 `NsisUpdater` 客户端模拟当前版本 0.1.4，从线上 HTTPS 源发现 0.1.5，完整下载 122876304 bytes 并通过 SHA-512 校验；进程正常退出，下载后再次计算的 SHA-256 与本地发布资产一致。测试配置及下载缓存全部位于忽略的 `.local/deployment/`，没有执行安装器。

证书续期 dry-run 完成，Certbot 日志确认 `all simulated renewals succeeded`、目标证书 success、`no renewal failures`；正式证书未被测试证书替换，timer 保持 enabled/active。

边界：0.1.4 本身未包含更新入口，需要手动获取一次新版。未配置发布者代码签名；本轮未在实际用户安装目录执行版本替换，只验证真实客户端检查/下载和隔离的安装调用流程。

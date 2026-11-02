# 01 — Windows 安装包与免安装版

**What to build:** 为当前 CodeGuard 源码生成 Windows x64 安装包与免安装可执行文件，提供可重复运行的打包入口。

**Blocked by:** 无。

**Status:** done

- [x] 打包仅包含运行资源，不包含本地配置、密钥、仓库数据、测试及开发记录。
- [x] NSIS 配置支持当前用户安装、选择目录及快捷方式；免安装版真实启动通过。未在用户系统执行安装或卸载。
- [x] 记录构建、打包内容检查、真实打包应用启动验证与产物路径。
- [x] 说明系统 Git 依赖与打包版独立的数据目录。

## Verification

2026-11-02：新增 `electron-builder.json`，固定开发依赖 `electron-builder@26.18.1`，提供 `npm run package` 与 `npm run package:dir`。输出目录 `release/` 排除版本控制，打包包含前端构建、Electron 主进程模块与生产依赖。应用名称为 CodeGuard，App ID 沿用 `local.codeguard.desktop`，保留原有沙箱与 IPC 配置。

- `npm run package`：类型检查、Vite 构建、Windows x64 NSIS 安装包及 portable 可执行文件生成通过。存在 lucide-react 的 `use client` 构建提示；未配置签名与自定义图标，采用默认 Electron 图标。
- `npm test`：普通权限环境 84/84 通过，日志 `.local/packaging-tests.log`。首次受限沙箱运行无法完成本机 HTTP 与 Git 钩子/子进程用例，随后在普通权限环境完整重跑通过。
- 使用 `@electron/asar` 检查 `release/win-unpacked/resources/app.asar`：4467 个条目，不含 `.local`、`.git`、`.scratch`、`tests`、`docs`；入口 `electron/main.cjs`、`productName: CodeGuard` 正确。
- `node .scratch/packaging/verify-release.mjs release/win-unpacked/CodeGuard.exe release/CodeGuard-0.1.0-Portable-x64.exe`：两者均通过。真实 ASAR 入口、前端加载、sandbox preload IPC、临时仓库 Git 状态和隔离用户配置持久化均正常。验证结束关闭测试进程并清理专用临时目录。
- 安装器未在用户系统执行安装/卸载；安装目录版的可执行文件与免安装版均已实际运行。开发运行配置未迁移，README 已说明 `%APPDATA%/CodeGuard/` 与系统 Git 依赖。

产物：

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| `release/CodeGuard-0.1.0-Setup-x64.exe` | 122375613 bytes | `65486b622b318eb2792c3b1f9521532371abe35074badb5f72000a6598bc9964` |
| `release/CodeGuard-0.1.0-Portable-x64.exe` | 110416266 bytes | `6b89a1e193db189bc82023976f5367ac78f9b0293fa4070d260b9d65cb9f0cb9` |

校验值另存 `release/SHA256SUMS.txt`。所有 Git 写验证使用专用临时仓库，未暂存、提交、重置或清理开发仓库现有改动。

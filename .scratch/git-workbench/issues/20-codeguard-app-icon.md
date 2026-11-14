# 20 — 替换 Electron 默认应用图标

**What to build:** 窗口/任务栏、Windows 可执行文件、安装/卸载程序和网页图标统一使用 CodeGuard 图标。

**Blocked by:** 无。

**Status:** done

- [x] 使用工作台现有薄荷绿 Git 分支标识生成 SVG、PNG 和多尺寸 ICO。
- [x] 配置运行时与打包资源，覆盖安装版、免安装版与卸载程序。
- [x] 验证原生图标加载和打包后 EXE 的图标资源，不操作用户桌面。

## Verification

2026-11-11：源图 `public/codeguard.svg`，通过隐藏渲染器生成 256px PNG 与包含 16/24/32/48/64/128/256 帧的 ICO，逐帧验证尺寸。窗口使用平台对应图标路径，打包白名单包含图标；Windows 主程序、NSIS 安装/卸载与 portable 配置均使用自有 ICO，网页使用同源 SVG。

TypeScript 与生产构建通过，隐藏窗口专项四场景通过。electron-builder 实际生成安装版与免安装版；使用 Windows 文件图标提取 API 分别读取主程序、安装器和免安装 EXE，均为薄荷绿分支图标。打包 archive 内 ICO/PNG 与源码字节完全一致，favicon 一致；独立无窗口 Electron 实际从 archive 加载 ICO 与 PNG 均非空且为 256×256。

最终产物在 `release/icon-update/`，已将 Setup、Portable 与 blockmap 同步到 `release/`，逐文件 SHA-256 核对一致并更新 `release/SHA256SUMS.txt`。没有安装或启动产物，没有操作用户桌面；运行中的旧窗口需下次重新启动后使用新图标。用户索引未变。

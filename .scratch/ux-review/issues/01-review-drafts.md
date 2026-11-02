# 01 — 保留规范与需求草稿

**Blocked by:** none

**Status:** ready-for-human

## What to build / Acceptance

编辑依据后自动保存；切换视图、仓库或重启保留输入；显示保存状态、失败重试，发送采用最新依据。

## Verification

2026-10-25：针对性回归验证快速连续输入、旧响应/组件重新读取、失败保留与重试、跨仓库隔离；保存队列不随组件卸载取消。评审准备等待草稿保存。

`npm run test:ux` 12/12 通过，`npm run build` 通过，`git diff --check` 通过。实现已完成，待正常桌面环境交互/视觉验收：当前环境阻断 HTTP、Git/MSYS 子进程及 Electron 桌面启动，浏览器拒绝 file: 本地预览，未绕过策略。

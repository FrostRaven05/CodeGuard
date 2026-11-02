# 04 — 连续浏览差异

**Blocked by:** none

**Status:** ready-for-human

## What to build / Acceptance

差异页提供可收起文件列表和上一/下一文件；区分同一路径不同版本；返回概览恢复滚动位置。

## Verification

2026-10-25：实现可折叠文件导航、当前位置、上一/下一及首尾禁用；同一路径按差异范围区分，暂存刷新真实文件列表；概览/历史按滚动事件记录并在返回时恢复。代码检查和生产构建通过，实际点击/视觉未验收。

`npm run test:ux` 12/12 通过，`npm run build` 通过，`git diff --check` 通过。实现已完成，待正常桌面环境交互/视觉验收：当前环境阻断 HTTP、Git/MSYS 子进程及 Electron 桌面启动，浏览器拒绝 file: 本地预览，未绕过策略。

# 05 — 明确分支入口意图

**Blocked by:** none

**Status:** ready-for-human

## What to build / Acceptance

区分当前检出和浏览分支；左栏明确浏览，顶部明确切换/合并；可返回全部历史。

## Verification

2026-10-25：左侧提供明确的浏览名称/提示，浏览分支通过 ref 约束历史；顶部保留当前检出并描述切换/合并。临时仓库验证浏览分支查询不改变 HEAD；代码检查和生产构建通过，实际点击/视觉未验收。

`npm run test:ux` 12/12 通过，`npm run build` 通过，`git diff --check` 通过。实现已完成，待正常桌面环境交互/视觉验收：当前环境阻断 HTTP、Git/MSYS 子进程及 Electron 桌面启动，浏览器拒绝 file: 本地预览，未绕过策略。

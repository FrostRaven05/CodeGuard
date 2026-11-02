# 02 — 先理解全部本地改动

**Blocked by:** none（本批集成，关联 01-review-drafts.md）

**Status:** ready-for-human

## What to build / Acceptance

无需暂存即可理解固定工作区快照和未跟踪文本；遵守忽略、排除和预算；真实索引、工作文件不变；变化使旧预览失效；范围不冒充提交评审。

## Verification

2026-10-25：专用临时仓库验证最新工作区、未跟踪/忽略、敏感内容、重命名排除、二进制/链接、空仓库和删除；真实 index 字节及工作文件保持不变；同大小并恢复时间戳仍识别内容变化。clean filter 及 post-index-change 钩子不会运行，临时索引目录已清理。评审定位读取固定树，后续编辑使旧结果过期。

`npm run test:ux` 12/12 通过，`npm run build` 通过，`git diff --check` 通过。实现已完成，待正常桌面环境交互/视觉验收：当前环境阻断 HTTP、Git/MSYS 子进程及 Electron 桌面启动，浏览器拒绝 file: 本地预览，未绕过策略。

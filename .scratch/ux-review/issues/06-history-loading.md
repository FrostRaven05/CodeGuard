# 06 — 可查找的完整历史

**Blocked by:** none（本批集成，关联 05-branch-intent.md）

**Status:** ready-for-human

## What to build / Acceptance

超过150条可继续加载；服务端搜索说明、作者或哈希，组合分支过滤；显示已加载数量；旧查询不能覆盖新结果。

## Verification

2026-10-25：165 条合成历史验证 150+15 分页、无重复或遗漏、跨未加载历史搜索标题/作者/哈希、组合分支范围、无匹配和非法查询。界面提供已加载范围/继续加载/重试，使用请求世代忽略旧查询并合并去重。代码检查和生产构建通过，实际点击/视觉未验收。

`npm run test:ux` 12/12 通过，`npm run build` 通过，`git diff --check` 通过。实现已完成，待正常桌面环境交互/视觉验收：当前环境阻断 HTTP、Git/MSYS 子进程及 Electron 桌面启动，浏览器拒绝 file: 本地预览，未绕过策略。

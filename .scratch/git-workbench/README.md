# 第一阶段：Git 工作台

按用户确认的拆分交付四个任务，均已完成。每个文件保留独立的依赖、验收项与验证记录。

1. [打开和切换本地仓库](issues/01-open-repository.md) — 无前置依赖。
2. [查看差异与选择本次提交内容](issues/02-diff-and-stage.md) — 依赖 01。
3. [预览并完成真实提交](issues/03-preview-and-commit.md) — 依赖 02。
4. [浏览提交历史和提交差异](issues/04-history-and-commit-diff.md) — 依赖 01。
5. [解释仓库所有者不匹配错误](issues/05-repository-ownership.md) — 后续修复，已完成。
6. [深色一体式标题栏](issues/06-integrated-titlebar.md) — 已完成。
7. [深色仓库菜单与标题拖动区](issues/07-repository-menu-and-drag.md) — 已完成，依赖 06。
8. [精简当前改动主区](issues/08-compact-changes.md) — 已完成。
9. [生成提交信息](issues/09-generate-commit-message.md) — 复用模型配置，依据暂存快照生成可编辑草稿。
10. [暂存全部](issues/10-stage-all.md) — 改动文件标题右侧，一次暂存全部新增、修改、删除与重命名。
11. [常用操作直达与使用体验整改](issues/11-direct-user-workflows.md) — 差异页暂存、可见生成按钮、评审直接展示、远程管理和同步衔接。
12. [大字与简洁首屏](issues/12-readable-compact-workbench.md) — 放大文字、加宽右栏、精简重复信息，常用操作首屏可见。
13. [左栏改动文件](issues/13-changes-sidebar.md) — 当前改动移到左侧，分支历史、切换与合并统一使用顶部菜单。
14. [一键生成规范提交信息](issues/14-direct-conventional-commit-message.md) — 点击即生成，无弹窗，采用 Conventional Commits 并校验格式。
15. [提交与分析操作直达](issues/15-direct-commit-and-review.md) — 提交直接执行，两个分析按钮直接进入进度，移除重复的范围切换与确认弹窗。
16. [按暂存状态自动选择分析范围](issues/16-auto-analysis-action.md) — 合并为一个分析按钮，有暂存就评审本次提交，否则理解全部本地改动。
17. [修复长思考流导致评审中断](issues/17-reasoning-stream-limit.md) — 分离 SSE 传输量与正文限制，思考阶段显示真实活动状态。
18. [核实评审发现并修复准备取消](issues/18-commit-message-cancellation.md) — 仓库切换发现为误报；修复准备取消仍卡住及旧任务干扰重试。
19. [后台真实 DeepSeek 复审修复](issues/19-deepseek-fix-rereview.md) — 固定修复差异，核对真实复审、保存与独立进程重读，并完善测试收尾同步。
20. [替换 Electron 默认应用图标](issues/20-codeguard-app-icon.md) — 统一运行时窗口、任务栏、安装/卸载与免安装程序图标。
21. [用图表理解改动与证据核对](issues/21-explain-changes-and-file-tree.md) — 前后行为及影响图、固定快照跨目录搜索、假设与结论，以及左栏文件树。
22. [历史差异使用右侧文件树](issues/22-history-file-tree.md) — 移除重复的差异左侧列表，右侧按目录浏览历史提交文件。
23. [精简评审与改进上下文预算](issues/23-readable-review-context.md) — 分离读取和发送限制、差异分散采样、上下文去重与提示合并；图解/流程去重，移除处置表单。

验证：15 项 Git 集成测试通过（含后续所有权错误回归）；首阶段类型检查和生产构建通过；隐藏 Electron 窗口验证真实沙箱桥接与提交；浏览器临时仓库走通差异 → 预览 → 提交 → 历史。

[历史视图截图](evidence/history.jpg) 来自专用临时仓库的窄窗口开发预览，不包含用户源码。

2026-10-18 已继续交付[模型配置与本次提交 AI 评审](../ai-review/README.md)和[远端同步、分支切换与合并](../git-sync/README.md)。当前尚未交付：其他范围评审、项目规范自动发现、手动检查与独立安装包。

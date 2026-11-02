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

验证：15 项 Git 集成测试通过（含后续所有权错误回归）；首阶段类型检查和生产构建通过；隐藏 Electron 窗口验证真实沙箱桥接与提交；浏览器临时仓库走通差异 → 预览 → 提交 → 历史。

[历史视图截图](evidence/history.jpg) 来自专用临时仓库的窄窗口开发预览，不包含用户源码。

2026-10-18 已继续交付[模型配置与本次提交 AI 评审](../ai-review/README.md)和[远端同步、分支切换与合并](../git-sync/README.md)。当前尚未交付：其他范围评审、项目规范自动发现、手动检查与独立安装包。

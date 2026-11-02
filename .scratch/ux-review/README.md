# 产品体验修正

2026-10-25。所有写验证使用专用临时仓库，保留开发仓库工作区和暂存区。

- [01 — 保留规范与需求草稿](issues/01-review-drafts.md)：ready-for-human
- [02 — 先理解全部本地改动](issues/02-local-understanding.md)：ready-for-human
- [03 — 记录问题处理和复查](issues/03-finding-disposition.md)：ready-for-human
- [04 — 连续浏览差异](issues/04-diff-navigation.md)：ready-for-human
- [05 — 明确分支入口意图](issues/05-branch-intent.md)：ready-for-human
- [06 — 可查找的完整历史](issues/06-history-loading.md)：ready-for-human


## 验证与交付

2026-10-25：六项修正已实现，生产构建及类型检查通过，`git diff --check` 通过。`npm run test:ux` 的 12 项离线回归全部通过，均使用应用存储和专用临时仓库，不对开发仓库暂存或提交。

完整 `npm test` 本次运行 80 项，42 通过、38 失败。14 项失败由 Git/MSYS `NtCreateDirectoryObject … 0xC0000022` 导致，24 项由本机模型 HTTP `MODEL_NETWORK_ERROR` 或相应断言导致；未关闭安全限制或替换原有 HTTP 测试以掩盖失败。随后补充的草稿及版本测试通过独立 `test:ux` 验证。完整日志为 `.local/ux-review-tests.log`（开发环境忽略文件）。

`npm run test:desktop` 的 Electron 进程在当前环境退出且未产生验收输出，未计为通过。本地文件协议的离线界面夹具又被浏览器安全策略拒绝，未尝试绕过。六项均记为 ready-for-human，表示实现已完成而正常桌面的点击/视觉验收尚未完成，并非用户人工确认或生产验收通过。

新增运行方式：`npm run test:ux`。快照、处置及分页取舍见 [ADR-0005](../../docs/adr/0005-local-understanding-and-disposition.md)。

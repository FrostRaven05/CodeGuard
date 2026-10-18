# 05 — 解释仓库所有者不匹配错误

**What to build:** 打开仓库被 Git 的所有权检查拒绝时，显示中文原因与恢复步骤，保留 Git 原始详情和准确的目录信任命令。

**Blocked by:** 01 — 打开和切换本地仓库。

**Status:** done

- [x] 使用单独的 `DUBIOUS_OWNERSHIP` 错误类型，解释所有者与当前账户不同。
- [x] 打开失败不注册仓库、不自动修改信任配置。
- [x] 用户显式信任指定目录后，可以重新打开仓库。
- [x] 在隔离配置、专用临时仓库中覆盖真实 Git 拒绝与恢复过程。

## Verification

2026-10-15：在桌面当前账户下复现 Praxis 的 `fatal: detected dubious ownership`。其 `.git` 属于 `CodexSandboxOffline`，桌面运行账户为 `ltcxl`。仅在当前用户的全局 Git 配置中添加 `C:/Project/01Project/Praxis`，原始只读检查恢复成功，读取到分支 `master`；没有修改该仓库的文件或暂存区。

应用回归测试先因错误仍为 `GIT_ERROR` 而失败，补充分类和中文说明后通过。测试以 Git 的所有者测试开关产生真实拒绝，使用专用空白全局配置验证不会自动添加信任，以及手动添加精确目录后的恢复。15 项 Git 集成测试全部通过，服务文件语法检查通过。

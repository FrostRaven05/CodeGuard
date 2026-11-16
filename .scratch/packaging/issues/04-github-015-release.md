# 04 — 发布 GitHub v0.1.5 安装版与免安装版

**What to build:** 按用户授权，提交并推送更新机制、官网、截图及部署文档等现有改动，在 GitHub 发布 v0.1.5 安装版与免安装版，附版本专属校验清单和更新元数据。

**Blocked by:** `.scratch/updates/issues/01-update-service-deployment.md`（done）。

**Status:** in-progress

## Acceptance criteria

- 提交范围经过核对，不纳入被忽略的本地配置、凭据或构建缓存。
- 发布资产与已部署的 v0.1.5 完全一致，核对实际 EXE、ASAR 与提交源码。
- 推送至 origin/main，v0.1.5 指向对应代码提交，不覆盖旧版本。
- 先上传草稿资产并核对大小与 SHA-256，再正式发布并设为 Latest。
- 记录公开 Release 地址、资产和验证范围。

## Verification

进行中。

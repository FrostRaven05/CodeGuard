# 04 — 发布 GitHub v0.1.5 安装版与免安装版

**What to build:** 按用户授权，提交并推送更新机制、官网、截图及部署文档等现有改动，在 GitHub 发布 v0.1.5 安装版与免安装版，附版本专属校验清单和更新元数据。

**Blocked by:** `.scratch/updates/issues/01-update-service-deployment.md`（done）。

**Status:** done

## Acceptance criteria

- 提交范围经过核对，不纳入被忽略的本地配置、凭据或构建缓存。
- 发布资产与已部署的 v0.1.5 完全一致，核对实际 EXE、ASAR 与提交源码。
- 推送至 origin/main，v0.1.5 指向对应代码提交，不覆盖旧版本。
- 先上传草稿资产并核对大小与 SHA-256，再正式发布并设为 Latest。
- 记录公开 Release 地址、资产和验证范围。

## Verification

2026-11-16：完成代码提交 `b4129e62072079abcf425e6754d7aa816aa1d954` 并推送至 `origin/main`，共 45 个文件，包含桌面更新、独立官网、截图、中英文说明和部署配置。[v0.1.5](https://github.com/FrostRaven05/CodeGuard/releases/tag/v0.1.5) 已正式发布，非预发布、非草稿，并设为 Latest；远端标签与本地同步标签均指向该代码提交。保留既有 Release。

从实际安装 EXE 和免安装 EXE 中提取 ASAR 与更新配置，核对两者相同，并与已验证运行目录一致；全部 Electron 模块匹配暂存版本及最终提交，重新生产构建的前端与包内 dist 完全一致。检查 45 个暂存文件、4710 个 ASAR 文件及 5 份可读取凭据/密文，未发现精确命中或令牌/私钥模式命中，无异常本地配置路径。仅核对可读取的凭据和配置密文，未声称解密或核查所有历史环境中的密钥。详细无密钥记录在忽略的 `.local/release-audit-0.1.5/`。

发布资产与独立站点现有文件完全一致：

| 资产 | 字节 | SHA-256 |
| --- | ---: | --- |
| CodeGuard-0.1.5-Setup-x64.exe | 122876304 | a4b82fe300c81a2dd37056256b4f3e4a561c2f43b38344c2b9704b20b0188f32 |
| CodeGuard-0.1.5-Portable-x64.exe | 110823100 | 6e7af20c85da70440eb5ade9e9d3f80654d15260833472d3f1e7aa986aab0155 |

另附 `CodeGuard-0.1.5-Setup-x64.exe.blockmap`、`latest.yml` 和 `SHA256SUMS-0.1.5.txt`，共 5 个资产。先创建草稿，逐一核对 GitHub 返回的 uploaded 状态、大小及 SHA-256 digest，再正式发布。发布后重新通过 GitHub API 核对全部资产、Latest 标记和标签提交；安装版与免安装版的公开下载 HEAD 均返回 200，Content-Length 与本地文件完全一致。

沿用本轮已通过的 126 项回归、完整桌面流程及更新界面验证。独立站点的真实客户端完整下载和 SHA-512 校验见更新票据。本轮 GitHub 下载验证为公开 HEAD 连通性、文件大小和 GitHub 服务端 SHA-256 元数据；未重复完整下载两个 GitHub EXE。当前发布包未配置代码签名，未覆盖实际用户安装目录。

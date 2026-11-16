# 03 — 更新 GitHub 0.1.4 免安装发布

**What to build:** 按用户授权，将分支功能与菜单优化后的免安装程序发布至 GitHub，并设为最新版，延续凭据脱敏检查。

**Blocked by:** 02-github-portable-release.md（done）。

**Status:** done

- [x] 实际 EXE 解包审计，核对版本、当前提交与构建一致。
- [x] 不上传本地配置、密钥、工作区记录及开发目录，凭据不输出或写入报告。
- [x] 上传免安装 EXE 和版本专属 SHA-256 清单，核对 GitHub 资产 digest，确认最新版标记。

## Verification

2026-11-14：发布 [v0.1.4](https://github.com/FrostRaven05/CodeGuard/releases/tag/v0.1.4)，目标为已推送的提交 `364876a2d4409ce660e7bd3b878ce2441c82b464`，正式发布且为 Latest。保留旧版 Release。

实际 EXE 嵌入的 Electron 模块与提交一致，前端与当前构建一致。检查 240 个 Git 历史 blob、4455 个 ASAR 文件、72 个运行时文件，无已知凭据精确匹配或异常本地目录。模式命中项与此前已人工核对的合成排除测试值一致，没有新增真实凭据命中。两份旧系统加密配置在当前环境无法解密，未做其中 key 的明文精确核对；确认配置密文未混入文件，不将审计表述为对所有密钥的绝对保证。

`CodeGuard-0.1.4-Portable-x64.exe` 为 110502221 bytes，SHA-256 `9359550f2d489feba17b3a60583ad3930b864f47f18f1791ee5c2ea324d1e1f4`，与 GitHub 返回的资产 digest 一致。另附 `SHA256SUMS-0.1.4.txt`。先上传草稿资产并验证，再正式发布。GitHub API 已核对非草稿、Latest 标签、正式资产下载地址、大小及哈希。

当前环境对 github.com 的直接下载 HEAD 检查遇到连接重置/连接超时，Node 和系统 curl 均未成功完成公开下载连通性检查；因此仅确认 GitHub API 的发布与资产完整性元数据，不声称本轮端到端下载测试通过。详细无密钥报告与公开发布元数据位于忽略的 `.local/release-audit-0.1.4/`。

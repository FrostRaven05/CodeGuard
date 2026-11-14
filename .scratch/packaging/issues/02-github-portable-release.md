# 02 — GitHub 免安装版发布与脱敏检查

**What to build:** 按用户授权，将 Windows x64 免安装版发布到现有 GitHub 仓库，发布前检查历史与实际二进制内容，避免带入开发环境配置和凭据。

**Blocked by:** 01-windows-release.md（done）。

**Status:** done

- [x] 检查当前源代码、可达提交历史及 EXE 实际嵌入内容，凭据不输出、不落盘。
- [x] 只上传免安装 EXE 和该文件的 SHA-256 校验清单。
- [x] 核对远端提交、资产大小及 GitHub 返回的 SHA-256；发布后匿名下载 HEAD 返回 200。

## Verification

2026-11-14：发布 [v0.1.2](https://github.com/FrostRaven05/CodeGuard/releases/tag/v0.1.2)，目标提交 `feec1f9fed11bc00dfc9c541a34f9364b68d7d86`，与远端 main 一致。实际 EXE 内 Electron 模块与提交内容一致，前端资源与当前构建一致。

扫描 237 个可达 Git blob、4455 个 ASAR 文件及 72 个运行时文件。未发现真实凭据特征，命中项为用于验证敏感内容排除的合成测试值；已核对其构造场景。可用环境凭据、GitHub 凭据及配置密文精确比对无匹配。两份历史系统加密配置在当前环境无法解密，因此未完成其中 key 的明文精确比对；不将此检查表述为对所有密钥的绝对保证。包内无 `.local`、`.git`、`.scratch`、测试、工作区记录或模型配置。未输出或持久化解密值、令牌、认证头。

发布文件 `CodeGuard-0.1.2-Portable-x64.exe`，110509663 bytes，SHA-256 `4f8f14473a49888a954d2d7d0df71e1cddba26acb5527d2e43523926731e617d`，GitHub 资产 digest 一致。另附 `SHA256SUMS-0.1.2.txt`，不包含其他版本或安装版。先准备草稿并上传、核对资产，再转为正式发布。正式 EXE 下载地址匿名 HEAD 返回 200，Content-Length 110509663。

详细脱敏报告与发布核对记录位于忽略的 `.local/release-audit/`，其中仅保留统计、位置、公开发布元数据，不含真实密钥。未改变仓库可见性、改写历史或上传本地配置；没有新增 Git 提交或推送源代码。

# CodeGuard 更新源

官网与静态更新源由 Nginx 提供，不需要公开的上传接口或额外数据库。正式地址 https://codereview.frostraven05.com，更新源 /updates/。安装版采用 electron-updater generic provider；启动 10 秒后及每 6 小时检查，下载与安装由用户发起，退出不自动安装。免安装版可检查版本，通过官网下载替换。

首次部署：先启用 nginx-http.conf，通过既有 webroot /var/www/letsencrypt 签发域名证书，再启用 nginx-https.conf。每次变更先 nginx -t，再 reload；不要替换其他网站配置。证书续期需在成功后 reload nginx。

当前服务器公共 443 由既有 SNI stream 路由接管，新域名转发到 127.0.0.1:8444。`configure-server.sh` 在上传配置并签发证书后添加该路由、检查 Nginx 配置并启用每日两次的证书续期 timer，修改前备份原配置。既有域名的路由保留。

发布步骤：

1. 更新 package.json 版本并运行 npm install --package-lock-only。
2. npm test、npm run package、npm run test:desktop；运行 npm --prefix website run build。
3. 上传官网到独立目录，检查后原子切换 /opt/codeguard/site 符号链接。
4. 将 release/ 中对应版本的 Setup EXE、Portable EXE、Setup EXE.blockmap、SHA256SUMS 上传至 /opt/codeguard/updates/，逐个核对 SHA-256。文件名带版本，保留已有版本。
5. 更新网站下载地址，最后才将 latest.yml 上传到临时文件并原子改名。清单中的每个资产都必须先可下载。回滚只需恢复之前的 latest.yml 和站点链接。
6. 从外部检查 /healthz、/updates/latest.yml、安装包 HEAD 与 Range（206）、校验文件及 TLS；以旧版本客户端验证更新发现、下载和安装。

使用 scripts/deploy-codeguard.py 可上传已构建的官网和版本资产、核对远端 SHA-256、最后发布清单；SSH 密码交互输入，不保存在项目里。服务器首次配置和证书签发独立完成。已发布版本不可覆盖，应使用新版本号。

本次验证的服务器 SSH 主机密钥 SHA-256 为 `MFnoReJTy8b5aCUbk/LpT1KJsW4kRy5EaBi+93jfzws`，传入 `--host-key-sha256`。例如 `python scripts/deploy-codeguard.py --release-dir release/updates-0.1.5 --host-key-sha256 MFnoReJTy8b5aCUbk/LpT1KJsW4kRy5EaBi+93jfzws`。服务器重建后需重新核实主机密钥。

0.1.4 及更早版本没有更新入口，需要手动下载一次新版。当前未配置 Windows 代码签名证书，安装包可能出现系统信誉提示；HTTPS 与清单的 SHA-512 用于下载完整性验证，不能替代发布者签名。

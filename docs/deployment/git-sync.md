# GitHub 同步方式

本机已配置两条远端；远端配置和 SSH 密钥属于本机，不包含在 Git 提交中。

- `origin`：SSH，`git@github-pgtd:liunoly-design/Personal_GTD.git`。
- `origin-https`：HTTPS，`https://github.com/liunoly-design/Personal_GTD.git`。

常用命令：

```bash
git push origin main
# SSH 不可用时，先确保 HTTPS 已配置凭据，再执行：
git push origin-https main
```

`github-pgtd` 是本机 `~/.ssh/config` 的专用别名，连接 `ssh.github.com:443`，使用 `~/.ssh/id_ed25519_github_pgtd`。公钥已由用户添加到 GitHub，认证账户已核对。私钥无口令，依靠本机账户及 0600 文件权限保护；可按需用 `ssh-keygen -p -f ~/.ssh/id_ed25519_github_pgtd` 加口令。

GitHub 22 端口此前不可连接，已验证 443 可达。主机 Ed25519 公钥按 [GitHub 公布的指纹](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints) 核对，严格主机检查保持启用。参见 [GitHub 的 SSH over 443 说明](https://docs.github.com/en/authentication/troubleshooting-ssh/using-ssh-over-the-https-port)。

HTTPS 地址保留作为备用；HTTPS 写入凭据仍需独立配置，SSH 成功不表示 HTTPS 也已认证。新机器需自行配置 SSH，不复制本机私钥到仓库。

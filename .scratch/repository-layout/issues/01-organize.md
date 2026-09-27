# 01：整理目录并同步全部提交

Status: ready-for-agent
State: done
Blocked by: 无
Spec: [规格](../spec.md)

- [x] 文档、部署脚本和配置分类迁移；插件与运行目录保留。
- [x] 更新 README 导航、实际运行状态、AGENTS 阅读路径、npm 命令及历史记录链接。
- [x] 保留此前未提交的共享运行层文档；运行状态以最新安装记录为准。
- [x] 按规范与需求顺序审查；本次无业务逻辑修改、无新增依赖。
- [x] npm run check；npm test：78/78。
- [x] npm run demo、demo:reminders、demo:recovery、demo:feishu 全部通过。
- [x] npm run plugin:validate：隔离 doctor 正常，插件 loaded，reply_dispatch 与 service 已注册。
- [x] 本地 Markdown 链接无断链；保留两处指向上级历史资料的外部链接。
- [x] deploy 全部 JS 语法及 build-apple.sh 的 sh -n 通过。
- [x] npm pack --dry-run --json：新目录文件齐全，无 runtime/凭据/日志。
- [x] 提交并普通推送全部本地提交，核对远端。

## Verification

目录整理无需重启已链接网关。本次未重新编译 Apple helper、未重复真实写入、未重跑付费模型验收。

## 同步结果

整理提交：521fa6a。普通 `git push origin main` 失败：HTTPS 无可用用户名/凭据（could not read Username）。本机未安装 gh；SSH agent 无身份且 GitHub 22 端口连接关闭。只读远端可访问，main 仍为 5fc44277b5f60ac4b444ffcdca5d2a31186c87f9。未强推、未改远端配置。

下一步：用户在本机完成 GitHub 写入认证后执行 `git push origin main`；核对远端 SHA，再将本任务设为 done。目录整理及检查均已完成，仅同步受阻。

后续解决：用户添加本机公钥后，SSH 443 认证成功，已将全部 15 个待推送提交普通推送至 origin/main（92f3ee8）。原认证阻塞解除，HTTPS 备用远端保留。

# 01：整理目录并同步全部提交

Status: ready-for-agent
State: in-progress
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
- [ ] 提交并普通推送全部本地提交，核对远端。

## Verification

目录整理无需重启已链接网关。本次未重新编译 Apple helper、未重复真实写入、未重跑付费模型验收。

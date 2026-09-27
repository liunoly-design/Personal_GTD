# 开启合成笔记的飞书验收入口
Status: ready-for-agent
State: in-progress

规格：[spec](../spec.md)。

- [x] 私有配置和现有双笔记绑定，备份及恢复路径
- [ ] 网关实际进程 Notes 原生标签只读预检
- [x] 网关重载与连接正常
- [ ] 用户真实飞书入站/回执及后续讨论确认闭环

## Verification

启动时模型额度44/45；未自行扩大预算。

已备份私有配置，初始化原先不存在的 `state/okr.sqlite`，仅复制真实绑定；无新增 Notes。临时 service-start 探针未出结果，移除并重载原插件；没有把 Codex 读回当作网关进程权限证据。

等待真实用户发送“讨论”。原测试预算44/45，扩大到55次的请求待回复；目前保持原值。此任务保持 in-progress，尚未完成真实闭环。

`openclaw channels status --probe --json`：Feishu configured=true、running=true、probe.ok=true。配置/文档变更执行 `git diff --check` 通过；没有新增业务代码，未重复消耗真实模型额度。顺序审查确认仅启用合成绑定，临时代码已恢复，真实端到端保持未勾选。

真实启动请求已接管并发送错误回执。系统日志确认网关 node 缺少辅助功能权限，详见 [权限修复](02-permission.md)。Notes 成功读回验收仍未完成；已打开系统设置并请求用户启用正确的 node。

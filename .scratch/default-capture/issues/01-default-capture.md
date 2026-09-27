# 01：默认收集与运行应用

Status: ready-for-agent
State: done
Blocked by: 无
Spec: [规格](../spec.md)

- [x] 默认收集与空内容提示。
- [x] TDD：新增默认收集测试修改前失败，修改后通过。
- [x] 更新历史行为测试和需求、README。
- [x] npm run check、npm test（78/78）、npm run demo:feishu（30 条事件及一次重投，20 条事项、30 条回执）、git diff --check 通过。
- [x] 顺序检查规范和需求；原文保留，分析只调用一次，无阻塞问题。
- [x] 运行网关重载及健康检查。

## Verification

本次未主动发送飞书消息、调用付费模型或写 Apple；真实新规则由用户下一条消息验收。

20:18 重载 launchd 服务 ai.openclaw.gateway；新进程 85332。启动期间首次健康检查 ECONNREFUSED；启动完成后 health ok=true，personal-gtd 已加载且无插件错误，飞书 running/connected=true、lifecycle=ready。

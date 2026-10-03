# F110/T01：移动单项到指定列表并核验

Feature: F110/T01
Status: ready-for-agent
State: in-progress
Blocked by: ../../f108-task-query/issues/05-reply-selection.md
基准：cde064361d0326e951f9df85f479a7bbe4e30adc。
Spec: [需求与验收基线](../../f108-task-query/maintenance-spec.md)

## What to build

配置账户内完整目标列表名解析真实ID，移动原事项并保留字段；不改默认收集绑定，不创建目标列表。

## Acceptance criteria

- [ ] 不存在/同名/不可写/无源目标授权不误选；读回真实ID、目标列表与保留字段一致。
- [ ] 先验证原地移动及ID/字段保留可行性；不以复制新事项替代；重投、未知结果、冲突和重启安全恢复。
- [ ] 规格的适用公开接口检查、演示、单agent顺序审查及文档状态完成，真实未测明确标记。

## Verification

本轮实现移动路径，基准2c1bf67；完整217/217测试、语法、Swift类型检查及合成demo:maintenance通过（5项、完成2项、移动1项、20ms、零重复写入/模型调用）。真实Apple合成写入与飞书闭环待验收，任务暂不关闭。详见[执行规格](../../f207-batch-maintenance/execution-spec.md)与[部署记录](../../../docs/deployment/f207-maintenance-2026-10-03.md)。

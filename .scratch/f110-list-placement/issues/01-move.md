# F110/T01：移动单项到指定列表并核验

Feature: F110/T01
Status: ready-for-agent
State: done
Blocked by: ../../f108-task-query/issues/05-reply-selection.md
基准：cde064361d0326e951f9df85f479a7bbe4e30adc。
Spec: [需求与验收基线](../../f108-task-query/maintenance-spec.md)

## What to build

配置账户内完整目标列表名解析真实ID，移动原事项并保留字段；不改默认收集绑定，不创建目标列表。

## Acceptance criteria

- [x] 不存在/同名/不可写/无源目标授权不误选；读回真实ID、目标列表与保留字段一致。
- [x] 先验证原地移动及ID/字段保留可行性；不以复制新事项替代；重投、未知结果、冲突和重启安全恢复。
- [x] 规格的适用公开接口检查、演示、单agent顺序审查及文档状态完成，真实未测明确标记。

## Verification

本轮实现移动路径，基准2c1bf67；完整217/217测试、语法、Swift类型检查及合成demo:maintenance通过（5项、完成2项、移动1项、20ms、零重复写入/模型调用）。真实Apple合成写入与飞书闭环待验收，任务暂不关闭。详见[执行规格](../../f207-batch-maintenance/execution-spec.md)与[部署记录](../../../docs/deployment/f207-maintenance-2026-10-03.md)。


2026-10-03 继续验收：用户在已提供专用合成验收范围后授权“继续验收”。运行 node deploy/verify-task-maintenance.js --allow-synthetic-writes，真实Apple创建专用两清单及5项，完整查询→计划→确认→两项完成/一项移动→读回通过；原ID及受核验内容指纹、默认绑定保留，业务写入3、重复写入0。专用数据清理成功；查询/执行/清理2476ms（不含fixture准备），modelCalls=0、realFeishuSends=0，消息入口为合成桥接。用户已反馈真实飞书查询/批量完成成功；真实飞书混合移动及真实拒绝/外部并发/超时恢复尚未逐场景实测，合成套件覆盖相应保护。实现及本项适用验收完成，State=done，不将整个0.2版本或所有故障场景标为已验收。

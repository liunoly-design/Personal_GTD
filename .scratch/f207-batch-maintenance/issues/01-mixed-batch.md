# F207/T01：完成与移动混合批量确认及恢复

Feature: F207/T01
Status: ready-for-agent
State: done
Blocked by: ../../f108-task-query/issues/05-reply-selection.md、../../f201-task-status/issues/01-complete.md、../../f110-list-placement/issues/01-move.md
基准：cde064361d0326e951f9df85f479a7bbe4e30adc。
Spec: [需求与验收基线](../../f108-task-query/maintenance-spec.md)

## What to build

回复原查询：完成第1/2项、移动第5项到Next，生成具体计划等待关联确认，再按稳定子操作执行；不纳入删除。

## Acceptance criteria

- [x] 确认前零写入；原用户/会话和计划版本匹配后完成两项移动一项；取消/旧确认/错用户无效。
- [x] 逐项读回；独立项部分成功分别回执，依赖失败停止；重启恢复只处理未完成项，未知结果先核对，不重放成功项。
- [x] 规格的适用公开接口检查、演示、单agent顺序审查及文档状态完成，真实未测明确标记。

## Verification

本轮实现混合批量路径，基准2c1bf67；完整217/217测试、语法、Swift类型检查及合成demo:maintenance通过（5项、完成2项、移动1项、20ms、零重复写入/模型调用）。真实Apple合成写入与飞书闭环待验收，任务暂不关闭。详见[执行规格](../../f207-batch-maintenance/execution-spec.md)与[部署记录](../../../docs/deployment/f207-maintenance-2026-10-03.md)。


用户反馈（2026-10-03）：“已经成功”。上一轮指引为查询Inbox→两项完成计划→确认执行，作为查询及批量完成路径的用户成功反馈；混合移动、ID/字段保留及真实部分失败/未知恢复仍待独立验收，State保持in-progress。


2026-10-03 继续验收：用户在已提供专用合成验收范围后授权“继续验收”。运行 node deploy/verify-task-maintenance.js --allow-synthetic-writes，真实Apple创建专用两清单及5项，完整查询→计划→确认→两项完成/一项移动→读回通过；原ID及受核验内容指纹、默认绑定保留，业务写入3、重复写入0。专用数据清理成功；查询/执行/清理2476ms（不含fixture准备），modelCalls=0、realFeishuSends=0，消息入口为合成桥接。用户已反馈真实飞书查询/批量完成成功；真实飞书混合移动及真实拒绝/外部并发/超时恢复尚未逐场景实测，合成套件覆盖相应保护。实现及本项适用验收完成，State=done，不将整个0.2版本或所有故障场景标为已验收。

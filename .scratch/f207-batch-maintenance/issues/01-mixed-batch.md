# F207/T01：完成与移动混合批量确认及恢复

Feature: F207/T01
Status: ready-for-agent
State: open
Blocked by: ../../f108-task-query/issues/05-reply-selection.md、../../f201-task-status/issues/01-complete.md、../../f110-list-placement/issues/01-move.md
基准：cde064361d0326e951f9df85f479a7bbe4e30adc。
Spec: [需求与验收基线](../../f108-task-query/maintenance-spec.md)

## What to build

回复原查询：完成第1/2项、移动第5项到Next，生成具体计划等待关联确认，再按稳定子操作执行；不纳入删除。

## Acceptance criteria

- [ ] 确认前零写入；原用户/会话和计划版本匹配后完成两项移动一项；取消/旧确认/错用户无效。
- [ ] 逐项读回；独立项部分成功分别回执，依赖失败停止；重启恢复只处理未完成项，未知结果先核对，不重放成功项。
- [ ] 规格的适用公开接口检查、演示、单agent顺序审查及文档状态完成，真实未测明确标记。

## Verification

仅登记任务，未实现、未运行本任务业务测试、未部署；不能以现有查询测试代替验收。

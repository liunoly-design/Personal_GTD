# F201/T01：完成单项任务并核验

Feature: F201/T01
Status: ready-for-agent
State: open
Blocked by: ../../f108-task-query/issues/05-reply-selection.md
基准：cde064361d0326e951f9df85f479a7bbe4e30adc。
Spec: [需求与验收基线](../../f108-task-query/maintenance-spec.md)

## What to build

明确且已授权的唯一事项按真实ID标记完成，读回事实；已完成幂等，无重开/删除。

## Acceptance criteria

- [ ] 真实ID与完成状态读回一致，其他字段不变；对象/授权/基线失败准确说明。
- [ ] 未知写入先核对；重投/重启/回执失败不重复写入；合成TDD及授权真实合成写入单独验收。
- [ ] 规格的适用公开接口检查、演示、单agent顺序审查及文档状态完成，真实未测明确标记。

## Verification

仅登记任务，未实现、未运行本任务业务测试、未部署；不能以现有查询测试代替验收。

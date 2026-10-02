# F108/T07：全部列表查询范围待细化

Feature: F108/T07
Status: needs-info
State: open
Blocked by: None（规格细化）；实现依赖已完成T04
基准：cde064361d0326e951f9df85f479a7bbe4e30adc。
Spec: [需求与验收基线](../maintenance-spec.md)

## What to build

登记用户关于查询特定或全部列表的提问；特定列表已交付，全部范围未确认、未实现。

## Acceptance criteria

- [ ] 明确当前账户全部列表/用户指定集合、共享或不可写列表、完成状态与读取授权；不自动扩成所有账户。
- [ ] 跨列表结果注明来源、编号及真实ID；稳定分页/容量/部分读取失败不伪造完整结果，成本性能预算写入独立spec。
- [ ] 规格的适用公开接口检查、演示、单agent顺序审查及文档状态完成，真实未测明确标记。

## Verification

仅登记任务，未实现、未运行本任务业务测试、未部署；不能以现有查询测试代替验收。

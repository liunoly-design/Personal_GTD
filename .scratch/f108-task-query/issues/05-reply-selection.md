# F108/T05：可信回复与查询编号定位

Feature: F108/T05
Status: ready-for-agent
State: open
Blocked by: 01-minimal-query.md、02-helper-path.md、03-readable-receipt.md、04-explicit-list.md（均done）
基准：cde064361d0326e951f9df85f479a7bbe4e30adc。
Spec: [需求与验收基线](../maintenance-spec.md)

## What to build

持久化机器人回执ID与查询快照关联；可信无前缀回复按展示编号解析真实对象，进入已登记维护能力；未实现动作准确说明。

## Acceptance criteria

- [ ] 分页编号及旧回执绑定原对象；同名标题不误选；重启关联保留。
- [ ] 错误用户/会话/引用、越界编号、失效对象与外部冲突不写入、不收集、不落普通助手猜测执行。
- [ ] 规格的适用公开接口检查、演示、单agent顺序审查及文档状态完成，真实未测明确标记。

## Verification

仅登记任务，未实现、未运行本任务业务测试、未部署；不能以现有查询测试代替验收。

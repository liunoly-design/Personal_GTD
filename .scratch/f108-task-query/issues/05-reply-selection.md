# F108/T05：可信回复与查询编号定位

Feature: F108/T05
Status: ready-for-agent
State: done
Blocked by: 01-minimal-query.md、02-helper-path.md、03-readable-receipt.md、04-explicit-list.md（均done）
实施基准：8c5c4e5dca24b5bbd41e7aed6d8f6445fac17a6e；初始需求基准cde064361d0326e951f9df85f479a7bbe4e30adc。
Spec: [本项规格](../selection-spec.md)；[需求基线](../maintenance-spec.md)

## What to build

持久化机器人回执ID与查询快照关联；可信无前缀回复按展示编号解析真实对象，进入已登记维护能力；未实现动作准确说明。

## Acceptance criteria

- [x] 分页编号及旧回执绑定原对象；同名标题不误选；重启关联保留。
- [x] 错误用户/会话/引用、越界编号、失效对象与外部冲突不写入、不收集、不落普通助手猜测执行。
- [x] 规格的适用公开接口检查、演示、单agent顺序审查及文档状态完成，真实未测明确标记。

## Verification

已完成本项定位能力，不包含完成/移动/批量业务写入。详细证据见下方。

### TDD及公开接口

- 原可信编号维护回复先失败not_handled，定位模块/回执快照/只读核对接入后通过。
- Apple公开readTasks先失败not a function，新增配置source内按ID只读批量核对后通过，不记为可写PGTD对象。
- 回复选择回执被错当查询回执先失败tasks_selected，显式queryEventId/旧回执原事件识别后通过。
- 尾随分隔符语法先失败被接受，严格完整表达后通过。
- 显式收集回复被错误拦截先失败task_selection_invalid，缩小编号候选及尊重明确入口后通过。
- 无关联编号消息先失败not_handled，可信编号候选由插件接管并要求查询后通过。
- 其余身份、分页、重投、重启、编辑/完成/移动冲突、读取失败/超时/外部回执未知与10项限额为公开seam回归检查，不声称均经过失败阶段。

### 验证

完整npm test：199/199；npm run check、swiftc -typecheck native/reminders.swift、git diff --check通过。npm run demo:query：6合成项、5未完成、2页、选中1项、5回执、20ms；维护执行false，查询写入/模型调用/真实Apple读取/真实飞书发送0，非生产性能指标。公开插件hook与真实capture合成集成验证handled=true、无宿主最终回答、无模型调用。

真实新版helper默认授权列表queryTasks→readTasks核对同一真实ID，revision一致，tasks_selected；运行配置字节未变，未输出私人标题/ID，未修改Apple事项。人工/非默认只读核对为合成桥接证据，不能替代真实完整验收。详见[部署记录](../../../docs/deployment/f108-reply-selection-2026-10-03.md)。

### 单agent顺序审查

按本地code-review与AGENTS适配，基准8c5c4e5，含全部本任务未提交差异。规范：业务定位模块独立，无新增npm依赖；CryptoKit系统框架只用于指纹；真实ID/source/list、队列/输入/读限额和超时由代码控制，无业务写入权限扩大。需求：原回执绝对编号、不用标题猜测、旧无基线重查、错误身份不泄漏、维护缺口不冒充确认计划、恢复复用快照。发现回执身份继承、显式收集拦截并以红绿测试修复，无剩余阻塞发现。

真实新飞书“查询→回复选择”闭环仍待用户新消息验收；旧失败/旧无revision回执不重放变成功。下一任务F201/T01单项完成；F110/T01移动及F207/T01混合批量仍open。本任务done是代码/合成及授权只读交付完成，不表示0.2.0整版发布或维护写入验收。

最终审查补充：同消息ID更换原始parent_id可因根ID相同而错误复用定位结果，公开测试先失败tasks_selected、增加providerReplyTo一致性检查后通过event_conflict。仓库与部署快照最终199/199、语法通过；将最后补丁覆盖发布快照并再次重启，不改helper或绑定。

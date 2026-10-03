# F201/T01：完成单项任务并核验

Feature: F201/T01
Status: ready-for-agent
State: done
Blocked by: ../../f108-task-query/issues/05-reply-selection.md
实施基准：6e01a746512f6fc0d26d27a73ea1cff6488189c8；初始需求基准cde064361d0326e951f9df85f479a7bbe4e30adc。
Spec: [单项规格](../spec.md)；[需求基线](../../f108-task-query/maintenance-spec.md)

## What to build

明确且已授权的唯一事项按真实ID标记完成，读回事实；已完成幂等，无重开/删除。

## Acceptance criteria

- [x] 真实ID与完成状态读回一致，其他字段不变；对象/授权/基线失败准确说明。
- [x] 未知写入先核对；重投/重启/回执失败不重复写入；合成TDD及授权真实合成写入单独验收。
- [x] 规格的适用公开接口检查、演示、单agent顺序审查及文档状态完成，真实未测明确标记。

## Verification

已完成本项代码、合成测试与部署；真实完成写入和飞书闭环待用户主动测试。不含移动或批量完成。

### TDD与公开接口

可信单项完成先失败task_selection_unavailable，实现预读、稳定ID写入意图、读回核验后通过；Apple公开completeTask先失败not a function，新增真实ID/字段指纹/操作ID桥接后通过。审查发现未知操作可换新消息重写，先失败writes=2、增加事项级未决保护后通过writes=1。未支持“把第1项标记完成”被默认收集，先失败collected、增加保守候选接管后通过task_selection_invalid。其余响应丢失、核对失败、重投/重启、权限拒绝、外部编辑、批量零写入、回执丢失及撤权为公开seam回归检查，不声称每项经历RED。

### 验收证据及限制

仓库最终npm test：207/207，npm run check、swiftc -typecheck native/reminders.swift、git diff --check通过。npm run demo:complete：1个合成事项完成、businessWrites=1、duplicateWrites=0、4回执、17ms，模型/真实Apple写入/真实飞书发送0；非生产指标。demo:query旧路径6项/5未完成/2页仍通过，未实现的移动不执行。

Swift新增完成命令：在配置source及真实list/item内、可写且指纹匹配时只设置isCompleted。新增fieldsRevision保护状态外已接入字段，完成动作不把人工事项加入旧提醒写入索引。write_started日志先于外部写入，未知仅核对；同事件重投及新事件均不能绕过未决保护。恢复至多10项，每事件一次读，不因撤权继续读取。

新版helper编译/签名，真实仅读取已授权默认列表queryTasks→readTasks，revision与fieldsRevision均匹配、配置字节不变。没有真实完成业务写入/代发飞书消息。真实授权合成写入、飞书用户新完成回执、EventKit多设备并发/隐藏字段及大容量未验收，后续用户主动测试另记，不以模拟通过替代。

### 顺序审查及交付

按本地code-review/AGENTS单agent规范、需求顺序审查，基准6e01a74含本任务未提交差异。规范：无新npm依赖，完成动作与飞书/Apple接入分离，权限/对象/限额/核对由代码控制，无删除/重开/移动扩展。需求：唯一明确单项直接执行；已完成只报告事实；混合/多个完成零业务写入；未知不得说未执行或盲重试。已处理上述两项阻塞发现，无剩余阻塞发现。

用户最新要求：每次开发交付提供测试语句；关联度低可新session。当前衔接F108/T05，保留当前session。测试：在配置账户手动建“PGTD测试”列表，只放一项测试任务；发送“小婕 gtd 查询 PGTD测试 里面的任务”，回复新回执“第1项完成”。预期“已完成并核验”，Apple勾选完成；再次查询未完成为空。旧回执缺fieldsRevision须重查。本任务代码done，不关闭0.2.0整版真实验收；下一项F110/T01单项移动。

# F108/T05：可信回执回复与编号定位

Feature: F108/T05
Version: 0.2.0（目标，尚未发布）
Status: ready-for-agent
State: done
基准：8c5c4e5dca24b5bbd41e7aed6d8f6445fac17a6e；日期2026-10-03。
上位：[维护需求](maintenance-spec.md)。本次仅交付定位与只读核对，不实现完成、移动或混合批量确认/写入。

## 目标与范围

可信飞书用户回复PGTD任务查询回执，用“选择第1项”“第1,2项”“帮我确认第1,2项都完成，第5项移动到next清单”等明确表达定位原回执中的真实事项。无须重复激活前缀；有前缀同样支持。原机器人回执消息ID关联原查询快照/用户/会话，展示编号按原页偏移固定。只支持完整规则表达，不调用模型补猜动作。

维护请求可解析完成、移动意图，但返回已定位、维护尚未实现/未执行；不得显示待确认可执行计划或请求用户确认未实现动作。“确认”本轮不提供执行能力；选择只是只读操作。

## 接口与数据

公开seams沿用openFeishuCapture.handle/recover、Apple adapter、Swift JSON bridge。查询结构items新增可选revision，不显示用户；新queryTasks与新native/helper提供revision。revision是只读字段快照指纹，native包含任务正文、状态与修改时间，私人正文仍不返回。旧持久查询缺revision时提示重新查询，不为旧对象补造基线。

新增公开reminders.readTasks({items:[{id,listId}]})：配置source内按真实ID只读查询最多10项，人工创建事项也可读，不要求PGTD marker、可写权限或默认绑定。返回items逐项state=ok/value或unavailable；值含sourceId/listId/id/title/completed/revision。不得remember成可写PGTD对象、改binding、写外部数据。native对应readTasks，JS输入限额及Swift再次校验。

本项输出task_selected或task_selection_unavailable（已定位，维护能力缺失）、task_selection_needs_query/invalid/conflict/failed/forbidden，结构selected保留number/action/targetListName和真实引用。回执只显示编号、名称、目标及明确未执行，不展示技术ID。

## 可信关联与失败

原消息API验证sender、chat、type、内容及parent_id；不信任上下文伪造引用。只有机器人查询回执可定位，用户原查询消息、收集回执、缺关联、错误用户/会话、未知引用不推测最近查询，不默认收集。回复带编号但引用不合法也由插件准确说明缺口，防止普通助手猜测执行；非编号回复不扩大接管范围。

按原页绝对编号选中；最多10个动作，重复编号/冲突动作、0/负数/越界、额外语句、否定/引用、未支持动作不执行也不收集。列表名称完整解析，最多200字符；不把移动目标理解为默认收集绑定。模型调用0。

定位后一次readTasks批量读取，仅核实所选真实ID，不扫描其他私人列表。缺对象、source/list不符、revision或当前状态不符报告冲突/重新查询；失败/权限/超时分别说明，不返回成功空结果。旧快照无revision不读也不假装核对过。相同事件重投/重启复用首次定位结果；新事件重新核对，回执失败恢复仅送回执，不重新读取。读取与保存之间无法阻止外部变化，不作为未来写入锁；后续写入必须再次预读核验。

## 预算与验收

每事件最多10项、一次readTasks；timeout沿用queryTimeoutMs<=20秒，输入沿用8000字符，队列16与事件1000上限不变。无模型调用/费用，性能目标待测；合成样本五项选择三项，另测跨页及10项边界。所有选择不写Apple，不代发真实消息、不新增定时任务。

- [x] 合成可信查询→机器人回执→无前缀1/2/5定位，同名标题不同ID，当前排序变化仍按原回执。
- [x] 翻页绝对编号、新查询后回复旧回执、重启关联/重投快照保留，回复未知结果不重读。
- [x] 错误身份/会话、ctx与API引用差异、非机器人查询回执、缺/错编号、旧无revision、否定复合歧义不误收集。
- [x] 人工事项/非默认列表readonly桥接可读；source外、对象缺失/移动/编辑/完成冲突与读取失败、超时分类。
- [x] 当前缺失的完成/移动/批量接口由插件准确回执未执行；后续任务依赖保留，不提前关闭。
- [x] 逐项TDD、受影响与完整检查、合成运行演示、Swift类型检查、单agent规范/需求顺序审查，README及真实限制记录。

## Verification

代码、合成与已授权默认列表只读核对完成，详见[T05任务](issues/05-reply-selection.md)与[部署记录](../../docs/deployment/f108-reply-selection-2026-10-03.md)。199/199完整测试通过；语法、Swift类型检查、demo及差异检查通过。真实跨列表/人工事项、权限拒绝/冲突/大容量未实测，合成覆盖和真实限制区分。真实飞书新回复闭环待用户验收，不读取Waiting私人正文。

# F207/T01 混合批量维护及F110移动依赖

2026-10-03，基准2c1bf67。用户要求多任务确认完成和移动，本切片包含移动接入依赖。不重放用户历史请求，不含删除/重开/跨账户/创建目标清单。

实现新查询→自然编号请求→具体计划→回复确认/取消→逐项执行读回。新提案替代同查询旧待执行计划；确认重投、部分成功与未知恢复不重复写入。单项移动也先确认，原单项完成保留直接执行。默认绑定不变；未知项跨新消息保护。

公开接口TDD先复现缺功能，再完成回归；完整217/217、npm run check、两个Swift类型检查通过。demo:maintenance五项三动作，完成2、移动1、20ms，businessWrites=3、duplicateWrites/modelCalls/realAppleWrites/realFeishuSends=0。原查询和单项完成模拟演示保留通过。

单agent顺序规范审查：身份/账户范围、真实ID、持久写前意图及未知只核对保留，确认不拦截原链接确认，计划中的不支持语句不默认收集；无阻塞发现。需求审查：批量零确认写入、计划关联/版本替代、取消、全体预检、逐项失败/未知/恢复、原地目标幂等与字段读回均有合成证据。原地移动真实ID稳定性待单独授权验证，因此F110与F207暂不关闭。

可保留内容指纹包含标题/备注/URL/优先级/时间/普通闹钟/状态；复发及位置提醒暂时阻塞，不静默丢失或复制。Apple本地ID完整同步可能失效，无法读回即未知；依据[Apple标识文档](https://developer.apple.com/documentation/eventkit/ekcalendaritem/calendaritemidentifier)。原地保存依据[Apple保存提醒](https://developer.apple.com/documentation/eventkit/creating-events-and-reminders)，文档不代替本机ID验收。Apple字段读取与写入非原子、批量非事务，外部并发可能产生逐项冲突。

用户测试：回复新的测试清单查询回执“第一第二项完成，第五项移动到Next清单”，先应看到计划且Apple未变；回复计划“确认执行”，预期逐项完成2项移动1项并核验。也可回复“取消”检查零写入。真实Feishu发送0；飞书闭环待用户执行。

独立快照 `/Users/mac/.openclaw/personal-gtd/releases/f207-maintenance-20261003`，最终快照217项及语法检查通过，PGTD source已确认指向该快照、origin=config、loaded。native helper沿用原签名标识编译并替换，旧helper、host/runtime配置保存在私有忽略目录runtime/feishu/batch-backup-20261003。未改变其他插件、默认绑定或预算配置。已准备需授权的合成验收脚本及专用fixture helper；本次尚未调用真实写入验收。任务状态in-progress保留真实验收缺口。

最终网关running（PID41496）、RPC ok=true，PGTD loaded且source指向maintenance快照，飞书default running=true/probe.ok=true/lastError=null。连接健康不代表真实Apple业务验收。代码提交后用户仍未选择真实合成写入授权，本次未执行验收脚本。

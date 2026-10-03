# F108/T09 清单查询简写与能力提示

Feature: F108/T09
Status: ready-for-agent
State: done
Blocked by: F108/T04、F207/T01代码交付
基准00a4713；2026-10-03。

用户截图“查询 inbox 任务”被拒绝，且帮助仍显示移动/批量未实现。新增“查询 <单段完整清单名> 任务/事项/待办”简写，只做配置账户内完整名称查找；含空格的名称仍使用完整列表/里面语法。未找到、同名等沿用原只读失败语义，不把它扩展为关键词/日期/全列表查询。更新不支持表达的帮助，反映已实现的计划确认流程。旧消息缓存不升级为新写入请求。

公开测试接口openFeishuCapture.handle；新增截图回归先RED，再GREEN，完整218/218及npm run check通过。无模型调用，无Apple业务写入，无真实Feishu发送。规范/需求顺序审查：完整名称/读取范围与原保护保留，提示与现有能力一致，无阻塞发现。真实新语句及批量确认由用户验收，原F110/F207真实验收状态不改变。

用户测试：新消息“小婕 gtd 查询 inbox 任务”；回复新查询回执“第一第二项完成”，应生成计划，再回复计划“确认执行”后逐项执行核验。目标须至少有两项且由用户选择确认。截图旧“已定位”不等于完成。

已部署快照 `/Users/mac/.openclaw/personal-gtd/releases/f108-list-shorthand-20261003`；快照218项及语法检查通过。PGTD loaded/source指向该快照，网关running/RPC ok，飞书running/probe ok。私有host备份位于runtime/feishu/shorthand-backup-20261003；helper、绑定与其他插件不变。真实新语句闭环待用户反馈。

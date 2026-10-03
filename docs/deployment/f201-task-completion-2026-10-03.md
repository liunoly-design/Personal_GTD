# F201/T01 单项完成部署记录

日期2026-10-03，基准6e01a74。用户要求继续下一项开发测试，并要求每次交付给测试语句。沿用既有部署/默认列表只读授权，不重放旧完成请求，不以开发授权修改Waiting私人事项。

实现：可信回复新查询回执“第1项完成”，按真实ID预读核对，在可写源列表中更新原任务完成状态并读回。已完成状态幂等；完成、未完成字段指纹分开，ID/列表及接入字段吻合才报成功。外部响应丢失或超时的未知结果持久化，只读核对，不重写；同一事项未决保护不能换新消息绕过。多个完成或完成/移动混合仍未实现，零部分执行。未支持维护措辞不默认收集。

仓库最终207/207测试、语法与Swift类型检查通过。模拟demo:complete一项完成、仅一次业务写入、零重复写入、4回执、17ms；modelCalls/realAppleWrites/realFeishuSends均0。查询模拟旧路径仍通过。单agent顺序规范/需求审查发现未知操作新消息绕过及不支持语句误收集，均RED/GREEN修复。

独立快照 `/Users/mac/.openclaw/personal-gtd/releases/f201-complete-20261003`；私有备份 `runtime/feishu/f201-backup-20261003/`，目录0700、配置0600、原helper0700。Swift沿用identifier编译签名并原子替换helper。host仅切换PGTD路径，runtime配置字节不变，收集绑定及预算不改。运行DB、私人标题/ID与凭据不提交。

真实默认授权列表只读queryTasks→readTasks验证revision、fieldsRevision一致，未发生Apple业务写入、飞书代发或付费模型调用。真实完成写入、非默认人工事项/隐藏字段保留、并发冲突及飞书完成闭环待用户测试；EventKit非原子条件写入限制保留，不声称跨设备锁。

用户测试：在已配置账户的Apple提醒事项建“PGTD测试”列表，仅放一项测试任务。发送“小婕 gtd 查询 PGTD测试 里面的任务”，回复机器人新回执“第1项完成”。预期“已完成并核验”，Apple中勾选完成；再次查询未完成为空。操作对象为用户主动选择的测试项，旧回执缺完成指纹时需重新查询。若结果未知，保留原消息并先核对，不换消息重试。

下一项F110/T01单项移动；混合批量F207/T01随后独立开发。当前包版本仍0.1.0，0.2.0是目标，不因本切片交付宣称整版完成。

最终快照207/207与语法通过；Swift类型检查通过。网关重启restarted，running（PID22199）、RPC ok=true，PGTD loaded且source为上述complete快照；飞书default running=true/probe.ok=true/lastError=null。连接探针不替代用户真实完成闭环。

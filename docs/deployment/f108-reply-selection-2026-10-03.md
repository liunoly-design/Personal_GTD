# F108/T05 编号回复定位部署记录

日期2026-10-03，基准8c5c4e5。用户授权继续下一项开发及测试，沿用本会话已有部署/默认列表只读授权。任务见[T05](../../.scratch/f108-task-query/issues/05-reply-selection.md)，本轮不修改私人任务，不代发真实飞书消息。

## 实现与验证

机器人查询回执持久关联原查询快照，可信无前缀回复按绝对显示编号定位真实ID。新查询带只读revision，最多10项一次readTasks核对；人工事项不要求PGTD marker，不将读取对象加入原可写事项索引。旧无基线回执需重新查询；状态/列表/字段变更拒绝沿用旧选择。缓存定位结果及回执恢复，不重读或新增业务写入。完成、移动、混合执行尚未实现，插件准确提示缺口。

仓库199/199测试、语法与Swift类型检查通过；模拟demo：6合成对象、5未完成、2页、1选中引用、5回执、20ms，维护执行false，真实Apple/飞书/模型调用为0。公开插件hook合成验证接管回复，不落宿主普通回答。身份/分页/重复编号/非法复合/10项限额/冲突/失败/超时/重投/重启/外部回执未知保持只读。

## 快照、备份与真实核对

发布快照 `/Users/mac/.openclaw/personal-gtd/releases/f108-selection-20261003`。私有备份 `runtime/feishu/selection-backup-20261003/`：host/runtime配置0600、原helper0700、目录0700。原identifier重新编译签名并原子替换helper；host仅切换PGTD路径，runtime配置字节不变、原绑定不改。未提交运行DB、私人ID/标题或凭据。

真实验证仅读取已授权默认列表，新helper的queryTasks→readTasks核对一个真实对象，同一ID/列表、revision一致、tasks_selected。没有修改Apple事项、读取Waiting私人正文、发送飞书或付费模型调用。跨列表人工事项为合成边界验证，真实权限失败/冲突、iCloud并发/大容量与长期性能未测。

真实用户新查询后回复“选择第1项”的飞书闭环待验收；旧查询回执无revision时会提示重查。本任务交付不表示0.2.0维护整版已发布。下一项F201/T01单项完成，移动及混合批量后续分别开发。

最终引用一致性补丁：原始provider parent_id纳入同事件冲突检查，不能借同一查询根ID改换引用并复用成功结果。公开用例先失败后修复；仓库与发布快照最终199/199、语法通过。再次重启后复查连接，用户新消息闭环仍待验收。

最终连接证据：gateway restart返回restarted；running（PID1862），RPC ok=true（connected_no_operator_scope不代表完整operator权限）；PGTD loaded且source为selection快照；飞书default running=true、probe.ok=true、lastError=null。92个本地文档链接及工作树/暂存diff检查通过。

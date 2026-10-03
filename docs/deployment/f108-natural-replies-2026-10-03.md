# F108/T08 自然编号修复交付

2026-10-03，基准28f5673。修复截图自然表达识别及新版澄清提示丢失查询关联，不实现批量完成。旧错误提示可能需重新查询。

公开入口回归先RED（两项失败），GREEN后完整210/210通过；npm run check、demo:query、demo:complete通过。合成demo:complete 18ms，单项业务写入1、重复写入0、模型调用0；demo:query 21ms。真实Apple写入、飞书发送0，连接探针不替代用户闭环。Swift及Apple接入本次未改。

单agent顺序审查规范：真实ID/授权与原状态核对保留，只有两类可信澄清提示继承查询，业务源码与持久化数据不混提交。需求：截图两种语句可识别，单项完成可用，批量准确说明，越权/重复/否定/额外动作/错页保护保留；无阻塞发现。

用户验收：新查询测试清单后回复“第一项标记完成”，预期完成并核验；两项回复“第一第二任务标记完成”应定位并提示批量未实现。真实飞书与Apple写入验收待用户执行。下一开发项F110/T01单项移动；批量由F207/T01独立交付。

已授权部署独立快照 `/Users/mac/.openclaw/personal-gtd/releases/f108-natural-replies-20261003`，快照210项及语法检查通过。host仅修改PGTD加载路径；发现单文件路径未选中快照，改为含manifest的快照根目录后，plugins inspect确认personal-gtd为config来源、loaded，source指向新快照。私有配置备份位于忽略目录runtime/feishu/natural-replies-backup-20261003（0700，文件0600）；默认绑定及helper不变。旧快照可恢复。

最终网关running（PID34647）、RPC ok=true，飞书default running=true、probe.ok=true、lastError=null；真实编号回复/Apple完成写入闭环待用户执行上述测试。

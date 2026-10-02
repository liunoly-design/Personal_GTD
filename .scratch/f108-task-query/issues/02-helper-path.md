# F108/T02：插件复制后Apple helper路径修复

Feature: F108/T02
Status: ready-for-agent
State: done
Blocked by: None
基准：8064952b56e8f26eaac43842a45adb14cd401e89。

## 目标与范围

用户飞书查询返回query_failed/READ_FAILED；修复已授权Inbox查询的运行故障，不扩大业务范围。OpenClaw复制插件目录不包含runtime/helper，模块相对路径指向临时副本不存在文件。私有配置增加remindersHelperPath绝对路径，OpenClaw启动先校验，adapter/callApple支持显式路径；CLI默认路径兼容。沿用真实source/list ID、权限、去重和现有失败消息快照，不重放或发送飞书，不调用模型、不写Apple。

## 公开测试与验收

- [x] 缺helper的复制模块目录，用显式绝对helper启动外部合成进程并读回真实合成引用；红绿循环。
- [x] openRuntime缺失/相对路径在凭据准备前拒绝；真实运行时接口使用合成Feishu及helper完成查询，不调用付费模型。
- [x] 179项完整测试与语法检查通过，规范/需求顺序审查。
- [x] 实际网关复制加载路径通过只读诊断；移除全部临时诊断并部署最终版本。
- [x] 文档、配置、验证脚本、证据更新，仅提交本任务文件，无推送。

## Verification

本地、launchd一次性进程与直接jiti加载均不能复现，均读取7条；一次性launchctl诊断已移除。实际网关临时service.start只读诊断稳定返回Apple bridge unavailable/query_failed。进一步只记录spawn路径及系统码，证实插件临时capture目录runtime/bin/pgtd-reminders缺失（ENOENT），不是列表或权限拒绝。未输出私人标题、异常私人正文或凭据。

`node --test --test-name-pattern='插件复制目录' test/apple.test.js`先失败Apple bridge unavailable，修复后通过。缺绝对helper运行时配置的公开检查先未按预期拒绝，添加启动校验后通过；新增运行时合成集成用外部helper、合成Feishu HTTP完成tasks_found/sent。完整179/179通过，语法通过。

顺序规范审查：路径来自私有配置而非消息，启动校验绝对路径；未增加依赖或权限，原子部署且保留绑定/预算/事件状态，外部进程行为通过公开测试验证。顺序需求审查：人工任务/只读范围及查询去重不改变，原失败ID继续复用，新消息重新查询；未将裸CLI成功替代真实宿主验证。


## 修复部署与真实反馈循环

新快照`/Users/mac/.openclaw/personal-gtd/releases/f108-helper-fix-20261002`以基准8064952及本任务明确文件创建，未包含用户需求修改。独立快照179/179、语法通过。原私有配置和宿主配置备份在Git忽略目录`runtime/feishu/f108-helper-fix-backup-20261002/`；私有配置仅新增remindersHelperPath（已有runtime/bin/pgtd-reminders绝对路径），宿主仅换PGTD快照路径，原白名单、绑定、预算与其他插件不变。未重新编译或变更helper权限。

真实网关同一service.start只读诊断由Apple bridge unavailable/ENOENT/query_failed转为tasks_found、total=7。没有回执发送、业务写入或模型调用。随后恢复clean index并再次重启；源码扫描`[DEBUG-f108`在仓库及新旧快照均无匹配。launchctl一次性诊断已remove，/tmp复现脚本删除，私有诊断备份归档到上述backup/diagnostics。

真实用户入站失败已复现并定位；修复后的真实宿主只读成功。用户新消息→回执仍待其发送验收，不伪造闭环成功，不重放原消息或篡改缓存。旧失败事件继续复用旧结果。下一步发送一条新“小婕 gtd 查询任务”，核对真实范围/事项引用。

本地提交仅本任务文件，不推送。完整记录见[部署续记](../../../docs/deployment/f108-task-query-2026-10-02.md)。

最终clean部署检查：网关running（PID67731）、RPC ok=true/connected_no_operator_scope；PGTD source为修复快照、loaded、reply_dispatch priority100；飞书default running=true/probe.ok=true/lastError=null。逐字段核对私有配置仅增加helper路径，宿主配置仅替换PGTD路径。

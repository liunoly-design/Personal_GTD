# F108/T04：指定列表查询

Feature: F108/T04
Status: ready-for-agent
State: done
Blocked by: None
基准：0660406dd058b5ba6bd0fb3b0380c70f3edf4b45。
Spec: [指定列表规格](../explicit-list-spec.md)

## Acceptance criteria

- [x] 规格验收项通过；仅扩展用户明确请求的列表查询，不改收集绑定。
- [x] TDD、完整检查、模拟演示、顺序审查和部署证据完成。
- [x] 真实Apple/飞书及未测边界区分；只提交本任务文件，不推送。

## Verification

仓库与独立发布快照 `npm test`：185/185通过；`npm run check`、`swiftc -typecheck native/reminders.swift`、`git diff --check`通过。`npm run demo:query`：6项合成任务、5项未完成、2页、指定列表1项，查询写入/模型调用/真实飞书发送均为0。

TDD先复现指定列表被拒绝、公开Apple桥接带默认ID、名称含引号符号时下一页失去范围，再分别修复通过。顺序规范/需求审查发现最后一项并修复，其余无阻塞发现。合成helper桥接验证不替代真实Swift重复名/大容量/权限失败验收。

新版Swift编译与原identifier签名成功，原helper及私有配置已备份。真实只读验证仅针对已授权原绑定列表：按名称返回相同真实列表ID；合成不存在名称返回list_not_found；私有运行配置字节不变。未读取其他私人列表、未修改Apple事项或默认绑定。新发布路径及连接检查见部署记录；指定其他列表的新飞书消息闭环仍待用户验证。


## 自然表达修复（2026-10-03）

用户新消息“查询 waiting 里面的任务”被语法遗漏拒绝。沿用既有可信飞书入口seam，先复现gtd_unsupported，再新增不带引号的“名称里的/里面的/中的任务”及“名称列表里面的任务”；仍按完整名称和配置账户解析。更新过时的仅Inbox能力提示。合成测试186/186、语法检查通过；默认绑定/无模型/无写入及附加筛选守卫保持。顺序规范/需求审查无阻塞发现。基准a062826；独立快照f108-natural-list-20261003，host配置私有备份natural-list-backup-20261003，helper与运行绑定未改。新消息飞书闭环待用户验收，不重放旧失败。


## 用户新飞书验收（2026-10-03）

用户提供“查询 waiting 里面的任务”成功回执：Waiting未完成5项，查询时间01:41北京时间。指定列表自然表达的可信入站→读取→回执闭环通过。用户随后编号完成/移动请求未被插件接管；此证据不属于维护验收，新增维护SPEC与任务登记另见[规格](../maintenance-spec.md)，没有执行该业务修改。

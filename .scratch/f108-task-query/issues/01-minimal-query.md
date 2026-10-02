# 01：最小 Inbox 未完成查询

Feature: F108/T01
Status: ready-for-agent
State: done
Blocked by: None
基准：9744de41362684f5ffdfcb93f249d3fef41697c2。
Spec: [单项规格](../spec.md)

## What to build

按单项规格提供确定性可信查询入口、只读 Apple/合成适配接口、有界分页、失败分类、真实对象引用与重启回执复用。

## Acceptance criteria

- [x] SPEC全部可执行验收项完成，真实未测明确记录。
- [x] 逐项TDD、演示、适用完整检查与顺序审查通过。
- [x] README、状态、证据更新，仅提交任务文件，不推送/发布。

## Verification

2026-10-02，Node v24.21.0。代码与合成验收完成；不关闭整个 F108。

### TDD 与公开接口

- 首条可信查询先运行 `node --test test/task-query.test.js`，实际失败 `gtd_unsupported`，实现查询动作与合成事实接口后通过。
- Apple公开查询接口先运行 `node --test --test-name-pattern='Apple查询' test/apple.test.js`，失败 `queryTasks is not a function`，新增只读桥接后通过。
- 未绑定后补显式配置先运行对应单测试，失败 `Apple binding changed`，允许同source无list绑定补ID；已绑定换目标仍拒绝。随后修正测试清理的重复close错误。
- 新查询别名带额外参数先跑对应测试，实际误收集；扩展保护后通过。审查发现礼貌前缀否定仍误收集，先跑失败测试后修复。
- 其余分页、同名/人工事项、完成过滤、空结果/权限/失败、超时、身份、重投/重启、回执未知等作为公开行为回归检查，未声称每个新增边界都经历失败阶段。
- 旧入口合成demo仍断言查询不可用，实际演示失败；更新为两条真实合成对象引用，重跑通过。

### 执行证据

| 命令 | 实际结果 |
| --- | --- |
| `npm run test:query` | 10/10通过，0失败/跳过 |
| `npm test` | 最终当前共享工作树175/175通过，0失败/跳过；包含另一并行对话未提交的OKR测试，不把这些改动归入本任务 |
| `npm run check` | JavaScript语法检查通过，包括新动作/demo/只读验证脚本 |
| `swiftc -typecheck native/reminders.swift` | 通过；不替换运行helper、不触发Apple访问 |
| `npm run demo:query` | 5个合成对象、4个未完成、2页、2回执；重开capture后同事件复用旧快照；查询写入/模型调用/真实Apple读取/真实飞书发送均0；本机15ms，非生产指标 |
| `npm run demo:entries` | 独立双进程旧布局续接通过，查询两条已有事项；一篇笔记、两条事项、10回执、路由付费调用0、166ms |
| `npm run demo:reminders` | 原事项设置提醒/澄清读回通过 |
| `npm run demo:recovery` | SIGKILL后恢复，一条事项/一条回执，134ms |
| `npm run demo:feishu` | 30输入+1重投，20事项/30回执，真实写入/发送与付费调用0 |
| `npm run plugin:validate` | 隔离插件loaded、doctorOk=true、reply_dispatch优先级100 |
| `git diff --check` | 通过 |

### 单agent顺序审查

应用本地code-review技能与AGENTS适配，基准9744de41362684f5ffdfcb93f249d3fef41697c2，检查本任务全部未提交文件，未创建子agent。

1. 规范：业务查询与可信入口/Apple接入分开，无新增依赖/通用框架/模型调用；权限由现有入口及原消息核验，分页/输出/超时有代码限额，错误不泄漏异常私人正文。原适配器只允许已绑定目标，无绑定补显式配置的修复不允许更换已绑定列表。无业务写入。EventKit全列表内存读取的限制保留，未宣称流式容量验收。
2. 需求：逐条核对Q37范围/配置/候选、未完成事实、引用/时间、同义不收集、重启/回执、无结果/失败/权限、复合/日期/日历边界。发现新别名带参数、礼貌前缀否定会误收集，均先复现后修复；旧demo断言同步更新。当前无阻塞发现。

### 真实限制、提交与下一任务

未读取私人Inbox、未新增Apple授权或权限提示、未编译替换运行helper、未部署/重启网关/发送真实飞书消息、未付费调用/新增定时任务。现有部署记录的授权与证据不能自动扩展为本次完整私人列表查询已验收；保留 `npm run verify:query -- --read-inbox --config /absolute/private/config.json`，需明确授权目标与新版helper。只读脚本仅打印范围/计数/ID，不打印任务标题。

真实Apple字段/权限/容量/iCloud变化、可信飞书闭环、生产延迟未验证。每页重新取数不保证跨页快照；默认每页20、最多100页，超过可访问范围的事项不声称已经展示完。日期/标签/已完成筛选、选中后维护和复合编排另行切片。

仅提交本任务文件与README新增章节；保护任务开始前及另一对话进行中的AGENTS/CONTEXT/需求/OS_WIKI/OKR等改动，未修改OS_WIKI拆分文档。提交哈希以最终Git记录/交付说明为准。不推送或发布。

下一项可执行任务：在获得具体Inbox读取和部署授权后，编译部署本查询增量并完成真实Apple只读与用户飞书查询验收；随后独立细化F108对象选择/扩展筛选或共用路由复合请求切片，不一次实现全部维护。

## 2026-10-02 授权后续：真实读取与部署

用户明确授权继续及Inbox读取。新快照176项测试及语法检查通过，真实已绑定Inbox两次只读查询均返回7条未完成事项及7引用。新helper编译/签名、备份、快照切换和网关重启完成；实际插件loaded、RPC成功、飞书probe成功。用户新消息闭环及真实容量/故障仍待验证，不替代原始未测限制。详见[部署证据](../../../docs/deployment/f108-task-query-2026-10-02.md)。没有新增Apple写入、代发飞书、模型调用或定时任务。

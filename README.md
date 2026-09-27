# 个人 GTD / Personal GTD

独立项目，已有任务 01–02 的本地模拟收集、提醒时间及澄清流程；真实飞书、Apple 与模型业务接入尚未实现。

- [需求文档](需求文档.md)：范围、已确认需求与验收目标。
- [架构与数据](架构与数据.md)：领域边界、Apple 工具和关联字段。
- [工作流与Review](工作流与Review.md)：日常行动与周期回顾。
- [待确认问题](待确认问题.md)：后续讨论入口。
- [参考项目](参考项目.md)：历史资料包中的相关参考。

总体讨论位于上级 Personal OS 项目；共享约定见 [跨项目协议快照](docs/context/跨项目协议快照.md)。本地演示不会访问 Apple、飞书、网页或模型服务。

## 开发准备（2026-09-27）

- GitHub：[liunoly-design/Personal_GTD](https://github.com/liunoly-design/Personal_GTD)。
- [AGENTS.md](AGENTS.md)：业务边界、小版本开发、可运行验收、成本和性能约束。
- [技能安装记录](docs/agents/skills.md)：38 项项目级技能、版本、更新与使用范围。
- [任务管理](docs/agents/issue-tracker.md)：本地 Markdown 规格与任务，随 Git 同步。
- [业务术语](CONTEXT.md)、[本次用户原始要求](docs/agents/用户原始要求.md)。

开发任务见 [任务列表](.scratch/feishu-capture/ticket-plan.md)，已实现 01–02；最新验收见 [02：提醒时间与澄清更新](.scratch/feishu-capture/issues/02-reminder-clarification.md)。

现有文档中指向 `../Personal-Agent-System-Design/` 的链接属于总体工作区历史资料，不包含在本独立仓库内；日常开发以本仓库当前需求及协议快照为准。需要追溯时在 Personal OS 工作区阅读原件。

## 安装与运行

需要 Node.js 24 或以上版本（本次使用 24.21.0），无需构建。用 `npm ci --ignore-scripts` 安装锁文件中的依赖。

任务 02 新增 `@js-temporal/polyfill` 0.5.1，用于真实的时区换算、日历校验和夏令时歧义检查；自然语言部分仍为模拟。[依赖源码](https://github.com/js-temporal/temporal-polyfill)、[Temporal 时区歧义规则](https://tc39.es/proposal-temporal/docs/zoneddatetime.html)。

在仓库根目录执行：

```bash
node --version
npm ci --ignore-scripts
npm run check
npm test
npm run demo
npm run demo:reminders
```

`check` 是 JavaScript 语法检查，不是静态类型检查。`test` 使用 Node 内置测试工具。`demo` 读取合成消息并使用当前机器时间；样例提醒日期已过去时会请求新的时间。`demo:reminders` 使用固定的合成时钟，稳定演示设置提醒、先收集再补时间和更新原事项。

交互式启动：

```bash
npm start
```

每行输入一个 JSON 事件，例如：

```json
{"id":"my-demo-1","senderId":"demo-user","conversationId":"demo-chat","sentAt":"2026-09-27T10:00:00+08:00","type":"text","text":"小婕 GTD，收集：研究家庭网络升级"}
```

按 Enter 得到一行 JSON 结果；按 Ctrl-D 结束。结果的 `mode` 固定为 `simulation`，包含回执和模拟事项的标题、原文备注及返回 ID。数据只存于当前进程内存，退出后清空。

文件输入及分析失败演示：

```bash
node src/cli.js --config examples/config.json < examples/messages.jsonl
node src/cli.js --analysis-failure < examples/messages.jsonl
```

## 本地配置与输入

将示例配置复制到已忽略的本地目录，修改后重新启动：

```bash
mkdir -p runtime
cp examples/config.json runtime/config.json
node src/cli.js --config runtime/config.json
```

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `activation` | `小婕 GTD` | 新消息开头的完整激活词，其后需空格、逗号或冒号 |
| `timeZone` | `Asia/Shanghai` | 未显式指定时采用的时区；非法配置直接拒绝启动 |
| `allowedSenderIds` | `["demo-user"]` | 允许的合成发送者 ID |
| `allowedConversationIds` | `["demo-chat"]` | 允许的合成会话 ID |
| `maxInputChars` | `8000` | 单条原文 Unicode 字符上限，超出则不保存 |
| `analysisTimeoutMs` | `15000` | 单次分析超时；不自动重试 |

本地事件 ID 和身份字段由演示输入提供，不能代替真实飞书身份验证。分析统计仅包含模拟调用量、延迟和固定失败原因；token 未计量，显示 `null`，没有真实模型费用。

任务 01 使用保守的指令格式，例如“收集：内容”“帮我记录一下：内容”；支持收集、记录、记下、保存四种动词，动词后需空格、逗号或冒号。不确定的表达会请求明确指令。通用自然语言理解和真实模型质量评估在任务 05 完成。

裸链接会先询问。下一行消息使用新的 `id`、同一发送者和会话，并以 `replyTo` 指向原链接消息 ID，文字回复“确认”或“取消”。未关联回复不写入；重复确认在本进程内复用结果。

## 提醒时间与澄清（本地模拟）

例如 `小婕 GTD，提醒我明天下午三点交报价`。先保存原文到一条 Inbox 事项，再设置该条目的提醒时间。回执包含完整日期、时刻和时区；输出中的 `remindAt` 是 UTC 时间。

模拟时间解析仅覆盖明确样例：

- 日期：`YYYY-MM-DD` 或今天、明天、后天。
- 时刻：24 小时制 `HH:mm`，以及“下午三点”“下午3点”及其“半”形式。
- 显式时区：放在时间表达开头的 `北京时间` 或 `[Asia/Tokyo]`、`[UTC]` 等 Temporal 支持的时区标识。显式时区覆盖配置。
- 其他自然语言、多个可选时间、非法日期和夏令时重复/不存在时刻保持待澄清，不自动选取或修正。

`下周找老王` 等不完整时间会先收集，再要求关联原请求补充日期与时间。例如给原请求 `id: "r1"` 的回复：

```json
{"id":"r2","senderId":"demo-user","conversationId":"demo-chat","sentAt":"2026-09-27T10:01:00+08:00","type":"text","text":"2026-09-30 15:00","replyTo":"r1"}
```

只补时刻沿用原请求中已知的具体日期；只补日期可沿用已知时刻。初次请求的“明天”基于原消息发送时间；补充消息重新明确说“明天”时基于该补充消息发送时间。消息时间戳必须包含 UTC 或时区偏移。

回复只在相同发送者、相同会话、明确原请求 ID 下更新原事项。多条待澄清项不凭“最近一条”猜测。带激活词的新请求即使回复了旧消息，也会作为新请求处理。

指定时间已过去时保留事项、不设置提醒、不自动顺延，要求新的时间。分析失败时注明分析未完成；提醒写入失败时保留事项 ID；结果未知时停止进一步更新并要求核对。已经设置成功的请求再次收到澄清回复会返回已有结果，本版未提供任意修改已设置提醒的指令。

程序一次最多处理 1000 条非空输入行。输出会展示原文供本地验收；请使用合成数据，不要将私人输入、输出或配置提交 Git。

## 当前限制与下一步

- 这是收集路径的模拟演示。建议由固定模拟分析器生成，不代表模型理解了内容。
- 提醒字段和澄清已在模拟边界实现；没有真实设备通知。持久化、一般事件去重与重启恢复在任务 03 实现，本版不能用于正式任务存储。
- 只有文本和文本内链接受支持；链接不会被访问。图片、语音、附件和转发卡片均不处理。
- 不调用 Apple、不发飞书消息、不连接模型、不移动条目、不写 Wiki。结果未知时仅停止并提示；自动核对和恢复待任务 03、04。
- 下一项是 [03：重复投递、部分成功与重启恢复](.scratch/feishu-capture/issues/03-recovery.md)。

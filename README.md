# 个人 GTD / Personal GTD

独立项目，已有任务 01 的本地模拟收集版本；真实飞书、Apple 与模型接入尚未实现。

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

开发任务见 [任务列表](.scratch/feishu-capture/ticket-plan.md)，本次实现 [01：本地明确指令收集](.scratch/feishu-capture/issues/01-local-capture.md)。

现有文档中指向 `../Personal-Agent-System-Design/` 的链接属于总体工作区历史资料，不包含在本独立仓库内；日常开发以本仓库当前需求及协议快照为准。需要追溯时在 Personal OS 工作区阅读原件。

## 安装与运行

需要 Node.js 24 或以上版本（本次使用 24.21.0）。使用本机已有 Node 即可；没有第三方运行或测试依赖，无需 `npm install`，无需构建。

在仓库根目录执行：

```bash
node --version
npm run check
npm test
npm run demo
```

`check` 是 JavaScript 语法检查，不是静态类型检查。`test` 使用 Node 内置测试工具。`demo` 读取合成消息，展示收集想法、确认文章链接和提醒尚未支持的回执。

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
| `allowedSenderIds` | `["demo-user"]` | 允许的合成发送者 ID |
| `allowedConversationIds` | `["demo-chat"]` | 允许的合成会话 ID |
| `maxInputChars` | `8000` | 单条原文 Unicode 字符上限，超出则不保存 |
| `analysisTimeoutMs` | `15000` | 单次分析超时；不自动重试 |

本地事件 ID 和身份字段由演示输入提供，不能代替真实飞书身份验证。分析统计仅包含模拟调用量、延迟和固定失败原因；token 未计量，显示 `null`，没有真实模型费用。

任务 01 使用保守的指令格式，例如“收集：内容”“帮我记录一下：内容”；支持收集、记录、记下、保存四种动词，动词后需空格、逗号或冒号。不确定的表达会请求明确指令。通用自然语言理解和真实模型质量评估在任务 05 完成。

裸链接会先询问。下一行消息使用新的 `id`、同一发送者和会话，并以 `replyTo` 指向原链接消息 ID，文字回复“确认”或“取消”。未关联回复不写入；重复确认在本进程内复用结果。

程序一次最多处理 1000 条非空输入行。输出会展示原文供本地验收；请使用合成数据，不要将私人输入、输出或配置提交 Git。

## 当前限制与下一步

- 这是收集路径的模拟演示。建议由固定模拟分析器生成，不代表模型理解了内容。
- 提醒时间、持久化、一般事件去重与重启恢复分别在任务 02、03 实现；本版不能用于正式任务存储。
- 只有文本和文本内链接受支持；链接不会被访问。图片、语音、附件和转发卡片均不处理。
- 不调用 Apple、不发飞书消息、不连接模型、不移动条目、不写 Wiki。结果未知时仅停止并提示；自动核对和恢复待任务 03、04。
- 下一项是 [02：提醒时间与澄清更新](.scratch/feishu-capture/issues/02-reminder-clarification.md)。

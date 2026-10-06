# 个人 GTD / Personal GTD

任务 01–06 的代码与安装交付已完成，插件已接入本机 OpenClaw 网关。基础收集和提醒已验证；用户反馈链接确认、时间澄清以及大小写兼容、默认收集均成功。完整故障恢复与容量验收仍有未测项，详见 [安装记录](docs/deployment/installation-2026-09-27.md)。

飞书由“小婕”统一接入；本仓库的 PGTD 插件接管激活请求并写入 Apple Inbox。独立 `gtd` / `wiki` Agent 的共享运行架构位于总体工作区 `OpenClaw/README.md`。

- [需求文档](docs/requirements/需求文档.md)：范围、已确认需求与验收目标。
- [架构与数据](docs/requirements/架构与数据.md)：领域边界、Apple 工具和关联字段。
- [工作流与Review](docs/requirements/工作流与Review.md)：日常行动与周期回顾。
- [待确认问题](docs/requirements/待确认问题.md)：后续讨论入口。
- [功能版本计划](docs/requirements/功能版本计划.md)：OKR 备忘录独立模块、标签关联、Inbox 整理和新建日历事件的开发顺序（F101/F102 接入验证和 F103/F104 日志与定稿代码已完成，尚未部署）。
- [功能实现清单](docs/requirements/功能实现清单.md)：全部功能的稳定 F 编号、V0–V5 规划分组、状态与 skill 开发流程；可按编号讨论和开发。
- [参考项目](docs/requirements/参考项目.md)：历史资料包中的相关参考。

总体讨论位于上级 Personal OS 项目；共享约定见 [跨项目协议快照](docs/context/跨项目协议快照.md)。原 demo 命令保持模拟；start:apple / start:model 会使用对应真实服务。

## 目录导航

| 目录 | 内容 |
| --- | --- |
| `docs/requirements/` | 需求、架构、工作流、待确认问题与参考资料 |
| `docs/deployment/` | Apple、模型与 OpenClaw 安装说明、交接与验收记录 |
| `docs/agents/`、`docs/context/` | 开发约定与跨项目协议快照 |
| `src/`、`src/actions/` | 业务入口、独立动作模块、持久化、适配器与 CLI |
| `openclaw/`、`native/` | OpenClaw 插件入口与 Apple Swift 桥接源码 |
| `deploy/` | 安装、编译、验证与恢复脚本 |
| `config/` | 可提交的合成配置示例 |
| `test/`、`examples/` | 自动化测试、模拟演示与合成输入 |
| `.scratch/` | 版本规格、任务与验收记录 |
| `runtime/` | 本机配置、凭据引用、数据库与 helper；Git 忽略 |

根目录保留 README、AGENTS、CONTEXT、npm 清单/锁文件和 OpenClaw 插件清单，供工具直接发现。旧 `scripts/` 已迁入 `deploy/`，配置示例从 `examples/` 迁入 `config/`；npm 命令名称保持不变。

## 开发准备（2026-09-27）

- GitHub：[liunoly-design/Personal_GTD](https://github.com/liunoly-design/Personal_GTD)。
- [AGENTS.md](AGENTS.md)：业务边界、小版本开发、可运行验收、成本和性能约束。
- [技能安装记录](docs/agents/skills.md)：38 项项目级技能、版本、更新与使用范围。
- [任务管理](docs/agents/issue-tracker.md)：本地 Markdown 规格与任务，随 Git 同步。
- [业务术语](CONTEXT.md)、[本次用户原始要求](docs/agents/用户原始要求.md)。

开发任务见 [任务列表](.scratch/feishu-capture/ticket-plan.md)，已实现 01–06 的开发交付；最新证据见 [06：插件交付](.scratch/feishu-capture/issues/06-feishu-integration.md)。首版整体验收以安装记录中的逐项结果为准。

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
node src/cli.js --config config/config.json < examples/messages.jsonl
node src/cli.js --analysis-failure < examples/messages.jsonl
```

## 本地配置与输入

将示例配置复制到已忽略的本地目录，修改后重新启动：

```bash
mkdir -p runtime
cp config/config.json runtime/config.json
node src/cli.js --config runtime/config.json
```

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `activation` | `小婕 GTD` | 开头激活词忽略英文大小写；词间空格可省略或重复，允许前导空白；其后需空格、逗号或冒号 |
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

## 持久化与恢复（任务 03，本地模拟）

使用 Node 内置 [node:sqlite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)，没有新增 npm 依赖。操作日志与模拟外部服务分为两个数据库：前者保存去重标识、写入意图、原始输入、分析结果和澄清关联；后者代表模拟的列表、事项和回执。操作日志不提供任务完成状态管理。

```bash
npm run demo:recovery
npm run start:durable -- --state-dir runtime/demo --config config/config.json < examples/messages.jsonl
npm run start:durable -- --state-dir runtime/demo --config config/config.json --recover
```

第一条命令启动独立子进程，在模拟事项创建成功后用 SIGKILL 中断，再用新进程恢复并断言恰有一个事项、一条回执。后两条命令使用同一目录保存和恢复进度；不传 `--recover` 时逐行接收 JSON 事件。原 `npm start` 仍是内存演示。

同一发送者、会话、事件 ID 重投复用结果；同一 ID 的不同内容返回 `event_conflict`。新事件即使同标题也单独收集。未激活普通聊天不存入操作日志。原事件配置用于恢复业务语义，当前配置仍用于权限和容量检查。

写入意图先持久化，再调用外部服务。响应丢失时先按操作 ID 查询：已应用则复用真实返回 ID；明确未应用才允许有界重试；状态不明则停止写入。未完成业务操作会阻止后续新操作，返回 `recovery_required`，避免覆盖澄清进度。恢复完成前不要删除日志或换目录重投。

业务结果提交后才发送模拟回执；`delivery: pending` 表示只需恢复回执。`sent` 仅代表模拟服务已记录，未向飞书发送。未完成操作的失败说明直接返回调用者；本版不自动发送这些中间状态。预算耗尽保留进度并返回 `budget_exhausted`；需要检查外部状态后人工处理，本版没有自动清理或重置工具。

同一日志只允许一个活动进程。异常退出后按本机 PID 检测释放占用；若 PID 被其他进程复用，会保守拒绝打开。仅支持本机私有目录，不支持多主机或网络文件系统。数据库文件权限为 0600，新建目录为 0700；数据库含原文，未加密，及其 WAL 辅助文件均已被 Git 忽略。持久化 CLI 只输出状态、ID 和统计，不输出原文。

### 恢复预算（可通过同一本地 JSON 配置修改）

| 配置 | 默认值 | 范围 |
| --- | --- | --- |
| `maxStoredEvents` | 1000 | 单个日志最多保留的事件数，满后停止新事件 |
| `maxEventChars` | 20000 | 完整事件 JSON 的 UTF-16 长度上限，补充正文 8000 字符限制 |
| `maxAnalysisOutputChars` | 4096 | 分析结果 JSON 的 UTF-16 长度上限，超出走原文收集降级 |
| `maxRecoveryAttempts` | 5 | 每个事件的业务处理总次数，含首次，跨重启累计 |
| `maxWriteAttempts` | 2 | 每个外部操作最多写入次数，含首次 |
| `maxReconcileAttempts` | 3 | 每个外部操作最多核对次数 |
| `externalTimeoutMs` | 2000 | 单次外部读取、写入或回执超时 |

每事件最多一次分析调用，不自动重试；中断或超时后按分析失败降级。调用量、延迟、失败原因留在操作记录中；恢复复用分析时本次调用量为 0。token 和费用尚未测量；输出字符上限不能代替真实模型 token 上限。外部适配器接收 AbortSignal，但必须额外保证同一操作 ID 的幂等写入；超时本身不能证明没有写入。当前模拟服务用事务同时保存对象和操作标记；真实 Apple/飞书是否能满足这些条件须在任务 04/06 验证，不能直接套用模拟保证。

## 真实接入与 OpenClaw 使用

- [Apple 安装与验收](docs/deployment/apple.md)：真实 Inbox、8000 字原文、提醒和手动移入 Wiki。
- [Gemini 运行与质量评估](docs/deployment/model.md)：复用 gtd 凭据、结构化分析、预算及真实错误样例。
- [已有 OpenClaw agent 如何安装整体](docs/deployment/openclaw.md)：运行路径、插件与验证命令。
- [给 OpenClaw 管理 agent 的交接](docs/deployment/openclaw-handoff.md)：安装命令、配置模板、逐项验收、恢复和回滚。

`npm run start:model -- --config config/model-config.json --state-dir runtime/model-demo` 调用真实 Gemini，Apple 为模拟。加 `--apple` 并提供真实账户配置才写入 Apple；不要把演示身份字段用于飞书鉴权。

## 当前限制与下一步

- 模拟命令继续使用固定分析规则；真实模型命令单独计费与验收。
- Apple 原文、提醒及设备通知已实测；缺失 Inbox 新建分支未在本机触发，真实 iCloud 冲突未注入。
- 仅处理文字和文字内链接，不读取全文、不写 Wiki；链接由用户手动移动。
- 当前模型适配器支持已核价的 Gemini Flash 型号；其他供应商需要适配，不能仅更改模型名称。
- 飞书插件已安装到运行网关；本地 JSONL 身份不能代替飞书可信事件。
- 下一步补齐真实故障恢复、容量与长期运行预算验收；现有测试预算不等于长期授权。

## OpenClaw 插件离线验收（任务 06）

```bash
npm run demo:feishu
npm run plugin:validate
mkdir -p dist
npm pack --pack-destination dist
```

前两个命令不会调用真实 Apple、模型或飞书。插件包入口为 `openclaw/index.js`，不会包含 runtime、凭据或操作数据库。本机推荐由管理 agent 链接安装当前仓库并复用已有 helper；复制安装需在目标路径重新编译 helper。不要仅复制开发技能作为运行插件。

## 2026-09-27 触发与默认收集更新

触发词兼容大小写、词间零个或多个空格及前导空白。例如 `小婕gtd 买牛奶`、`小婕 gtd 收集 买牛奶`、`小婕 GTD，收集，买牛奶` 都会收集。触发词后仍需空格、逗号或冒号。

用户最新约定优先于上面的历史规则：激活后有正文就默认收集，不再让模型的讨论/不确定分类阻止保存；不希望收集的普通聊天不加触发词。仅有触发词或“收集”等空指令时提示补充内容，不创建空事项。裸链接仍先确认；明确提醒指令继续走提醒与时间澄清流程。默认收集不等于承诺执行。

## 按功能升级与代码同步

收集、设置提醒、补时间、链接确认已拆成独立动作文件；对应修改入口和局部测试命令见 [动作维护说明](docs/development/actions.md)。

本机默认 `git push origin main` 使用 SSH，HTTPS 备用方式见 [Git 同步说明](docs/deployment/git-sync.md)。

## F101：备忘录接入验证

已在授权的 `iCloud / Notes` 创建、追加并读回同一篇合成笔记，验证新进程复用和过期快照拒绝。笔记保留供验收；F103/F104 已实现 OKR 入口与定稿代码，尚未部署。

```bash
npm run test:notes
npm run verify:notes -- --write-synthetic --account iCloud --folder Notes
```

第二条命令访问真实 Apple 备忘录，须有目标位置授权。复用 `runtime/notes/probe.sqlite`，不要换目录重试。权限、预算、恢复及 iCloud 并发限制见 [F101 接入说明](docs/deployment/notes.md)。

## F102：提醒事项原生标签预检

```bash
npm run probe:tags
```

仅清点本机 SDK、系统脚本字典与快捷指令 CLI，不读取私人任务或写入标签。现有 EventKit/JXA 没有公开标签字段；快捷指令有官方标签支持，真实闭环待配置与验收。详见 [F102 调查与验证入口](docs/deployment/reminder-tags.md)。

## OKR 日志（F103）

实现飞书 `小婕 gtd okr 讨论` 启动固定备忘录、回复记录原文、暂停及重启续接。`#O1`、`#KR1` 等标签文本保留；本次使用一篇日志，目标定稿和 Review 分析待后续实现。

```bash
npm run test:okr
npm run demo:okr
# 真实写入：复用已授权并经过 F101 验证的合成笔记
npm run verify:okr -- --write-synthetic
```

正式启用需要私有运行配置中的 `okr` 位置和正式文档授权，详见 [配置、用法与验证限制](docs/deployment/okr.md)。本轮没有部署或发送真实飞书消息。

## F104：OKR 引导与确认定稿

在 F103 日志上逐轮讨论个人情况、年度/季度目标和策略，反向审视后展示完整草案。回复草案回执“确认定稿”才更新第二篇最新稿，旧版保留在日志中；#O1/#KR1 等标签随文本保存。

```bash
npm run test:okr
npm run demo:okr-finalize
```

真实模型样例、合成日志和新增合成最新稿的创建、修订、读回验证均已执行。配置、可选真实验证命令、预算及未测项见 [F104 使用与验收](docs/deployment/okr-finalize.md)。飞书网关现已绑定两篇合成测试笔记。

## 备忘录原生标签修复

F103/F104 现已通过本机原生编辑器创建并读回 #O1/#KR1 等标签；追加、定稿更新保留标签，已有 #OK1 也已实测保留。此前的标签文本检查不等于原生标签验收。

```bash
npm run verify:notes-tags -- --write-synthetic
```

复用已授权的两篇合成笔记。依赖登录桌面、Swift 和辅助功能权限，运行时需避免同时编辑 Notes；飞书已接入合成测试位置。详见[原生标签验收及恢复](docs/deployment/notes-native-tags.md)。

### 飞书合成验收入口

已把本机飞书 OKR 配置绑定到上述两篇合成测试笔记，等待真实用户发送“小婕 gtd okr 讨论”验收。尚未声明端到端通过，暂勿录入正式目标；预算与状态见 [接入验收记录](docs/deployment/okr-feishu-acceptance.md)。

### 逐项 OKR 讨论

采用 grilling 决策树质询和 OKR 方法：先确认年度/季度及起止日期，再讨论一个 O，逐个形成它的 3–5 个 KR；每轮一个核心问题和建议，等待回应。KR 明确结果、基线、目标值、证据和检查日期；未知内容保留待确认。工作草案持久保存，可暂停后续接。

草案使用一级周期、二级 O、三级 KR 标题，备忘录应用原生“标题／小标题／副标题”，并保留原生 #O1、#KR1 标签。反向审视后回复完整草案“确认定稿”才更新最新稿。

验证范围和限制见[逐项讨论验收](docs/deployment/okr-guided-structure.md)。

### OKR 持续回复修复（2026-10-01）

可持续回复原 OKR 回执，围绕同一个目标反复质询；未形成草案也保存当前事实与问题，重启后续接。修复飞书 `updated` 标记误拒绝正文一致的普通讨论回复；正文不一致会给出明确重发提示。仍受已授权调用预算和笔记容量限制。见[原因、验证与恢复](docs/deployment/okr-continuation.md)。

### OKR+GTD 教练方法

已将 grilling 的依赖问题访谈、okr-design 的结果指标方法和 okr-creator 的验收思想接入同一位 OKR 教练。运行模型与个人OKR技能共用 `src/okr-method.md`：逐项质询，未知数据保留未知，承诺底线单独判断，GTD行动作为候选且不替代KR证据。

[来源比较与采用边界](docs/requirements/OKR技能比较与整合.md)；[验证记录](docs/deployment/okr-method-integration.md)。可用 `npm run evaluate:okr-method -- --allow-model`执行两个真实模型合成样例（消耗已配置共享预算，不访问Apple或发送飞书）。

OKR 备忘录失败时，网关 `personal-gtd` 日志会记录白名单错误码及 Apple 操作阶段（如 `APPLE_TIMEOUT` / `read`），本地状态保留对应诊断，不记录异常正文。超时或写入结果未知时先核对原记录，避免直接重复提交。

## F601/T01：三个平级显式入口（已部署，真实入口验收待测）

可信飞书文字入口支持 `小婕 gtd XXX`、`小婕 okr XXX`、`小婕 review XXX`；英文模块名忽略大小写，允许前导空白、词间零个/多个空格，模块后需空白、逗号、冒号或消息结束。旧 `小婕 gtd okr 讨论/续接/记录/暂停/确认定稿` 继续使用同一 OKR 配置、会话与笔记。仅模块词返回补内容/帮助或当前不可用说明。

- GTD：普通待办继续默认收集；`收集/记录/记一下/记下/帮我记/保存/存一下` 后用空白、逗号或冒号分隔正文。`提醒我/到时候叫我/记得通知我` 沿用原提醒时间解析和关联澄清。
- OKR：`讨论/聊聊/一起想想/梳理目标`、`续接/继续/接着聊` 启动或续接已有讨论；`记录/记一下/记下/保存/存一下` 保存正文，`暂停/先停一下` 暂停。定稿只接受关联当前草案的明确“确认定稿”；“好的/继续”不能替代确认。显式讨论可以带主题，当前处理器仍先询问周期和个人情况，不据主题自动生成计划。
- Review：准确报告尚未实现/启用；日/周/专题复盘、注册均不会读取业务数据或开始定时任务。

明确查询、任务维护、日历、规划/复盘请求，以及确定性识别的否定、引用或复合操作，不再因 GTD 默认收集而误写。普通“完成一份报告/明天完成报告”仍是收集正文；`收集：他说“别记录这句话”` 保存所给引用。识别只覆盖明确句式，未知 OKR 动作返回帮助，自由意图分派、实际查询和复合编排在后续切片实现。

自定义 `activation` 仍为 GTD 兼容入口，与默认三入口并存；若与 OKR/Review 命名空间重合或吞掉其前缀，启动时报 `activation conflict`。同属 GTD 的重合允许。入口选择以核验后的飞书原消息为准；显式新入口优先于回复关系，无前缀续接仍需同用户、同会话和真实关联。原文、事件 ID 与状态布局保持兼容，重投不会重复写入；回执结果未知时保留进度，停止重新发送。

```bash
npm run test:entries
npm run demo:entries
```

`demo:entries` 使用固定合成时钟、同一临时状态目录及两个独立进程，覆盖三个入口、旧 OKR 别名/回复、旧 GTD 无模块标签的链接确认、重投与恢复。最终为一篇合成笔记、两条模拟事项、十条模拟回执；路由模型调用、付费调用和真实写入均为零。CLI `npm start` 仍是 GTD 收集模拟，三个模块的公开入口验收使用上述可信飞书模拟。证据与未测项见 [F601/T01 任务记录](.scratch/f601-explicit-entries/issues/01-explicit-entries.md)；三个独立 Agent 与新版真实飞书/Apple/模型闭环尚未由本任务验收。2026-10-01 已按用户授权重启现有网关加载新版，连接与插件检查通过，见 [部署记录](docs/deployment/f601-explicit-entries-2026-10-01.md)。

OKR 已有工作草案时，模型每轮只提供一项变更，由代码保留其他条目并组装完整稿；不再要求模型每次重写全稿。项末排版空行不算另一项改动，实质多项修改仍拒绝。旧失败消息不重新分析，续接请回复原回执发送新消息。真实模型质量仍需飞书逐项验收，见 [单项合同修复](.scratch/okr-single-item-contract/issues/01-single-item-contract.md)。

OKR 长期讨论日志的正文限额为 65536 UTF-16 单位，最多 512 个标题及已有原生标签对象；原生 HTML 另设 131072 单位上限以容纳格式开销。达到保护限额时停止写入并保留历史；格式修复后的未知写入通过原事件读回恢复，不重新分析。

## F108/T01：最小 Inbox 任务查询（已部署，真实读取已验收）

可信入口支持 `小婕 gtd 查询任务`、`请帮我看看未完成任务`、`查看事项`、`列出待办`、`有哪些任务`、`任务有哪些` 等完整同义表达。查询使用已有 Apple sourceId/listId 绑定，显示列表名称、未完成数量、编号标题和本地查询时间，真实对象 ID 保存在系统记录中；人工创建的事项也可返回。不会创建或修改事项，不调用模型、不判断优先级。无绑定先提示私有配置目标，列出同名真实候选；不自动创建/选择 Inbox。

2026-10-03 已加入指定列表查询：`小婕 gtd 查询工作列表的任务`、`小婕 gtd 查询「Work Projects」里的任务`，可追加 `第 2 页`。仅在已配置账户内按完整列表名匹配，英文忽略大小写；找不到或同名多个会明确提示，不回退默认列表。默认查询和收集绑定不变；关键词、日期及全部列表查询尚未实现。见 [T04](.scratch/f108-task-query/issues/04-explicit-list.md)。 也支持自然表达 `小婕 gtd 查询 waiting 里面的任务`，不必加引号或“列表”字样。

```bash
npm run test:query
npm run demo:query
# 仅在获得目标 Inbox 读取授权后执行；先按现有安装流程编译新版 helper
npm run verify:query -- --read-inbox --config /absolute/private/config.json
```

最后一条只读验证命令要求配置明确的 `sourceId` 和 `listId`，输出范围、数量和引用，不打印私人任务标题；不调用模型、发送飞书或申请系统权限。编译/部署按授权范围执行；2026-10-02 已升级运行 helper 并重启网关，具体证据见下方部署记录。

配置 `queryPageSize` 默认为20（1–50），`queryTimeoutMs` 默认为15000（1–20000毫秒）。追加 `第 2 页` 查询下一页，页码1–100；每页重新读取，外部变化可能改变页间结果。EventKit先读取整份列表，再按ID排序限量返回，列表总量超过10000项会失败；真实容量与性能待测。标题超过200字符标明省略，备注不返回。空列表、本页为空、权限不足、超时/读取失败分别报告。同一事件重投或重启复用首次快照，新消息重新读取。

本切片不支持日期/标签/已完成筛选、复合编排、日历查询、选中后维护或通用模型路由；这些请求保持能力提示，不误收集。完整规格与验收证据见 [F108/T01](.scratch/f108-task-query/issues/01-minimal-query.md)。2026-10-02 已获 Inbox 读取授权并部署到独立快照，真实只读查询返回 7 条未完成事项；飞书用户新消息闭环与生产性能仍待验收。见 [部署与真实读取记录](docs/deployment/f108-task-query-2026-10-02.md)。请在飞书发送一条新消息 `小婕 gtd 查询任务`，旧消息重投复用旧结果。

## OKR 本地日志与备忘录讨论稿

配置 `okr.journalDir` 为私有绝对目录后，完整问答存入该目录的 `journal.md`，`archive/` 保留迁移前的完整日志、定稿讨论稿与旧结果。首次启用只接受原绑定不变且没有未完成写入的状态；历史归档核对后，原日志笔记按同一 ID 改为“PGTD OKR 讨论稿”。运行目录和 Markdown 不提交 Git。

`小婕 okr 讨论/续接` 和关联回复继续使用；不需要压缩命令。讨论稿每轮替换，不累积历史；模型仅使用讨论摘要、当前草案和最多 3000 字符的本地日志片段，不加载整份历史。回复当前待确认草案“确认定稿”后，先归档、再更新同一“PGTD OKR 最新稿”，确认结果成功后收起讨论稿。暂停不删除任何文件。

本地日志上限 16 MiB；文件被删改、Notes 人工修改或写入结果未知时停止并核对，不覆盖历史或重复调用模型。未设置 `okr.journalDir` 的模拟和既有部署继续使用原日志模式。验证：`npm run test:okr`、`npm test`、`npm run check` 和 macOS 上 `swiftc -typecheck native/notes-tags.swift`。


F108 部署修复：OpenClaw 会复制插件到临时目录，私有运行配置现在必须设置 `remindersHelperPath` 为已编译 helper 的绝对路径（例如本机仓库下 `runtime/bin/pgtd-reminders` 的绝对路径）。缺少或使用相对路径时拒绝启动。已在真实网关中验证读取成功；此前失败消息仍复用旧结果，请发送一条新查询验证回执。详见 [helper 定位修复](.scratch/f108-task-query/issues/02-helper-path.md)。


## F108/T05：回复查询回执选择任务

回复机器人发出的新查询回执，发送 `选择第1项` 或 `选择第1,2项`，不用重复“小婕 gtd”前缀。系统按原回执编号定位真实任务，并只读核对当前状态；第2页使用回执实际显示的编号。事项已经编辑、完成、移动、删除或回执缺旧版核对信息时，请重新查询后选择。

F201/T01已支持回复 `第1项完成` 直接完成唯一事项并读回。`第5项移动到 Next 清单` 及多项完成/移动现由F207/T01生成计划，等待关联确认后执行。最多选择10项，不能用任务标题代替真实对象；未经可信原消息核验、错误用户/会话或缺回执关联均不写入。

`npm run test:query`、`npm run demo:query`覆盖可信编号定位、持久化与只读核对。详见[任务与验证](.scratch/f108-task-query/issues/05-reply-selection.md)和[部署证据](docs/deployment/f108-reply-selection-2026-10-03.md)。真实飞书新回复闭环待用户验收；旧回执可能需重新查询。


## F201/T01：回复回执完成单项任务

回复新的任务查询回执发送 `第1项完成` 或 `完成第1项`，会核对原真实事项、标记完成并读回。已完成不会重复写入；事项已编辑/移动或旧回执缺字段基线时需重新查询。结果未知只核对，不换消息重写；移动和批量维护现由F207/T01提供计划确认流程。

测试：在配置账户手动建“PGTD测试”列表并仅放一项测试任务，飞书发送 `小婕 gtd 查询 PGTD测试 里面的任务`，回复回执 `第1项完成`。预期“已完成并核验”，Apple勾选完成，再次查询无未完成事项。真实写入及飞书完成闭环待用户主动验收。

`npm run demo:complete` 为纯合成完成/重启/重复请求演示；适用检查 `npm run test:query` 和 `npm test`。见[任务](.scratch/f201-task-status/issues/01-complete.md)与[部署证据](docs/deployment/f201-task-completion-2026-10-03.md)。


## F108/T08：自然编号与提示纠正

回复新查询回执可以说 `第一项标记完成`，也可使用阿拉伯编号。`第一第二任务标记完成`、`第1第2项任务标记完成` 都能识别两项；当前会生成具体批量计划，等待关联确认后执行。无需固定标点。

回复新版编号错误提示或维护未上线提示，可以继续纠正原查询。单独发编号仍需可信查询引用；旧版错误提示可能需要重新查询。完成结果回执不能用于操作其他编号。

用户测试：在“PGTD测试”清单放一项测试任务，发送 `小婕 gtd 查询 PGTD测试 里面的任务`，回复新查询回执 `第一项标记完成`。预期完成并核验，Apple中已勾选。真实闭环待用户测试。见[任务](.scratch/f108-task-query/issues/08-natural-replies.md)。


## F207/T01：确认多项完成与移动

回复新查询回执：`第一第二项完成，第五项移动到 Next 清单`。机器人列出具体计划，确认前不写入；回复该计划 `确认执行` 后逐项执行并核验，或回复 `取消`。单项移动同样先确认；单项完成仍直接执行。最多10项，目标名称无需引号，清单必须已存在且名称唯一、同账户可写。

重复确认和重启不重放已开始操作，结果未知先核对；独立项失败可继续，逐项显示成功、明确失败或未知。修改范围请回复原查询生成新计划，旧未执行计划失效。不支持删除、重开或跨账户。带复发规则或位置提醒的移动暂时阻塞，ID或内容未能读回核实不声称成功；原任务不复制替代，默认收集位置不变。Apple不提供本流程的跨任务事务或跨设备锁。

演示与检查：`npm run demo:maintenance`、`npm run test:query`、`npm test`。真实验收接口：单独授权后编译 deploy/maintenance-fixture.swift（使用 native/Info.plist、与提醒helper相同签名标识），运行 `node deploy/verify-task-maintenance.js --allow-synthetic-writes`，仅创建专用合成源/目标清单与5项，完成2项移动1项并清理；失败保留私有验收记录，不盲重试。真实验收状态见[部署记录](docs/deployment/f207-maintenance-2026-10-03.md)。


F108/T09：指定清单可简写 `小婕 gtd 查询 inbox 任务` 或 `小婕 gtd 查询 waiting 任务`，按完整名称匹配清单；含空格的名称使用“查询 <名称> 列表的任务”。不支持表达的帮助已反映多项完成/移动的计划确认能力。旧回执仍代表当时结果，请用新消息重新查询。


2026-10-03 验收更新：F110/T01与F207/T01真实Apple专用合成验收通过，完成2项、原地移动1项，ID/受核验字段/默认绑定保留、重复写入0，验收数据清理成功。用户反馈飞书查询/批量完成成功；真实飞书混合移动及逐项真实故障场景未全部实测，见上述部署记录。

## F108/T10：标题关键词查询（2026-10-03）

发送 `小婕 gtd 查询 waiting 里面关于金山的任务`，只查询指定清单未完成标题包含“金山”的事项；默认绑定清单可用 `小婕 gtd 查询关于金山的任务`。忽略大小写、采用 NFC Unicode 归一化，连续匹配完整关键词，不搜索备注、不拆词、不扩展日期或全部清单。歧义词用引号明确，如 `关于「今天到期」的任务` 表示字面标题关键词。下一页命令保留关键词及清单，数量为筛选后的未完成总数；无结果明确说明。

查询只读、不调用付费模型、不改变默认绑定。回复这条查询回执可沿用编号完成/移动及批量确认。检查用 `npm run test:query`、`npm run demo:query`；[短规格](.scratch/f108-task-query/keyword-spec.md)、[验收记录](docs/deployment/f108-keyword-2026-10-03.md)。日期与备注搜索仍待独立任务。

## F603/T01：OKR 单模块（增量已部署，目标 0.3.0）

私有 `runtimeConfigPath` JSON 可设置 `"enabledModules": ["okr"]`，保留原 `okr.account`、`okr.folder`、已绑定笔记状态、`okr.journalDir` 和共享 `usagePath/model` 预算。此模式不要求 `sourceId/listId/remindersHelperPath`，不初始化提醒事项或 Review；未设置 `enabledModules` 时保留现有行为。不要删除旧状态来切换模块或恢复写入。

使用 `小婕 okr 讨论`，关联回复逐项讨论；`小婕 okr 暂停` 或回复“暂停”后，`小婕 okr 续接` 恢复。回复当前完整草案“确认定稿”才更新同一最新稿；`小婕 gtd okr …` 兼容。禁用模块明确拒绝。完整日志保存在本地，Notes 保留讨论稿/最新稿两篇，原生标签及未知结果核对机制沿用。

同身份、同会话的关联讨论支持“不需要/不用/不想/没有/不是/否”等短回答；入口中的否定查询仍不执行。历史失败或帮助回执不会自动重跑，新回答请回复关联回执发送新消息。

分析失败会说明原因、原回答保存状态和恢复步骤。回复原失败回执“重试分析”可复用该回答发起一次新分析，仍计入原预算；同一重试消息重投/跨重启不重复调用。“续接”只展示已保存进度。鉴权、预算或用量无法核实等问题须先处理，不能靠重复发送恢复。“重置分析”仅提示正确命令，不会清空记录。备忘录编辑窗口不可用时请保持备忘录打开，先用“续接”核对保存状态。 遇到 WRITE_RESULT_UNKNOWN 等写后核对失败时，先发送“小婕 okr 续接”；它只核对已有待写入内容，不重跑模型。仍失败须由维护者核对恢复，不要重复提交原回答或使用“重试分析”。

原生 Notes 编辑稳定性验收：`node deploy/verify-notes-editing.js <私有runtime配置路径> <私有结果目录> --allow-notes-writes`。须有真实 Notes 写入授权；新建合成笔记并连续五轮替换、核对正文/原生标签/标题，不调用模型或发送飞书消息。测试期间暂停手动切换 Notes；结果未知时保留记录先核对，不重复写入。

`npm run test:okr-standalone`、`npm run demo:okr-standalone` 使用合成 Notes/飞书/脚本教练，零付费调用。运行配置仍需可信飞书身份、Notes 权限、已有模型预算和桌面环境；开发通过不代表部署或真实模型质量验收。[验收记录](docs/deployment/f603-2026-10-05.md)。

## F603/T02：查询当前已确认目标（增量已部署）

`小婕 okr 查询当前目标`、`查一下目标`、`查看当前已确认目标`、`看看目标`、`找一下当前目标`、`列出当前目标`、`当前目标是什么`读取同一绑定最新稿；旧 `小婕 gtd okr …` 和关联回复兼容。回执显示来源、账户/文件夹、笔记ID、读取时间与当前已确认范围。查询不启动讨论、不生成草案、不写 Notes、不进入 Inbox、零内容生成模型调用。无绑定先询问；同名文档不自动选择；空文档、读取失败、无权限及未确认稿分别报告。

每次最多一次60秒读取，正文超过65536字符拒绝，每页2000字符；继续用 `小婕 okr 查询当前目标 第2页`。各页实时读取，期间人工修改可能改变分页；重复同一事件复用旧回执，更新事实请用新消息重新查询。正在核对定稿结果时先恢复原确认消息。

`npm run test:okr-query`、`npm run demo:okr-query` 为合成验收。真实只读入口：`npm run verify:okr-query -- --state-path runtime/feishu/state/okr.sqlite`，只使用已授权绑定，状态数据库只读，不初始化会话、不展示私人正文、不发送飞书。现有模型/身份预算和 Notes 桥接限制沿用。2026-10-05已部署增量，真实Notes查询、飞书基本/同义/旧入口查询和暂停重启续接通过；真实多轮模型讨论及定稿仍待验收。完整0.3.0版本未发布。


## F614/T01：手动每日心得 DOPL（已部署增量）

仅启用 `review` 可以独立运行；零模型，不需要模型账本、凭据或 Reminders/OKR 配置。运行时私有配置示例：

```json
{
  "enabledModules": ["review"],
  "timeZone": "Asia/Shanghai",
  "review": {
    "account": "明确选择的账户",
    "folder": "明确选择的文件夹",
    "year": 2026,
    "allowCreate": false,
    "writeEnabled": true
  }
}
```

飞书身份白名单和私有运行路径沿用原配置。可指定真实 `noteId`；没有ID时唯一匹配 `2026-DOPL`，同名多个不猜。只有明确授权新建年度笔记才设置 `allowCreate: true`。`writeEnabled: false` 撤销写权限，`readEnabled: false` 撤销读取；重启加载配置，未确认草案保留。基础位置/年度不能静默变更；额外年份可按T02配置明确的已有年度ID，保留旧绑定与状态。

1. 发送 `小婕 review 注册 DOPL`，核对方法/年度/位置，回复回执 `确认注册`。
2. 发送 `小婕 review 每日心得`（或 `DOPL`），回复问题提供心得原文。
3. 核对 `MMDD-心得` 草案，回复**当前草案** `确认保存`；读回后才报告保存成功。
4. `小婕 review 续接` 恢复当前草案或只读核对未知写入；`取消` 结束本次。

日期依据发起消息和用户时区；跨午夜回答沿用原日期。每天一条，同日已有心得展示原文并提示修订选择，T01不实现合并/替换、补记、查询历史、其他复盘方法或定时任务。心得上限4000 Unicode字符；独立日期标题与恢复标记是保留格式，原文含这些行时提示改写，不默默删改。年度正文上限65536字符，桥接单次60秒、每事件最多8次及120秒，零自动写重试。未知写入核对失败保留进度，维护者核对前不得重复写入；跨设备编辑无原子锁，冲突/读回失败明确报告。

`npm run test:dopl`、`npm run demo:dopl` 使用合成飞书/Notes边界；真实 Notes 专用合成验收（**明确授权后**）：

```bash
npm run verify:dopl -- --write-synthetic --account '指定账户' --folder '指定文件夹' --allow-create --date 2026-10-06
```

该脚本会注册/确认并写入当天一条“合成验收”心得，保留私有状态及笔记，不自动删除测试记录；已有当天条目则停止，绝不替换。`--state-dir` 可选专用私有目录，`--note-id` 可选已有年度ID。它使用真实Notes、合成飞书消息，不发送真实飞书，不等于用户飞书闭环。当前交付与限制见 [F614验收记录](docs/deployment/f614-2026-10-06.md)。

2026-10-06已部署到本机现有飞书入口，iCloud/Notes的2026-DOPL已新建并按真实ID配置；真实Notes合成保存/读回/重启/重投验收通过，验收条目已受控清理，年度笔记可供用户填写。2026-10-07用户真实飞书注册/回答/确认保存验收通过；已只读核对原文一致、当天一条及pending为空。


## F614/T02：同日合并、替换与显式日期补记

已有当天心得时，`小婕 review 每日心得`展示原文。回复**当前已有条目回执**`合并`或`替换`，再回复问题提供原文，核对完整草案后回复`确认保存`。合并保留旧原文、换行追加你的补充；如需重写整段，选择替换提供完整新稿。选择、问题和草案都可用`小婕 review 续接`恢复，`取消`不写入。

补记用`小婕 review 补记 2026-10-01`，明确完整日期；相对日期、缺失、非法和未来日期不猜测。若该日期已有心得，进入同一合并/替换流程。发生人工编辑冲突，保留草案并提示重新发起原明确日期。旧回执/旧草案不能确认较新内容。

确认修订后当天仍只有一条`MMDD-心得`；年度笔记末尾的“修订历史 YYYY-MM-DD（合并/替换）”保存每版旧原文。只修改有可信结束标记的DOPL条目；无边界手工条目或重复日期须先维护核对。年度替换使用原文排版并保留正文与原生标签，不承诺保留富文本样式。复杂/共享/附件笔记沿用桥接限制。

跨年补记在私有`review`配置中增加明确的已有ID（账户/文件夹沿用基础绑定）：

```json
"annualNotes": {
  "2025": { "noteId": "该年度现有2025-DOPL的真实ID" }
}
```

额外年度最多20个，不能重复基础`year`，不会自动创建其他年份或按同名猜测目标。撤销年度配置阻止后续读取/确认，已绑定年度不可静默改ID。当前真实部署只配置2026；其他年份要先明确已有目标。合并后完整条目上限4000 Unicode字符；历史也计入年度容量，调用/超时/重投和未知结果核对预算沿用T01。零模型，仍是手动发起。

检查：`npm run test:dopl`（含macOS原生目标校验）、`npm run demo:dopl-revision`。真实Notes合成验证需已有授权和明确未使用的过去日期：

```bash
npm run verify:dopl-revision -- --write-synthetic --account '指定账户' --folder '指定文件夹' --note-id '真实年度ID' --date 2026-01-01 --state-dir 'runtime/专用私有验证目录'
```

脚本先备份私有快照，在该日期完成补记、合并、替换、重启/重投，核对一条当前记录和两版历史；完整正文仍是已核验结果时恢复原正文与标签。当天已记录立即停止；未知/冲突停止并保留状态，不能自动重新写入或清理。它使用合成飞书，不发送真实飞书；用户真实修订确认仍需单独验收。[T02规格](.scratch/f614-dopl/t02-spec.md)、[验收记录](docs/deployment/f614-t02-2026-10-07.md)。

# 06：OpenClaw 飞书接入插件与安装交付

Status: ready-for-agent
State: done
Blocked by: 04、05（已完成）
Spec: [首版规格](../spec.md)

## 范围调整

2026-09-27 用户明确要求：“那你先完成 06，然后我交给另外一个 agent 去完成安装和调试，那个 agent 是管理我的 openclaw 的 agent 的”。因此本任务完成标准调整为接入代码、安装包、离线验收及交接；运行网关安装和真实飞书验收由管理 agent 接续。原始真实闭环目标保留在任务拆分和下方清单，不以模拟勾选真实验收。

**交付：** `personal-gtd` OpenClaw 插件，在可信飞书消息入口核对原消息、执行持久化收集、发准确回执；附私有配置模板、恢复命令及安装调试交接。

## 开发交付验收

- [x] 核对本机 OpenClaw/飞书 2026.9.6 SDK，使用 `reply_dispatch`；隔离配置中实际加载、注册 hook/service。
- [x] 原消息 API 核对 ID、发送者、会话、原始类型/原文/创建时间/父消息；代码限制账户、入口 agent、用户及会话。
- [x] 收集、裸链接确认、提醒澄清、未激活、类型拒收、身份不一致、编辑消息和取消请求均有公开边界测试。
- [x] 回执真实 message_id 与原请求持久关联；重启和连续追问仍定位同一事项。
- [x] 重投只创建一次；Apple 成功后响应丢失先核对；回执发送未知时停止重发。
- [x] 有界队列、事件容量、网络/模型超时及共享费用账本；本轮无付费调用。
- [x] 交付插件清单、配置模板、本地安装包、恢复入口、安装与回滚说明。
- [x] 执行完整检查和合成演示，按规范/需求两个维度顺序审查；提交仅包含本任务文件。

## 安装方继续验收

详见 [管理 agent 交接](../../../docs/integration/openclaw-handoff.md)。

- [ ] 安装/启用到实际网关，核对授权用户与聊天 ID、已解析凭据及实际网关 Apple 权限。
- [ ] 从真实飞书收集/设置提醒/回复澄清，实际定位 Apple 条目并核对回执和去重。
- [ ] 实测链路容量、延迟和失败率；确认后续运行预算。
- [ ] 按真实证据回填首版整体验收。本任务 done 仅表示用户指定的代码与安装交付完成。

## Verification

开发基准：`607800834e9c72715fe3f3bf0179a72fda5c0c57`。Node 24.21.0，macOS 26.2。

- `npm run check`：通过（语法检查，不是类型检查）。
- `npm test`：71/71 通过，包含 15 条新增飞书 HTTP/收集/OpenClaw 接口测试；外部服务采用替身，没有真实网络写入。
- `npm run demo:feishu`：30 条合成事件 + 1 次重投 → 20 条事项、30 条回执；15 collected、5 awaiting_confirmation、5 collected_awaiting_time、5 reminder_set。一次本地测量 p50 1.41 ms / p95 3.91 ms，仅为模拟服务与本机 SQLite 耗时。
- `npm run plugin:validate`：临时 OpenClaw 状态目录，doctor ok；实际 `status: loaded`、typed hook `reply_dispatch`、service `personal-gtd`。真实网关未改动。
- `npm run openclaw:check -- --agent gtd`：Google Gemini 模型与 Apple helper/config 已存在；`entryConfigured: false`、`captureEnabled: false`，真实安装未执行。
- `npm pack --pack-destination dist`：生成 `dist/personal-gtd-0.1.0.tgz`，54 个文件；核对没有 runtime、凭据、日志、数据库或 node_modules。
- 独立临时目录解包后 `npm ci --ignore-scripts --offline` 和插件入口导入通过；包使用 `npm-shrinkwrap.json` 保留完整依赖锁定。
- `git diff --check`：通过。

最初尝试 `openclaw plugins validate` 返回缺少 tool/feature authoring metadata。核对该版本源码后确认命令仅适用于工具/feature 插件，改用隔离 doctor + runtime inspect 验证本 hook/service 插件；没有伪造工具元数据。

### 顺序审查

规范审查：业务、HTTP 传输、OpenClaw 装配分离，无新增 npm 依赖；模板无凭据，运行日志不输出正文；使用真实外部返回 ID；预算和失败恢复由代码执行。修正了宿主上下文不可整体 structuredClone 的问题，只投影明确来源字段；补足入队限制、权限校验及取消信号传播。

需求审查：保留原文和一句建议、统一 Inbox、链接不读取全文、不自动写 Wiki；裸链接确认、直接回复机器人补时间、跨重启单项更新有证据。飞书富文本/转写不得冒充原始文本，因此增加按 ID 查询原消息。宿主拒绝发送或重定向时不执行写入。无法证明回执发送结果时保守停发，不声称“必达”或“任意故障恰好一次”。独立解包发现 npm 默认排除 package-lock，已改为随包分发的 npm-shrinkwrap（依赖版本未变），实测安装和入口导入通过。没有待修复的阻塞性代码审查发现。

### 已知限制

- 实际 Feishu HTTP、插件到网关权限、完整真实链路尚未测试；不等于线上可用。
- 仅验证本机 OpenClaw/飞书 2026.9.6；宿主接口升级、Lark 域、商店应用、多机/网络目录不在本版。
- 回执响应丢失且没有保存返回 ID 时需人工核对；没有未知结果自动解除工具。
- 记录最多 1000 个来源事件；满额停止接收，本版没有自动归档/清理工具。不能删库或更换状态目录绕过重复写入保护。
- 原始“首版真实测量与全部验收”未完成，明确移交安装方。

## Comments

原任务目标与依赖保留于 `ticket-plan.md`；本次用户范围调整优先。不创建其他 Codex 对话，不代发给其他 agent，不部署到运行网关。交接由用户自行转交。

本任务按 implement 约定保留本地版本提交；未推送远端。任务开始前的 README 共享运行状态段落与跨项目协议快照修改保留，不纳入本任务提交。

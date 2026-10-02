# Apple 接入（04）

已在 macOS 26.2、Apple Swift 6.3.3、Node 24.21.0 验证。使用系统 EventKit，不需要另外安装提醒事项 CLI；本机虽安装了 OpenClaw 的 apple-reminders 技能，但缺少它依赖的 remindctl，且本项目需要操作标识核对、原文容量和账户绑定。

## 安装和启动

在仓库根目录：

```bash
npm ci --ignore-scripts
npm run build:apple
printf '%s' '{"command":"authorize"}' | runtime/bin/pgtd-reminders
node deploy/apple-setup.js
npm run start:apple -- --config runtime/apple/config.json --state-dir runtime/apple
```

首次授权需在系统弹窗允许提醒事项访问。setup 只读取列表元数据并绑定系统默认账户；有且只有一个 Inbox 时保存它的真实 ID，无 Inbox 时首次收集创建，同名多个则停止。已有配置不会被 setup 覆盖。更换运行应用或重新签名后可能需要再次授权。

每行输入与本地演示相同的规范化 JSON 事件，结果包含真实 Apple ID。当前命令使用模拟分析器，回执明确标记“Apple；分析模拟”。配置中的 demo-user/demo-chat 只用于本机验收，不能用于飞书身份鉴别。Ctrl-D 结束。

恢复：

```bash
npm run start:apple -- --config runtime/apple/config.json --state-dir runtime/apple --recover
```

不要换目录或删除日志后重投同一请求。运行目录保存私有配置和进度，禁止提交 Git。

## 写入和核对

- 列表绑定账户 ID 和列表 ID；项目只创建 Inbox，不提供删除、完成或批量修改工具。
- 创建时在 Apple 条目的 URL 字段保存 `pgtd://capture/<operationId>`，原文备注不混入恢复标记。提醒更新标识保存在 URL 查询参数中，与提醒字段一起提交。
- 设置 dueDateComponents 和绝对日期 EKAlarm；UTC 时间与指定时区分别校验。过去时间不会直接写入。
- 结果未知时按操作标识或原对象 ID 核对；找不到标识、事项被移走、权限拒绝、同步状态不明时停止写入。EventKit 不提供服务端幂等键，**不能把“没查到”当作“从未写入”**，因此真实适配器不会像模拟服务那样返回可重试的 absent。
- 创建列表后响应丢失时，仅在绑定账户中存在唯一 Inbox 才复用该列表；多个候选不猜测。
- 创建标记和写入结果不是跨设备事务保证。本实现支持同一操作日志的单进程使用，不支持多个独立部署同时接收同一请求。
- 读取正文只针对本工具创建的事项 ID；操作核对在绑定列表读取标记。系统 EventKit 授予完整提醒事项权限，应用代码将操作限制在已选账户/列表。
- 手动移动到 Wiki 后不自动更新该条目的时间；可按原 ID 读取移动结果。不会抓取文章或写入 Wiki。

## 2026-09-27 真实验收

用户授权使用系统默认账户 Inbox。真实创建三条带“PGTD 测试”的合成事项：

1. 8000 Unicode 字符原文，备注逐字读回一致。
2. 上海时间 17:56 的提醒：字段读回一致；用户确认收到了系统通知。
3. example.org 合成链接：用户手动移到 Wiki 列表，原事项 ID 仍有效，读取位置确认已移动。

同一事件再次处理返回原 ID，没有新增条目。既有 Inbox 被绑定复用；**真实环境的“无 Inbox 时新建”分支未触发**，不删除用户列表来制造测试条件。未知结果与权限拒绝通过外部进程边界故障测试验证；真实响应丢失和 iCloud 同步冲突未人为制造。

合成条目保留供用户检查，本程序未删除。`deploy/verify-apple.js --write-synthetic` 会真实写入三条样例，仅用于首次验收；事件 ID 固定，重跑时不会默默覆盖此前请求。

参考：[Apple EventKit 访问权限](https://developer.apple.com/documentation/eventkit/accessing-the-event-store)、[EKEventStore](https://developer.apple.com/documentation/eventkit/ekeventstore)。

## F108/T01 只读查询增量（2026-10-02）

新增 helper `queryTasks` 只读取已绑定 source/list 的未完成事项，包含人工创建且没有 PGTD 标记的事项；只返回标题、完成状态及真实引用，不返回备注。此范围不同于历史 `getItem` 的 PGTD 标记限制，写入/提醒核对仍沿用原限制。无绑定返回候选供配置，已有绑定不允许换目标；只读列表不要求可写。

`npm run verify:query -- --read-inbox --config /absolute/private/config.json` 需要明确目标读取授权及已编译新版 helper。只输出范围、数量和引用，不发送飞书、不写 Apple、不使用付费模型或修改适配器数据库。真实字段/权限/同步及飞书闭环本轮未测，Swift类型检查和合成桥接不代替真实验收。代码与可执行验证入口已交付，本轮未重新编译替换运行 helper、重启网关或变更现有权限。

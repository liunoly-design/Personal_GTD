# 给 OpenClaw 管理 agent：PGTD 安装与调试交接

## 目标与现状

安装接续记录：[2026-09-27 本机安装状态](installation-2026-09-27.md)。已链接安装、配置并热加载；真实验收等待授权用户发送首条飞书消息。下文保留原始开发交接时的事实与验收要求。

用户要求：开发 agent 完成 06，你负责安装到现有 OpenClaw 并调试。代码位于 `/Users/mac/Documents/personal_OS/Personal-GTD`。请保留现有小婕、gtd、wiki agent 及其分工，安装 `personal-gtd` 插件接通“小婕 GTD”收集入口。

已完成：01–05 的业务、恢复、真实 Apple 和 Gemini；06 的飞书 HTTP 适配、OpenClaw hook、持久化回执与回复关联、离线测试和隔离宿主加载。未完成：运行网关安装、真实飞书→Apple→回执闭环、真实延迟/容量测量。本轮未发送飞书消息、未新增付费调用、未修改运行网关。

本机真实 Apple 验收：默认账户 Inbox 写入、8000 字原文读回、系统通知用户确认收到；用户把链接事项手动移到 `Wiki`，已按同一对象 ID 核对。已有 Inbox，因此“没有 Inbox 时创建”的真实分支尚未验证。模型沿用 `google/gemini-flash-latest`；05 实际返回 `gemini-3.8-flash`，25 次已计费调用，约 0.02564475 USD。**用户此前只批准本次测试累计 1 元，不是长期无限调用授权。**

## 1. 先核对，不覆盖现有配置

在仓库运行：

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run demo:feishu
npm run plugin:validate
npm run openclaw:check -- --agent gtd
```

参考安装版本：OpenClaw 2026.9.6、飞书插件 2026.9.6、Node 24.21.0、macOS 26.2。插件校验使用临时配置，不等于真实网关已加载。请先查看现有配置和路由，备份将修改的字段；不要输出凭据或完整私人配置。

确认飞书消息仍路由至 `xiaojie`，`gtd` 有一个可用 Google 凭据 profile。插件直接执行受限收集链，不依赖小婕再次调用 gtd 子 agent；成功接管后不再触发普通模型回复。普通聊天仍走原流程。

## 2. 准备私有配置与 helper

通用模板：

- `config/openclaw-plugin-config.json`：插件配置，默认 `enabled: false`。
- `config/feishu-runtime-config.json`：Apple、Google 和预算配置。

将模板复制到本机私有位置（如仓库忽略的 `runtime/feishu/`），目录 0700、文件 0600，并填入：

| 字段 | 如何取得 |
| --- | --- |
| accountId | 现有飞书账户 ID，当前预期 `default`，须核实 |
| entryAgentId | 实际接收飞书的入口 agent，当前预期 `xiaojie` |
| allowedSenderIds | 明确授权使用者的飞书 `ou_...` open_id，不能用显示名 |
| allowedConversationIds | 实际聊天的 `oc_...` chat_id；私聊也填写 chat_id，不能填用户 ID |
| stateDir | 固定的绝对目录，建议 `runtime/feishu/state`；不得与运行中的 CLI 共用，不得删除后重试 |
| runtimeConfigPath | 私有运行配置文件的绝对路径 |
| sourceId / listId | 从本机 `runtime/apple/config.json` 复用已绑定默认账户 Inbox 的真实 ID |
| usagePath | 复用 `runtime/model/usage.sqlite` 的绝对路径，保留此前费用，不新建账本重置预算 |
| model | 沿用 Gemini 配置与已有累计预算；模板金额只是配置示例，不是新的授权 |

`authAgent` 保持 `gtd`。凭据通过 OpenClaw SDK 读取，不复制 Google key。飞书复用宿主已解析的 `channels.feishu` / `accounts[accountId]` 的 `appId`、`appSecret`；仅支持飞书企业自建应用、`feishu` 域。若宿主仍给出 SecretRef 对象而非解析后字符串，应先用现有凭据管理流程解决，不能把对象当密钥。不要把密钥写入 PGTD 模板或提交 Git。

本机已有 `runtime/bin/pgtd-reminders`。新安装副本或新的 Mac 才需要：

```bash
npm run build:apple
```

helper 路径相对插件代码，复制安装和链接安装的路径不同。Apple 授权属于实际调用进程链：终端测试已授权不保证 launchd 网关有权限。请在网关运行身份完成授权验收。详见 [Apple 接入](apple.md)，不要直接重跑已经执行过的一次性合成写入脚本。

## 3. 安装并按范围启用

本机建议链接当前仓库，避免复制后 helper 路径变化：

```bash
openclaw plugins install --link /Users/mac/Documents/personal_OS/Personal-GTD
```

若安装器要求确认来源或能力，按既有管理规范审核；不要使用危险跳过参数。将已填好的插件配置合并到：

```json
{
  "plugins": {
    "entries": {
      "personal-gtd": {
        "enabled": true,
        "config": {
          "enabled": true,
          "accountId": "default",
          "entryAgentId": "xiaojie",
          "allowedSenderIds": ["ou_REPLACE_ME"],
          "allowedConversationIds": ["oc_REPLACE_ME"],
          "activation": "小婕 GTD",
          "stateDir": "/ABSOLUTE/PRIVATE/pgtd-feishu-state",
          "runtimeConfigPath": "/ABSOLUTE/PRIVATE/pgtd-feishu-runtime.json"
        }
      }
    }
  }
}
```

这是需要合并的局部片段，不能替换整个配置。保留既有 `plugins.allow` 并按需追加 `personal-gtd`。不要改飞书绑定到 gtd，也不要扩大 agent 的 shell/Apple 工具权限。启用后按现有管理流程重新加载插件或重启网关，检查：

```bash
openclaw plugins inspect personal-gtd --runtime --json
openclaw plugins doctor --json
```

应显示 `status: loaded`、typed hook `reply_dispatch`、service `personal-gtd`。CLI 能加载不等于运行网关已经重载，也不等于下方真实链路通过。

另有 `npm pack --pack-destination dist` 可生成本地安装包；目标安装目录需运行 `npm ci --ignore-scripts` 并编译自己的 helper。依赖由随包的 `npm-shrinkwrap.json` 锁定，已在独立目录解包安装并导入入口验证。包不包含私有配置、数据库、日志、Google/飞书凭据或已授权二进制。不要把整个 runtime 目录打包转移。

## 4. 真实验收（待你执行）

先核实剩余共享测试预算和允许的合成测试接收范围。此前授权上限为累计 1 元；需要提高预算或开始长期使用时，向用户确认。不要为了 30 条性能样本越过剩余额度。

- [ ] 普通聊天不收集；未经授权的用户、其他会话/账户/agent 不写 Apple。
- [ ] `小婕 GTD，收集：PGTD 飞书安装验收` → Inbox 恰有一条，备注保留完整原文和一句“小婕的建议”，回执准确。
- [ ] `小婕 GTD，收集：https://example.org/article` → 仅存链接；不读取网页，不自动写 Wiki 或移动事项。
- [ ] `小婕 GTD，https://example.org/article` → 先询问；直接回复机器人回执“确认”后只创建一次。
- [ ] 提醒时间明确 → 同一 Inbox 事项设置时间；缺失/过去时间 → 无提醒，询问新时间；直接回复回执补时间只更新原条目。
- [ ] 更换激活词并重启后新词生效；已有待澄清事项仍按消息 ID 关联。
- [ ] 首版仅接受原始 `text` 类型。带激活指令的富文本 post、音频、图片或卡片被明确拒收，不能靠转写绕过。纯媒体没有激活或已知回复关联时仍走原 agent 流程。建议先用私聊纯文本测试，激活词放在正文起始，不在它前面放 @ 提及或引文。
- [ ] 编辑/删除消息、原消息查询无权限、身份不一致 → 不新增或更新事项。
- [ ] 相同原始事件重投、重启恢复不增项；平台可能先行去重，应同时用本地恢复入口核对持久化结果，不能通过新 message_id 假装重投。
- [ ] 回执故障不引起 Apple 重复写入；响应未知不盲目重发。不同来源消息内容相同仍是不同收集请求。
- [ ] 记录实际 ID 对应关系、状态、费用和延迟，不提交正文、真实 ID、日志或数据库。

真实容量、端到端 p50/p95、失败率尚未测。离线样本 30 条，20 条事项；预算允许时再测真实样本，并注明模型版本、网络和机器条件。当前上限：8000 Unicode 字符、每事件一次模型调用/15 秒、每 HTTP 10 秒/无重试/128 KiB 响应、外部操作 20 秒、排队 16、持久化来源事件 1000。满额停止接收，不自动清日志或重置预算。

## 5. 排障与恢复

日志只输出状态、delivery、延迟、token 和估算费用，不输出原文或凭据。

| 现象 | 先核对 |
| --- | --- |
| 仍由小婕普通聊天回答 | 网关是否加载最新插件、入口 agent/account/白名单和激活词是否匹配、宿主是否限制 runtime takeover；`CommandAuthorized` 是控制命令标志，自然语言通常为 false，不能用它作为 PGTD 业务授权 |
| 未确认完成 | 原消息查询权限、原始类型/身份、私有路径、Feishu 已解析凭据、Apple 授权；不能假定没有写入 |
| 已收集但分析未完成 | Google profile、模型预算/限流/超时，Apple 原文已保存，不要重新发送收集 |
| delivery=pending | 回执发送结果未知；Apple 可能已成功，先核对实际事项与飞书回执 |
| recovery_required | 先恢复未完成事件，不能用新消息绕过 |
| 状态目录 busy | 同一目录已经由另一个进程持有；先停止原持有进程，不删 owner 记录 |

恢复是显式操作，没有后台定时重试。先暂停插件并停止持有该状态目录的运行实例，保留数据库；在本地运行：

```bash
npm run recover:feishu -- --config /ABSOLUTE/PRIVATE/openclaw-plugin-config.json --host-config /Users/mac/.openclaw/openclaw.json --run
```

参数中的第一个文件是完整插件 `config` 对象（非整个 OpenClaw 配置）。这个命令可能补做 Apple 操作或发回执，须在已授权恢复范围内执行；与在线插件不能同时运行。独立 CLI 的宿主配置需提供已解析字符串凭据；若使用 SecretRef，交由现有凭据管理方式处理，不输出秘密。

恢复先核对 Apple 的真实操作标记/ID，不重新分析已经缓存的消息。回执已确认发送只复用记录；已写发送意图却丢失响应时没有可按 uuid 查询的可靠接口，本版保持 unknown，人工核对后由管理方决定后续处理。`uuid` 只是发送请求的附加幂等字段，本版不依赖其时间窗保证跨重启重发安全。不得直接把 unknown 改成 absent、清库、换目录来解除阻塞。

取消请求会阻止后续写入；如果取消/超时发生在外部系统已经收到写入之后，仍须核对实际结果。关闭插件不撤销已完成的 Apple 写入。

## 6. 回滚与交付记录

先禁用 `personal-gtd` 并按现有管理方式重载/重启。保留状态目录和共享预算账本，不删除已收集的事项，不还原整个 OpenClaw 配置覆盖其他 agent 的更新。解除插件链接不会删除 Apple 数据。

安装完成后记录：安装来源/提交、实际插件版本、hook 加载证据、合成验收结果、模型累计费用、延迟测量及未通过项。回填本项目首版验收清单；真实项未通过前不要宣称首版全部验收完成。

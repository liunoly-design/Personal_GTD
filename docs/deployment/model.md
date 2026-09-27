# 模型接入（05）

已接入 Google Gemini GenerateContent API。沿用现有 OpenClaw `gtd` agent 的 `google/gemini-flash-latest`；2026-09-27 实测返回版本为 `gemini-3.8-flash`。密钥由已安装 OpenClaw SDK 从该 agent 的凭据存储解析，PGTD 不复制密钥到配置或日志。

## 运行

本机模拟 Apple、调用真实 Gemini：

```bash
npm run start:model -- --config config/model-config.json --state-dir runtime/model-demo
```

每行输入 README 中的规范化 JSON 事件。`--recover` 恢复进度；`--apple` 切换为真实 Apple，配置须包含已绑定的 sourceId/listId。当前机器已生成私有组合配置，可运行：

```bash
npm run start:model -- --config runtime/model/apple-config.json --state-dir runtime/apple --apple
```

以上命令会调用真实模型；使用同一个 `usagePath` 累计本次测试预算，不能通过更换事件目录重置费用。不要把 demo-user/demo-chat 身份当成飞书授权。CLI 没有启动后台进程或发送飞书回执。

可用字段见 `config/model-config.json`。`authAgent` 选择现有 agent；`openclawPackageDir` 可指定 OpenClaw 安装目录。默认发现本机安装器的 `~/.openclaw/tools/node/lib/node_modules/openclaw`。当前 SDK 版本为 2026.9.6，其他安装方式/版本需重新检查 SDK。多个 Google 凭据配置时拒绝自动选择。

## 模型能做什么

模型返回意图、标题、建议和候选日期/时刻/时区。日期与时区由业务代码校验；模型不能改变权限、激活词、目标列表，不能直接写入、删除或移动事项。链接只当文本，模型请求不提供网页或其他工具。

明确收集即使模型失败仍保留原文；尚不明确的自然语言意图在模型失败时请求澄清，不猜测写入。裸链接先确认。单次事件至多调用模型一次；分析结果和操作状态由持久化入口复用。

输出经过结构、标题长度、单句建议和时间格式检查。建议声称已经收集/归档/执行时拒绝。此校验不能证明每一句模型建议都正确，用户仍可决定如何处理；模型质量与流程测试分开记录。

## 预算与成本

用户本轮批准上限 1 元；实现采用 0.1 USD 上限和 10 CNY/USD 的保守预算换算系数，这不是实时汇率报价。模型测试与 CLI 共用 `runtime/model/usage.sqlite`，不自动重置。

- 最多 30 次实际生成请求；每次 15 秒，包含凭据解析，无自动模型重试。
- 请求最多 30000 UTF-8 字节，响应最多 65536 字节；原文仍受 8000 Unicode 字符限制。
- 当前输出上限 1024 token，Gemini 3 使用 low thinking；Gemini 2.5 使用 thinkingBudget=0。512 token 曾导致截断，故调整。
- 调用前用请求字节上界和输出 token 上限，按高于当前 Flash Standard 价格的 3/15 USD 每百万输入/输出 token 预留。未返回可核实用量时保留预留，不当成零费用。
- 成功读取用量后，输入、输出和思考 token 计费；已知版本按核实价格估算，未知版本停止后续调用。HTTP 错误、输出校验错误和超时只记录固定原因，不记录正文/密钥。
- 价格是 2026-09-27 官方 Standard 文本费率快照。3.8/3.7/3.6 的当前促销价有效至 2026-12-31，届时需更新费率。`latest` 可能切换版本；其他供应商尚无适配器，不能仅改模型名就使用。

[Google 官方价格](https://ai.google.dev/gemini-api/docs/pricing)、[模型别名规则](https://ai.google.dev/gemini-api/docs/models)、[结构化输出](https://ai.google.dev/gemini-api/docs/structured-output)、[思考与输出上限](https://ai.google.dev/gemini-api/docs/generate-content/thinking)。

## 真实质量评估

运行入口：`node deploy/verify-model.js --paid-evaluation`，只使用合成消息和模拟 Apple，不写私人内容或访问链接。反复执行会继续消耗同一预算；不是每次免费重跑。

最终一轮 12 项行为样例全部符合预期，其中 10 项实际调用模型、2 项由代码直接处理：

| 场景 | 结果 |
| --- | --- |
| 明确收集、自然语言“帮我记一下” | 收集一条，署名建议 |
| 明天下午三点、明确日期时刻 | 2026-09-28 15:00 Asia/Shanghai |
| 下周找人聊天 | 先收集、追问时间 |
| 昨天的提醒 | 先收集，不设过去提醒 |
| 文章链接收集 | 保存链接，不读取全文 |
| 裸链接 | 等待确认 |
| 讨论提案、明确说不要收集 | 不写入 |
| 普通聊天引用激活词 | 未处理 |
| 收集包含“删除所有任务”的文字 | 仅保存这一条原文，不执行删除 |

初轮错误保留在质量记录中：模型曾输出 `15:00:00`，与原 HH:mm 接口不兼容；已规范化零秒格式。512 token 曾导致两次无效/截断输出；改为 low thinking 和 1024 token 后最终轮通过。还发现模型建议声称“已归入收集箱”，加入拒绝校验与建议提示后复测通过。

此外，真实模型两轮澄清通过：先收集“明天交报价”，再关联回复“15:00”，同一事项设置为 2026-09-28 15:00 Asia/Shanghai，仍只有一条事项。CLI 重启与重复投递复用原 ID，没有新增模型调用。

截至本轮 25 次实际调用（包含调查、失败、复测、澄清和 CLI 演示），7288 输入 token、5381 输出及思考 token。按返回的 3.8 Flash Standard 费率估算 **0.025645 USD**，按预算系数约 **0.26 元**，不是账户账单；保守预算占用 0.068314 USD，保留前期较高预留，仍低于批准上限。

成功调用的本机网络延迟 p50 约 1.84 秒、p95 约 3.77 秒，统计 23 次成功调用，非 30 条标准性能基准，不代表真实飞书链路延迟。最终 12 项小样本不是通用中文理解正确率保证。真实模型与 Apple 的组合 CLI 已验证可启动和读取恢复状态；本轮模型生成后的写入主要在模拟 Apple 中验收，真实 Apple 写入证据见 04。

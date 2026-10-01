# 01：用单项变更代替已有草案的全稿模型输出

Status: ready-for-agent
State: done
Spec: [规格](../spec.md)
基准：`b27999e8177943c576db862813687245e5b69ebc`。

## 诊断与 TDD

用户明确的单 KR 回复仍连续被拒绝。只读记录显示当前讨论为 okr，有一个 O、零 KR，最近分析原因均为 MULTIPLE_OKR_ITEMS；仅记录失败码，没有原始失败模型草案，不能断言每条失败都只由空行引起。

在公开结构接口构造“已有O后加一个KR，中间一个Markdown空行”样例，`node --test --test-name-pattern='末尾空行' test/okr-structure.test.js` 先失败为 MULTIPLE_OKR_ITEMS，归一项末空白后通过。完整原文仍保留，真正 O 与 KR 同时实质变化仍拒绝。

在公开 HTTP 模型边界构造唯一 change 返回，`node --test --test-name-pattern='已有草案的模型只返回' test/okr-guidance.test.js` 在旧实现 draft=null 时失败，新合同由代码组装完整稿后通过。再通过可信飞书公开入口与真实 Gemini 适配器、模拟 HTTP/Notes 验证完整路径。没有通过删除多项校验来让测试通过。

## 实现与顺序审查

- 规范：单项组装放在现有结构模块；模型适配器归一到原公开 guidance 输出，无新增依赖、框架、状态迁移或额外模型调用。保留未修改条目、周期与父节点，敏感数据不提交。
- 需求：schema 只允许一个 change 对象/null，代码仍验证 ID、父节点、片段只有一个条目、3–5 KR、删除边界及实际一项变化。首次无稿的初始化继续原协议；旧成功输出缓存不重算，新输入依然去重。不扩大确认、业务对象写入或用户权限。
- Schema 使用现有 responseJsonSchema 接口；nullable object 及 required/additionalProperties 依据 [Google 官方结构输出](https://ai.google.dev/gemini-api/docs/generate-content/structured-output?hl=en)核对，语义仍由代码验证。没有将 schema 能力等同于真实请求已验收。

## Verification

| 命令/观察 | 结果 |
| --- | --- |
| `npm run check` | JS 语法检查通过 |
| `npm test` | 158/158 通过，0 失败/跳过 |
| `npm run test:okr` | 77/77 通过 |
| `node --test test/okr-structure.test.js test/okr-guidance.test.js test/feishu.test.js` | 48/48 通过 |
| `npm run demo:okr-finalize` | 定稿前后笔记数量、同稿复用、历史及标签通过，模拟付费调用 0 |
| 两次独立真实模型合成探针 | 均 network_or_timeout，未取得可用草案。使用已授权原账本，两次均留存记录/未知费用预留；第二次后停止，不无界重试 |
| 账本 | 探针结束时共 61 次，上限仍 65，金额上限 5 USD；没有清账本或修改授权上限 |

合成探针只使用独立合成学习目标，不重投用户私人消息，不访问或写入真实 Apple/Notes，不发飞书消息。临时 probe.mjs 删除，账本记录保留。原消息仍复用旧失败回执；实际效果需下一条新回复验证。提交、部署加载与连通结果见交付和部署续记，不推送。当前代码/模拟验收完成，真实质量未验证。

网关已重启并核对 running/RPC 连接成功、飞书 running/probe.ok=true。`git diff --check` 及暂存区检查通过；本任务本地可恢复提交，不推送。

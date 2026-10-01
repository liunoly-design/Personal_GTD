# 01：解释 OKR 多项输出被拒绝并加强逐项提示

Status: ready-for-agent
State: done
Spec: [规格](../spec.md)
基准：c6a7b5b。

## 诊断证据

只读核对共享账本：已从 55 增至 56 次、上限 65，金额上限 5 USD；最新模型调用 done、约 7478ms。对应 OKR 日志结果 okr_guidance_failed，原因 MULTIPLE_OKR_ITEMS，无 pending/publication 写入。用户新消息的模型响应已成功，失败来自输出草案一次改变多个 O/KR；不是之前的额度故障。未读取或展示私人正文。

用本地 diagnosing-bugs 的公开入口合成反馈循环复现：`node --test --test-name-pattern='OKR 模型一次改动多项' test/feishu.test.js` 在旧回执缺少原因时失败，修复后通过。已有持久化失败码直接给出原因，省略付费重放及多轮猜测/埋点；没有为了复现重投私人请求。

## 实现与审查

原文仍保存；结构保护继续拒绝多项草案，阶段与草案不推进。回执及日志说明模型违反单项规则并指导新消息逐项继续。模型提示明确：多项用户输入不等于多项草案授权，其余保留为候选；完整输出逐字保留其他条目的措辞、标点、空白和顺序，必要时 draft=null 先确认选择。无新增模型调用/自动重试。

顺序审查规范与需求：公开边界测试验证原文、草案未应用及同事件调用复用；代码没有放宽确认/结构/预算门槛，没有新增依赖、私人测试数据或其他功能。提示词改善不等同于真实模型质量已通过。

## Verification

2026-10-01：受影响和完整检查、演示及部署结果在本轮交付中记录；本任务只主动执行合成测试及网关加载/连接检查，不触发新的付费模型分析或业务数据写入。保持用户原有未提交文档，提交范围仅此规格/issue、OKR 提示与失败回执代码、合成测试和本次部署文档续记；不推送。


实际结果：`npm run test:okr` 72/72，`npm test` 153/153，`npm run check` 语法检查通过；`npm run demo:okr-finalize` 确认前后篇数、复用定稿及保留历史通过，付费调用 0。公开入口红/绿测试均已实际运行。已使用 `openclaw gateway restart` 重载已授权网关；`gateway status --json` running/RPC 连接成功，`channels status --channel feishu --probe --json` running/probe.ok=true。没有重放旧私人消息，真实模型质量仍待用户下一条新回复验证。

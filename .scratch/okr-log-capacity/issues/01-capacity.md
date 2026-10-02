# 长日志容量阻塞

状态：完成（用户飞书续接验收待测）

已确认原因：真实 append 粘贴成功后 formatHeadings 检查 130 个标题超过 128。原生 HTML 32031 单位，也接近旧 32768 限额。read-only 核对 pending 原文和标记均存在。不是模型失败，不需要重新分析。

TDD：新增 40000 字符日志继续记录的公共接口回归，旧实现 CAPACITY_EXCEEDED；放大有限容量后通过。159/159 完整测试、npm run check、swiftc -typecheck、git diff --check 通过。

顺序审查：规范维度只修改当前容量与写前检查；需求维度保持原文、ID、去重、预算、两篇笔记，超限不滚动删除历史。写前检查标题与独立标签种类，避免对应限制在粘贴后才报告失败。原生 HTML 预留格式化开销，并限制响应大小。

真实恢复：停网关并将 OKR SQLite 备份到忽略目录；读回原文与 pending 标记、旧历史匹配；ensureTags 完成标题修复，正文逐字不变；原事件指纹验证后 openOkrSession.handle 返回 okr_guided，禁止调用模型的探针未触发，pending 清空。恢复过程中未发送飞书消息。

部署检查：网关新进程运行，RPC 检查通过；飞书 running=true、probe.ok=true、lastError=null。最大容量下的延迟尚未实测，60 秒超时保护保留。未推送远端。

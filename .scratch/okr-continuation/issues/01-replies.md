# 修复持续回复与质询续接

Status: ready-for-agent
State: done

规格：[spec](../spec.md)。

- [x] updated=true 且正文一致的同会话 OKR 普通回复可继续
- [x] 正文不同、同ID改文和确认指令保留保护
- [x] 连续15轮、原回执、重启、重投测试
- [x] 未形成草案时保存事实摘要与当前问题
- [x] 原失败回复恢复、检查、顺序审查、部署和本地提交

证据：[部署验收](../../../docs/deployment/okr-continuation.md)。真实新增飞书事件待用户验收，本地提交后不自动扩大调用额度。

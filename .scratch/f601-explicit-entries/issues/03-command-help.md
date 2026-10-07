# F601/T03 命令帮助

Feature: F601
Status: ready-for-agent
State: in-progress
Blocked by: none
Spec: ../help-spec.md
Baseline: b2beaf8a5dc2869bd78d863fc6cf4daf7c847709

直接发送“小婕 gtd”返回该模块菜单；统一“小婕 帮助”及精确模块帮助同义词展示实际已实现命令。帮助不创建任务、不读写Apple、不调用模型，不改变当前问答。

- [x] 空入口、统一/模块/旧别名与停用模块帮助
- [x] 精确匹配、显式收集帮助、权限/可信来源、重复/未知回执恢复
- [x] 帮助插入Review/本地待确认链接不改变原问答
- [x] 完整检查、模拟演示、顺序规范与需求审查
- [ ] 部署读回与远端SHA核对
- [ ] 用户发送新飞书消息看到菜单

## Verification

逐项红绿：空GTD、统一帮助、本地GTD菜单。完整测试318项；check、隔离plugin:validate、demo:help及demo:entries通过。统一菜单1036字符（Review-only配置），演示零模型/零业务adapter访问。

顺序审查（单agent，含未提交差异）：规范轴检查可信来源、受保护回执、原始问答及任务限定暂存，无阻塞发现；需求轴逐项核对精确菜单、停用模块、旧入口、问答续接和菜单内容，无阻塞发现。本地入口同步复用静态菜单，核心状态不改变；宿主hook保留白名单与发送策略。真实飞书菜单待新消息验收，旧消息重投沿用旧回执。

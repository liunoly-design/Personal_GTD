# 区分网关辅助功能与 Notes 自动化权限
Status: ready-for-agent
State: done

基准：2a99f90。用户报告“OKR 记录未确认完成。请检查备忘录访问权限。”

原因：实际网关通过 Notes 脚本读取后，AXIsProcessTrusted 返回 false；系统 TCC 请求主体为网关 node。旧助手把输入错误、应用不存在和辅助功能缺失都合并成 PERMISSION_DENIED，飞书误导用户检查 Notes 访问权限。

实现：输入错误、应用未运行、辅助功能缺失分别返回独立错误；飞书解释 ACCESSIBILITY_DENIED，保留自动化权限的单独指引。无权限时不写入 Notes，不回落到 Inbox。

验证：真实网关原消息已接管、错误回执已发送，系统权限日志定位 Accessibility 拒绝；公开飞书接口回归先失败后通过。完整123/123测试、npm run check、Swift编译通过。

顺序审查：权限由用户在 macOS 授予，无绕过；新错误码穿过助手、桥接、飞书三层，回归覆盖回执和零模型/Inbox写入。仅代码修复完成，真实成功验收仍等待用户开启网关 node 的辅助功能权限。

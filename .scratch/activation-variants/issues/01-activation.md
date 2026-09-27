# 01：触发词兼容开发交付

Status: ready-for-agent
State: done
Blocked by: 无
Spec: [规格](../spec.md)

基准提交：3221e61f571b67f49924d207ded9387735b3149a

- [x] 共用匹配逻辑，入口与正文截取使用实际匹配长度。
- [x] 大小写、无空格、多空格、全角空格与前导空白测试。
- [x] 非开头/扩展词及未授权消息不写入。
- [x] README 更新；单 agent 按规范和需求顺序检查本次差异，无阻塞发现。

## Verification

- node --test --test-name-pattern='激活词兼容' test/feishu.test.js：修改前失败（not_handled），修改后通过。
- npm run check：通过。
- npm test：77/77。
- npm run demo:feishu：30 条事件及一次重投，20 条事项、30 条回执；无真实写入及付费调用。
- git diff --check：通过。

## Comments

用户反馈 C 补时间成功；D 正确关联确认后回执成功。属于用户验收反馈，本次未独立读取 Apple。
下一项：由 OpenClaw 管理 agent 重载网关，用户发送“小婕 gtd，收集：大小写验收”并核对唯一事项。本次未重启共享网关。

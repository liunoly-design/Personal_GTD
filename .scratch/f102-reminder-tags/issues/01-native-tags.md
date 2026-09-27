# F102/T01：原生提醒事项标签验证

Feature: F102
Status: ready-for-agent
State: done
Blocked by: 无（按用户缩减后的界面验证范围关闭）
Spec: [spec](../spec.md)
Baseline: 4cf585194ce63ba8385148a57781c166ea8742f7

## 最新验收与范围调整

用户要求简单文档加原生标签供自己查看，停止快捷指令配置探索；原自动化反查、复杂映射及后台接入不再纳入本任务。原始要求见 [讨论记录](../discussion.md)。

- [x] 授权的单条合成事项已创建并保留，重复准备复用同一 ID。
- [x] 通过原生“添加标签”入口添加专用测试标签，标签菜单显示该事项已勾选。
- [x] 点击专用原生标签进入筛选视图，仅一个事项；标题和合成随机操作标识与原事项一致。
- [x] 独立 Node/osascript 验证进程断言标签筛选命中、标识一致，EventKit 返回 ID/列表/标题/备注均未改变。
- [x] 明确界面验证不等于后台自动标签接口；停止进一步配置。

私有证据：`runtime/reminder-tags/verification.json`，其中 nativeTagQueryOne、operationMarkerMatches、originalFieldsUnchanged 均为 true，shortcutVerified 为 false。真实 ID、截图/界面数据与运行脚本均未提交。

快捷指令草稿名为 `PGTD F102 - 未完成勿运行`，未运行、未部署；不将其作为可用功能。应用重启、同步冲突、自动打标签及双向关联未验收。

本次仅更新需求和验收记录，执行文档链接检查及 `git diff --check`；没有业务代码修改，不重跑或虚构标签业务测试。

## 以下为范围调整前的过程记录

## 原范围

仅 F102 的原生标签可行性验证；不开发生产关联、替代标签或 F103。研究与静态预检已完成，不等于真实功能验收完成。

## 验收

- [x] 公共 EventKit、Reminders/Notes 脚本接口及快捷指令官方能力证据
- [x] 可重复运行的只读预检命令、明确区分预检与真实验收
- [x] 真实写入范围确认
- [ ] 快捷指令配置
- [ ] 合成事项真实原生标签创建、读取和按标签查询
- [ ] 同一真实 ID、重复运行及目标映射可行性验证
- [ ] 记录真实权限、冲突与恢复限制后完成 F102

## Verification

- 本机 macOS 26.2，SDK 公开声明及两份系统脚本字典人工核对：没有标签字段；快捷指令官方说明存在标签支持，不能判定所有原生自动化不可行。
- `node deploy/probe-reminder-tags.js`：退出 0，inventory_complete；6 个资源的 tagDeclarations 均为空，liveTagVerification=not_run，Apple 用户数据读取/写入和模型调用均为 0。
- `shortcuts --help`、`shortcuts run --help`、`shortcuts sign --help`：有运行/查看/签名等能力，没有命令行导入动作。
- 系统辅助功能控制检查返回 false；未更改权限，未读取用户快捷指令。
- 真实验证：未执行；新增写入范围确认问题已发出，尚未收到回答。

- `npm run check && npm test`：语法检查通过，现有 88/88 测试通过；不表示真实标签功能通过。
- `npm run probe:tags`：完成 6 个资源清点，输出断言通过；文档本地链接与 `git diff --check` 通过。
- 本轮仅保存 F102 调查与诊断进度提交，未推送或部署。

## 顺序审查

Standards：仅增加诊断脚本及相关文档，不改变业务写入。无新增依赖、凭据、私人数据或运行数据库入 Git。静态只读诊断采用直接检查，不为它伪造业务 TDD 通过证据。

Spec：官方证据与本机接口分开；明确快捷指令候选路径，未将 API 缺口扩张为 Apple 全面不支持。真实读写、ID 与映射未验收，State 保持 blocked，未解除 F109 依赖。

## Comments

详细来源及人工配置检查单见 [调查与验证入口](../../../docs/deployment/reminder-tags.md)。本任务保留进度，待用户回复后在同一任务继续；不需要重做 F101。


### 授权后推进（2026-09-27）

用户回答“允许创建测试标签”，授权已记录，不再等待业务写入确认。已通过 Reminders JXA 核对 iCloud / Inbox 的账户与列表真实 ID，与现有 Apple 配置一致。

使用已有 EventKit 桥接创建一条 `PGTD F102 合成测试` 事项，写前保存意图，按真实 ID 读回标题、列表及合成原文；再次运行复用同一 ID。测试标签采用随机后缀，尚未写入。准备脚本及恢复状态保存在 Git 忽略的 `runtime/reminder-tags/`，不提交私人 ID。

仍待完成：快捷指令首次界面配置、原生标签添加/读回/查询。已请求用户开启 Codex 辅助功能或选择手动配置，并打开系统辅助功能设置页；没有修改系统授权设置。

补充真实定位证据：EventKit UUID 不能直接作为 JXA reminder ID 查询。本次通过合成原文中的随机操作标识在授权列表中唯一定位后，读取了该事项真实脚本 ID（`x-apple-reminder://` 前缀），与 EventKit ID 对应，并显示了这条事项。真实映射保存在私有状态；不将此前错误查询视为事项不存在。

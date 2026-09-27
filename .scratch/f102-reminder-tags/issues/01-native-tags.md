# F102/T01：原生提醒事项标签验证

Feature: F102
Status: ready-for-human
State: blocked
Blocked by: 真实合成写入范围确认；本机快捷指令配置与标签/ID 输出核验
Spec: [spec](../spec.md)
Baseline: 4cf585194ce63ba8385148a57781c166ea8742f7

## 范围

仅 F102 的原生标签可行性验证；不开发生产关联、替代标签或 F103。研究与静态预检已完成，不等于真实功能验收完成。

## 验收

- [x] 公共 EventKit、Reminders/Notes 脚本接口及快捷指令官方能力证据
- [x] 可重复运行的只读预检命令、明确区分预检与真实验收
- [ ] 真实写入范围确认及快捷指令配置
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

# F101/T01：备忘录合成验证路径

Feature: F101
Status: ready-for-agent
State: done
Blocked by: 无；用户已授权 iCloud / Notes 合成验证
Spec: [spec](../spec.md)
Baseline: eeb8497c1b15de8b5e1fa2323aaf646a92911a22

## 验收

- [x] 规格中的自动化行为测试与完整检查通过
- [x] 可运行命令、权限说明、失败恢复限制
- [x] 真实合成笔记创建、追加、读回及重启复用
- [x] 规范与需求顺序审查，更新状态并保留本任务提交

## Verification

已完成；命令与结果如下。

### 测试与真实验证

- TDD：创建/追加/重启路径先因缺失模块失败，再通过；创建响应丢失用例先观察到重复 2 条、修复后 1 条；追加未知及并行运行先失败再通过；读回丢失初始内容先失败再通过。
- `node --test test/notes.test.js`：10/10 通过，覆盖创建/追加未知、读取失败、人工编辑冲突、位置变化、笔记失效、并行保护及读回完整性。
- `npm run check && npm test`：语法检查通过，全套 88/88。
- `npm run demo:feishu`：30 个模拟事件、20 条模拟事项、30 条模拟回执，无真实写入与付费调用。
- `npm run plugin:validate`：隔离加载成功，doctorOk=true。
- `npm run verify:notes -- --write-synthetic --account iCloud --folder Notes`：真实首次 5 次 Apple 调用 / 4225 ms，独立进程复用 2 次 / 1544 ms，同一真实 ID。
- 真实补充断言：`find` 返回唯一标识与相同 ID；向 `append` 提供过期快照返回 CONFLICT；前后 HTML 一致，更新记录恰好一次。私有证据位于 `runtime/notes/verification.json`，不入 Git。
- 初始文件夹容量保护 200 在真实元数据计数 376 时触发；调整到 1000 后复用验证通过，未新增笔记。
- 限制：真实权限撤销、iCloud 多设备并发及进程被杀的 Notes 写入未知未实测；故障恢复使用外部边界合成替身。该工具不直接提供生产并发安全保证。

### 顺序审查

Standards：按根 AGENTS.md 与本地 code-review 规范检查全部新增文件及未提交差异。无新增依赖、无私人数据入 Git、单任务独立命令；写入意图先存、真实 ID 绑定、有界调用、单进程锁。无阻塞发现。

Spec：逐项对照 F101，已完成授权账户位置、合成笔记创建/定位、更新读回、重启及冲突限制。审查中补齐容量保护适用范围、读回初始记录完整性检查，并区分 UTF-16 长度和字节预算；修复后检查通过。未扩展 F102/F103 或部署权限。

交付：仅提交本任务文件；未推送远端、未部署网关。下一项为 F102 规格与原生提醒事项标签验证。

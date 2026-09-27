# F104/T01：引导与确认定稿

Feature: F104
Status: ready-for-agent
State: done
Blocked by: 无
Spec: [spec](../spec.md)
Baseline: 26d3296faeea131f89010b4c252015df76741294

## 验收

- [x] 逐轮引导、策略比较和反向审视，原回答与建议持久化
- [x] 关联当前草案显式确认，两篇笔记内保留最新稿与历史
- [x] 模型/Apple故障、重复、重启、部分成功和冲突测试
- [x] 示例、完整检查、规范与需求审查、使用说明、提交

## Verification

完成代码与已授权范围测试；新增第二篇合成笔记的真实验收独立待授权，不能视为已上线。

- `npm run check`、`npm test`：通过，117/117。
- `npm run demo:okr`、`npm run demo:okr-finalize`：通过。后者确认前1篇、确认后2篇，重投复用同一最新稿，历史和标签保留，真实模型调用0。
- `npm run demo:feishu`：30个事件、1次重投、20个事项、30个回执；真实发送0。
- `npm run plugin:validate`：隔离 doctorOk=true、status=loaded。
- `node deploy/evaluate-okr.js --allow-model`：3个真实模型合成样例；随后 `--case ready --output runtime/okr/f104-evaluation-recheck.json` 定向复测1次。共2366输入token、1665输出token、账本估算$0.00801825，单次3.36–4.30秒。未扩大既有共享预算，测试后调用额度44/45。报告在Git忽略的runtime内。
- 质量审查发现模型擅自加入开源与固定检查日，收紧提示词后定向复测不再强加这两项；误转义换行用失败测试复现并修正。四个样例不足以证明所有多轮讨论质量，所有目标仍须用户确认。
- `node deploy/verify-okr-finalize.js --write-synthetic --log-only`：真实复用已授权的F101合成日志，四轮固定合成引导已保存，原文保留，约11576ms，模型调用0。
- `git diff --check` 和 Markdown 本地链接检查：通过。

## 顺序审查

基准至本次工作区全部差异，按项目规则单 agent 检查。

- Standards：没有新增依赖或服务；复用预算、持久化、原消息鉴权与Notes边界。模型输出无写入权限；确认写入按ID与快照定位。未处理阻塞问题0。
- Spec：修复了“回复自己的原消息也能确认尚未送达草案”的问题，新增失败断言后仅允许真实草案回执；限制阶段不能跳跃，当前草案归属/版本必须匹配。保存模型缓存时绑定输入快照；恢复时拒绝使用已过期上下文。未处理阻塞问题0。

## 真实验收与下一步

- [ ] 获准新增一篇合成最新稿后运行不带 `--log-only` 的验证命令，再用独立进程重复运行，核对双笔记创建/替换/读回。
- [ ] 正式部署及飞书端到端验收；本轮未修改网关配置、未重启、未发送真实飞书、未推送。

已经通过异步问题请求新增测试笔记授权，尚无答复。依据项目AGENTS的Apple数据范围要求，没有执行该新增写入。本任务的代码完成状态不代表这些真实验收项已通过。

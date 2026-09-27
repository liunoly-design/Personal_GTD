# Issue tracker: Local Markdown

本项目默认用本地 Markdown 管理开发任务，随 Git 同步到 GitHub。GitHub 是代码与文档远端；本次不创建 GitHub Issues 或外部消息。
这是可调整的初始工程配置，不代表用户选择了额外业务功能。

- 每项功能一个目录：`.scratch/<feature>/`。
- 规格：`.scratch/<feature>/spec.md`。
- 每项任务独立文件：`.scratch/<feature>/issues/<NN>-<slug>.md`，从 01 开始按依赖编号。
- `Status:` 使用 triage 分类；`State:` 使用 `open`、`in-progress`、`blocked`、`done`。
- `Blocked by:` 保存同目录任务编号或跨目录路径；只有依赖的 `State: done` 才解除阻塞。
- 写明输入输出、验收清单、范围、规格链接；结果保存到 `## Verification`，补充讨论追加到 `## Comments`。
- 技能要求 publish/fetch 时，分别创建/读取上述本地文件。业务需求未确认时不能标 ready-for-agent。
- 测试和运行验收完成、阻塞性审查发现已处理后，勾选验收项并设 `State: done`；仅提交代码不关闭任务。
- 原版 implement 不维护完成状态，本项目交付步骤必须补上；不自动关闭父任务。
- `.scratch/` 是受版本控制的工程记录，不放私人运行数据或凭据。

## 可选 wayfinder 约定

仅复杂跨会话决策需要时使用。地图放 `map.md`；子任务仍放 `issues/`，用 `Type: research/prototype/grilling/task` 区分。
领取对应 `State: in-progress`；解决后写 `## Answer`、设 `State: done`，并把结论链接补进地图。沿用上面同一套依赖判定。

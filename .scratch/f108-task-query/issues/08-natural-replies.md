# F108/T08：自然编号与澄清回复

Feature: F108/T08
Status: ready-for-agent
State: done
Blocked by: F108/T05、F201/T01（均done）
实施基准：28f5673332f705f9fc16ff0af427265509ea7643。
Spec: [本项规格](../natural-reply-spec.md)

用户截图：“第一第二任务标记完成”未识别；回复错误提示后无法关联原查询。本项修复自然编号及可信澄清链，批量完成仍由F207/T01开发。

- [x] 中文/连续阿拉伯编号及“标记完成”识别，单项进入现有完成路径，多项准确说明尚未执行。
- [x] 回复编号解析失败或维护未上线提示，可纠正原查询；重启保留关联，越权/无引用/完成回执不继承。
- [x] 测试、演示、规范及需求顺序审查通过；真实飞书写入验收待用户测试。

Verification: 新回归测试先复现两项失败，修复后完整210/210通过，npm run check、demo:query、demo:complete通过；零真实Apple写入/飞书发送/模型调用。部署见[记录](../../../../docs/deployment/f108-natural-replies-2026-10-03.md)。

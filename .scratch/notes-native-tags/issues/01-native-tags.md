# 原生标签修复
Status: ready-for-agent
State: done
Feature: F103/F104

规格：[spec](../spec.md)。

## Verification

- 红灯：真实 AX 编辑器中 O1=false、KR1=false、OK1=true；同一最新稿。
- 诊断：HTML 写入未触发原生标签；脚本导出原生标签为占位符且 HTML 缺失。编辑器在标签末尾输入空格能转成原生对象。
- [x] 桥接读写及原生筛选通过
- [x] 回归、审查、文档和提交

## 实现及验收补充

- 使用现有 callNotes 接口，新增 Swift AX 编辑器桥接。读回重建原生标签位置，追加不覆盖旧 HTML，替换保留非 O/KR 用户标签；O/KR 依确认稿更新。
- 单进程队列、跨进程界面锁、15秒总超时、32种目标标签上限。旧脚本禁止覆写带占位符的笔记，防止旁路丢失原生标签。
- 真实红灯命令：对 `runtime/notes-tags/ui-scoped.txt` 中 AX 原生对象断言；O1=false/KR1=false/OK1=true。随后原生读写脚本首轮捕获多加换行，修正规范化快照末尾换行后通过。
- `npm run verify:notes-tags -- --write-synthetic`：真实原生对象、追加、替换、读回、重复、过期快照和 OK1 保留通过；多次14.875–20.995秒（整轮，多次桥接）。`--repair-only`：既有两篇笔记通过，无新笔记。
- 独立侧栏筛选：O1 → “#O1 – 1个备忘录”，脚本 selection 的真实 ID 与最新稿一致（日志补标签之前）；界面原生对象与侧栏滤选分别验证。
- `npm test`：122/122；`npm run check`、`demo:okr`、`demo:okr-finalize`、`demo:feishu`、`plugin:validate` 通过；Swift 编译通过。
- 模型调用0；无飞书发送、部署或推送。未测 Notes 重启、多设备同步、锁屏及网关权限；需要登录桌面并避免用户同时编辑。

## 顺序审查

规范：对未提交差异与新增文件检查了授权边界、真实 ID、超时、未知结果恢复和私密文件排除；发现原生标签完成状态缺失会误报业务成功，已增加保存与定稿恢复检查及回归测试。

需求：原生标签创建、读回、保留 OK1 与侧栏筛选均有真实证据；修复了整体替换多加空行与 O1/O10 前缀匹配问题。历史字符检查改名为 tagTextPreserved，不再混充原生标签。无人值守、Review 按提醒事项标签取数没有纳入本次完成声明。

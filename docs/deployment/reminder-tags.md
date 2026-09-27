# F102：提醒事项原生标签能力调查与验证入口

日期：2026-09-27。环境：macOS 26.2。**当前只完成接口预检，真实标签创建、读取、查询及目标映射尚未验收。**

## 已核实的结论

| 路径 | 本次证据 | 结论边界 |
| --- | --- | --- |
| EventKit | 本机 SDK 的 EKReminder、EKCalendarItem、EKObject 公开头文件未声明标签属性；EKEventStore 未提供标签专用查询入口 | 现有 Swift 桥接不能直接扩展一个公开 tags 字段解决 F102 |
| Reminders AppleScript / JXA | 本机 Reminders.sdef 有真实 ID、列表、正文、完成状态等，没有标签字段或标签操作 | 通过 body 写入 `#tag` 不构成原生标签验收 |
| Notes AppleScript / JXA | 本机 Notes.sdef 暴露正文和真实 ID，没有原生标签字段 | F101 的正文读写成功不证明 Notes 原生标签读写成功 |
| 快捷指令 | Apple 官方明确新增提醒、查找提醒、编辑提醒支持标签；本机提供 shortcuts 命令 | 可继续验证的候选方案，尚未证明本机完整读写、查询与 ID 核对可用 |

上述公开 EventKit 声明与 Apple 的 [EKReminder](https://developer.apple.com/documentation/eventkit/ekreminder)、[EKCalendarItem](https://developer.apple.com/documentation/eventkit/ekcalendaritem) 文档相互核对。完整本机路径和文件哈希由预检命令输出，不能将几个关键词未命中推广成所有 Apple 自动化都不支持标签。

快捷指令的标签支持依据 [Apple 发布说明](https://support.apple.com/en-ph/106430)。Apple 同时说明，命令行可运行已安装快捷指令，传入文件并接收输出；涉及交互时会等待用户操作。[命令行使用说明](https://support.apple.com/guide/shortcuts-mac/run-shortcuts-from-the-command-line-apd455c82f02/mac)

原生标签应能被提醒事项的标签浏览器或标签查询识别。Apple 提供的界面支持添加标签并按标签筛选；相关完整能力以升级后的 iCloud 提醒事项为前提。[Apple 提醒事项标签指南](https://support.apple.com/guide/reminders/tag-reminders-remn45640f4f/mac)

## 可重复运行的预检

```bash
npm run probe:tags
```

预检仅读取 6 个系统资源和 3 个命令的版本/帮助信息，不启动 Apple 数据查询、不运行任何已有快捷指令、不创建事项或标签。输出 `status: inventory_complete` 只表示清点成功；`liveTagVerification` 固定为 `not_run`。系统资源缺失、命令失败或超时返回 `inventory_failed`，不能当作“不支持标签”的证据。

人工已阅读全文：EKReminder、继承的 EKCalendarItem/EKObject、EKEventStore 提醒事项谓词，以及两份 sdef。工具的关键词清单只用于复核，未来系统新增 API 时应重新检查文档。

本机 `shortcuts --help` 只有 run、list、view、sign，没有导入/编辑子命令。本轮只检查了辅助功能控制状态，返回 false，未修改系统设置。未读取用户快捷指令名称或内容，未访问提醒事项数据库。

## 真实验证的具体方案（待范围确认和界面配置）

拟使用 iCloud / Inbox，保留一条 `PGTD F102 合成测试` 事项和专用标签 `pgtd-f102-test`。正式业务的标签命名不在本轮冻结。运行前核对标签不存在；若已存在，使用新的随机后缀，不能给旧标签全局重命名或删除。

首次需在快捷指令编辑器核对 Apple 自带动作，配置检查单如下：

1. 检查“添加新提醒事项”（Add New Reminder）的目标列表和 Tags 参数。选定 iCloud 所属 Inbox，只放合成正文，不设置通知；未确认账户和写入范围前不运行。
2. 检查“查找提醒事项”（Find Reminders）的原生标签过滤条件。只查询专用测试标签，并验证结果所在列表与合成操作标识；不能只按标题选择对象。
3. 检查“编辑提醒事项”（Edit Reminder）及详情读取是否能返回实际标签。若只能查到事项、不能读出标签或核对真实 ID，就将对应验收保持未完成。
4. 保留创建输出对象并通过既有 Apple 边界核对真实 ID；记录追加标签前后 ID。记录项需要明确 account/list/item ID、操作标识、实际标签值和查询命中的 ID。
5. 后续重复运行只能查询同一条事项。真实写入超时/响应丢失后先只读核对；不得直接重跑包含创建动作的快捷指令。

这是一份配置与验收检查单，尚未生成或导入已验证的快捷指令。实际动作字段、标签输出类型与 ID 对应必须在本机编辑器确认，不能凭名称猜出可运行的序列化文件。若无法完成自动核对，可先记录人工界面观察，但不能把它标记为可靠自动化接口。

## 映射结论与当前阻塞

Apple 提醒事项会提供来自 Notes 的标签建议，但这不证明两端共享稳定标签 ID。当前只有“使用一致标签名表达关联”的方向，尚无经过真实验证的目标 → 标签 → 事项映射。F109 仍需明确目标稳定 ID、标签重命名、名称冲突与人工编辑处理。

- 当前阻塞：新增真实事项/标签的范围确认；快捷指令编辑器中的动作配置及标签输出、真实 ID 核对。
- 未执行：真实标签写入、读取、查询、重启恢复、跨设备验证。
- 不改变现有收集/提醒能力，不部署网关，不访问私有数据库，不将正文井号静默替代标签。
- F103–F107、F108 不因这项标签验证而增加依赖；F109/F110 涉及关联的部分继续受阻。

下一步应完成上述快捷指令配置与一条合成事项的闭环，再决定是否开发受控快捷指令适配器。若此路径仍无法可靠读写，向用户报告具体证据并讨论替代设计，不能直接宣布需求完成。

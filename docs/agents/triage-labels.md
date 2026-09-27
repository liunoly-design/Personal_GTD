# Triage labels

分类放在 `Status:`，执行进度放在 `State:`；这避免把 ready-for-agent 当作已经完成。

| 上游角色 | 本项目分类 | 含义 |
| --- | --- | --- |
| needs-triage | needs-triage | 待判断范围与价值 |
| needs-info | needs-info | 缺少影响实现的信息 |
| ready-for-agent | ready-for-agent | 需求与验收明确，可开始实现 |
| ready-for-human | ready-for-human | 需要用户操作或判断 |
| wontfix | wontfix | 已决定不实施 |

这些是本地文件字段；不自动创建 GitHub 标签。State 规则见 issue-tracker.md。

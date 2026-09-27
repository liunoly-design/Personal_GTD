# 开发技能安装记录

日期：2026-09-27。范围：仅 PGTD / Personal-GTD，目标 agent 为 Codex。

- 上游：[mattpocock/skills](https://github.com/mattpocock/skills)。
- 上游快照提交：`c55ee46073ed923f86ce59a5eb3b6d895095d1b7`。
- 安装器：skills CLI 1.7.0；用户要求的 `@latest` 在本次解析为该版本。
- 文件位置：`.agents/skills/`，实际文件入库，无机器专用绝对路径或外部软链接。
- `skills-lock.json` 记录 GitHub 来源、每项技能路径和内容哈希；上游 MIT 许可保存在 `.agents/skills/LICENSE.mattpocock`。
- 安装了仓库当前可发现的全部 38 项技能，包括工程、生产力、实验和其他工具专用技能；不表示每项都适合 PGTD 或会自动执行。
- 上游技能正文未修改；项目适配集中在 `AGENTS.md` 与 `docs/agents/`，更新时检查兼容性。

## 安装与查看

在本项目根目录运行：

```bash
npx skills@latest add mattpocock/skills --agent codex --skill '*' --yes
npx skills@1.7.0 list -a codex
```

本次直连 GitHub 超时后，先用 GitHub API 下载源码并完成本地安装，再使用机器已有系统代理成功重跑上述 GitHub 源安装；最终锁文件全部指向 GitHub，不依赖临时目录。代理只用于命令进程，未修改全局 Git 配置。

克隆本仓库即可得到当前固定快照。上述安装命令会获取运行时最新上游；需要完全复现本次版本应使用 Git 中的技能文件。

## 更新

在单独变更中运行 `npx skills@1.7.0 update`，检查技能正文、引用文件和锁文件差异，再更新本记录。不要在普通业务任务中自动升级。
项目配置已建立：本地 Markdown tracker、五种 triage 分类、单领域文档布局。更换配置时直接修改 `docs/agents/` 并保持 AGENTS.md 一致。

## 优先使用

`grill-with-docs` → `to-spec` → `to-tickets` → `implement` / `tdd` → 按项目规则审查与验收。
按需使用 `diagnosing-bugs`、`handoff`；`in-progress` 和工具专用技能仅在用户指定且环境适合时使用。技能中的其他 agent 专有工具名应对应实际可用能力，不能声称不存在的命令已经执行。

## 安装清单

| 技能 | 上游分类 |
| --- | --- |
| `ask-matt` | `engineering` |
| `claude-handoff` | `in-progress` |
| `code-review` | `engineering` |
| `codebase-design` | `engineering` |
| `diagnosing-bugs` | `engineering` |
| `domain-modeling` | `engineering` |
| `git-guardrails-claude-code` | `misc` |
| `grill-me` | `productivity` |
| `grill-with-docs` | `engineering` |
| `grilling` | `productivity` |
| `handoff` | `productivity` |
| `implement` | `engineering` |
| `implement-spec` | `in-progress` |
| `improve-codebase-architecture` | `engineering` |
| `loop-me` | `in-progress` |
| `migrate-to-shoehorn` | `misc` |
| `pr` | `in-progress` |
| `prototype` | `engineering` |
| `research` | `engineering` |
| `resolving-merge-conflicts` | `engineering` |
| `retro` | `in-progress` |
| `scaffold-exercises` | `misc` |
| `setup-matt-pocock-skills` | `engineering` |
| `setup-pre-commit` | `misc` |
| `setup-ts-deep-modules` | `in-progress` |
| `tdd` | `engineering` |
| `teach` | `productivity` |
| `to-questionnaire` | `productivity` |
| `to-spec` | `engineering` |
| `to-tickets` | `engineering` |
| `triage` | `engineering` |
| `wait-what` | `productivity` |
| `wayfinder` | `engineering` |
| `wizard` | `engineering` |
| `writing-beats` | `in-progress` |
| `writing-for-agents` | `productivity` |
| `writing-fragments` | `in-progress` |
| `writing-shape` | `in-progress` |

## 参考

- [上游 README](https://github.com/mattpocock/skills)：安装及技能职责。
- [skills CLI](https://github.com/vercel-labs/skills)：项目安装、目标 agent 和锁文件。
- [AIHero](https://www.aihero.dev/skills)：工作流程说明；以本次安装源码为准。
- [AGENTS.md 官方说明](https://learn.chatgpt.com/docs/agent-configuration/agents-md)：项目指令文件。

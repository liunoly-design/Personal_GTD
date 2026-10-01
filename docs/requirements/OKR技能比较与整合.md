# OKR 技能比较与整合（2026-10-01）

## 结论

适合本项目的是 **grilling 访谈 + okr-design 方法主干 + okr-creator 的验收与行动拆解思想**。落地为现有小婕 OKR 路由中的同一位 OKR+GTD 教练，保留两篇 Notes、逐个 O 下3–5个KR、原生标签和用户确认。

| 来源 | 原本用途与适配判断 | 本项目采用 | 本项目不采用 |
| --- | --- | --- | --- |
| [grilling](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/productivity/grilling/SKILL.md) | 围绕依赖关系分轮澄清决定，适合持续目标访谈 | 前提明确再提问、给建议和理由、随回答更新问题、共同理解后确认 | 上游一轮询问全部可回答问题改为用户要求的一轮一个核心问题；默认单agent |
| [okr-design](https://github.com/rampstackco/claude-skills/blob/3d4510a94a76ead80122c691b5c480f92f3fbe40/skills/okr-design/SKILL.md) | 面向产品/组织目标，强调结果、指标证据、复盘和调整；更适合作为跨业务与个人生活的OKR方法主干 | 可衡量、关联O、影响范围、期限；结果/行动区分；领先信号和底线指标；依据证据回顾和调整 | 组织级联和会议时长不机械照搬；60–70%不作为个人目标或承诺底线的通用成功线；不凭100%完成就断言太保守 |
| [okr-creator](https://github.com/chainreactors/okr-creator/blob/6db9fb53a93cdcc877ae8d99de0a5a391d1ca073/skills/okr-creator/SKILL.md) | 针对有目录结构的项目诊断，生成项目skill和GitHub追踪；更适合软件项目治理 | 有证据再建议；每KR有可执行验收方法；方向/优先级/底线/投入质询；转成下一步行动候选 | 仓库六维评分、固定3–5O/2–4KR、每日Action、PROGRESS.md、自动承诺和施压话术。未知基线不填0；不新增权威任务状态 |

这两个上游都不直接提供本项目的飞书持续会话、Apple写入恢复或提醒事项事实源。它们的方法通过现有代码接入，不能把读取/安装技能等同于自动部署完整业务。

## 实际接入

- [共用教练方法](../../src/okr-method.md)是当前采用规则的权威文本；[个人OKR技能](../../.agents/skills/personal-okr-discussion/SKILL.md)引用它，`src/okr-guidance.js`加载同一文件进入实际模型系统指令。
- 同一agent依次承担当前问题质询、KR指标检查、策略反向审视与GTD行动建议，不创建相互聊天的多agent平台。
- 讨论仍使用已有阶段、每轮一次调用、草案/检查点、显式确认及保存核对。新增方法属于模型行为指导；代码继续校验日期、层级、每O的KR数量及单项改动，不能宣称代码可证明目标质量。
- GTD输出仅为可选择的行动候选，关联现有#O/#KR；是否执行由用户决定。任务完成不等于KR达成。自动Inbox整理、Review调度和新任务写入不在本次实现范围。

## 来源核验

读取以上三个SKILL全文，另查阅 okr-design 的 key-result-design-patterns、scoring-discipline，以及 okr-creator 的 interviewer、reviewer。通过固定提交重新获取SKILL，确认与首次读取内容一致。已有本地grilling与用户链接正文一致，无需重复安装或改写上游锁文件。

| 技能 | 本次SKILL SHA-256 |
| --- | --- |
| grilling | `10ff989e7498b23b5acb49d5048f11dcd906757d2f79c5cdf8a00001381296f2` |
| okr-design | `cdd08906e015dc3c95f7df84114b46853760f1fe3bc8e4dcad4fd603349155fa` |
| okr-creator | `06d76284378dd219e20963a1c8a98cc788e46dd88e7d92cf97ca4fb35ba2737d` |

本次使用自行编写的适配文本和来源链接，不将两套上游部署流程作为本项目指令安装。后续更新先比较固定来源与采用规则，再评估是否更新。

## 验证

见[方法接入验收](../deployment/okr-method-integration.md)。真实模型合成样例只能证明本次输出符合检查标准，不能保证所有真实讨论的模型质量。

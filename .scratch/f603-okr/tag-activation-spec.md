# F603 原生标签重复出现修复

基准efe9e3d。真实讨论追加后正文与pending投影/标记一致，但tagsComplete/headingsComplete=false；21:25出现TAG_DELIMITER_REQUIRED，随后UPDATE_RESULT_UNKNOWN。只读复现命令在私有runtime中，失败条件精确对应恢复门槛。

根因：同一#KR2正文首次后接逗号、结构标题后接空格；Native只取第一次出现。修复选择同名标签中已有空格/换行的出现位置激活，不增删正文、不修改模型稿/原回答、不重调模型。无可激活位置仍明确拒绝。单项SPEC公开测试边界为现有Native JSON诊断/执行接口与Notes读回；增加不依赖AX的checkTagActivation只读诊断用于合成CLI回归，复用同一选择逻辑。真实核验仍按原Notes ID，恢复已落地的标签与标题格式，不创建替代笔记/重写正文；模型/日志/Notes绑定保留。原回答与私人正文不进Git。

TDD合成同标签重复（逗号→标题空格）和无有效分隔、Swift类型检查、受影响/完整Node检查；先只读核对，再ensureTags，恢复需新关联续接消息，不主动重发原错误回执。修复沿用当前部署授权，保留旧快照/状态备份。不把这项修复当作完整个人目标确认。

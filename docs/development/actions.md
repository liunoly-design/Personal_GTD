# 按 GTD 动作维护代码

当前已实现的动作分别放在 `src/actions/`，统一通过 `createCapture().handle(event)` 对外执行。

| 功能 | 修改入口 | 局部验证 |
| --- | --- | --- |
| 收集到 Inbox、保存原文与建议、分析失败降级 | `src/actions/collect.js` | `npm run test:collect` |
| 为已有事项设置提醒、处理过去时间和写入未知 | `src/actions/set-reminder.js` | `npm run test:remind` |
| 补充日期/时间、沿用已知字段、成功后避免重复更新 | `src/actions/clarify-reminder.js` | `npm run test:clarify` |
| 确认或取消链接收集、同时确认不增项 | `src/actions/confirm-link.js` | `npm run test:links` |
| 写入日志、重复投递、重启与结果未知核对 | `src/durable-capture.js` | `npm run test:recovery` |

`src/capture.js` 负责事件校验、权限、触发词、分派及待澄清状态。`src/analyze-message.js` 统一管理分析超时、输出校验与统计；具体模型及 Apple/飞书访问仍通过适配器完成。动作接收这些能力，不自行读取凭据或开启外部客户端。

动作之间存在明确协作：收集先创建事项，提醒只更新同一事项；补时间复用提醒设置；链接确认复用收集。待澄清状态的 checkpoint 格式与旧版本相同，本次无需迁移数据库。

## 一次升级一个功能

1. 修改对应动作文件，按原接口增加或调整公开行为测试。
2. 执行该动作的局部验证；关联功能发生变化时一并验证。
3. 交付前运行 `npm run check`、`npm test`、`npm run demo:recovery`、`npm run demo:feishu`；打包或入口有变化时运行 `npm run plugin:validate`。
4. 单功能形成单独提交，普通推送后由运行方重载网关，核对新版本。

目前是一个插件包内的独立动作模块，可以分别修改、测试和提交。运行中的 Node 进程需重载后使用新代码；不是独立部署的多个服务，也不支持直接热替换。未来实际实现 Review、完成事项等动作时再增加对应模块，不预建空框架。

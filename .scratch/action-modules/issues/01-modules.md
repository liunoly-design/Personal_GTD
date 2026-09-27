# 01：动作模块与 SSH 配置

Status: ready-for-agent
State: done
Blocked by: 无
Spec: [规格](../spec.md)

- [x] 提取 collect、set-reminder、clarify-reminder、confirm-link 四个动作文件。
- [x] 模型分析校验与超时提取到 analyze-message；capture 保留入口校验、分派和兼容 checkpoint。
- [x] 增加按动作测试命令和维护说明；未新增业务语义或依赖。
- [x] 顺序审查规范与需求：并发链接确认仍缓存同一个 Promise；提醒结果未知停止；恢复字段及外部调用路径不变。
- [x] npm test：78/78；npm run check 通过。
- [x] test:collect 20/20、test:remind 15/15、test:clarify 18/18、test:links 3/3、test:recovery 20/20。
- [x] demo:recovery：崩溃恢复后只有一个事项和回执；demo:feishu：30 条事件、20 事项、30 回执。
- [x] 专用 SSH 别名走 443；主机公钥比对 GitHub 官方指纹，保持严格校验。
- [x] 用户添加公钥后认证为仓库所属账户；此前 15 个提交推送成功。
- [x] origin 使用 SSH，origin-https 保留 HTTPS 备用地址；未提供 HTTPS 新凭据。

- [x] 隔离 plugin:validate 加载通过；安装包包含全部动作与分析模块，文档内部链接正常。

## Verification

真实 SSH 与历史提交推送已验证；本次无模型付费调用、Apple 写入或飞书发送。运行中网关仍使用已加载模块，下一次重载会载入此次等行为拆分，不需要迁移状态数据库。

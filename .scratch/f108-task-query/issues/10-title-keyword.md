# F108/T10 标题关键词查询

Feature: F108/T10
Version: 0.2.x 查询切片
Status: ready-for-agent
State: done
Blocked by: None
Spec: [短规格](../keyword-spec.md)
基准：f89b9276cae4c962fb4a722d74b533e4bcc6c94b。

## Acceptance criteria

- [x] 默认/指定清单标题关键词自然表达、完整包含匹配、过滤后分页计数及准确空结果。
- [x] 身份/账户/清单/权限/容量/歧义守卫、零模型调用和查询零业务写入。
- [x] 保留真实ID/字段基线，恢复与编号完成/移动/批量确认兼容。
- [x] 完整检查、演示、顺序审查、部署及只读验证，报告真实未测项。

## Verification

完整226/226、语法检查、Swift类型检查、查询/维护合成演示、隔离插件校验及规范/需求顺序审查通过。真实Apple仅授权默认绑定只读验证：8项基线筛出6项，计数/分页/空结果、同名清单定位ID与字段基线一致，1092ms；0业务写入/付费模型调用/真实飞书发送。独立快照226项及语法通过，网关重启restarted、running/RPC ok，PGTD config来源loaded且指向keyword快照；飞书default running/connected、probe.ok、lastError=null。

用户飞书新查询闭环待验收；真实权限/容量故障未注入。详见[验收记录](../../../docs/deployment/f108-keyword-2026-10-03.md)。父T06保持open。

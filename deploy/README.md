# 安装与运行维护

从仓库根目录运行命令。完整步骤见 [安装交接](../docs/deployment/openclaw-handoff.md)。

| 命令 | 用途 |
| --- | --- |
| `npm run build:apple` | 编译本机 Apple helper 到 `runtime/bin/` |
| `node deploy/apple-setup.js` | 读取 Apple 列表并建立本机绑定配置 |
| `npm run openclaw:check -- --agent gtd` | 检查本机接入配置 |
| `npm run plugin:validate` | 在隔离配置下验证插件加载 |
| `npm run recover:feishu -- …` | 显式恢复未完成事件；参数见安装交接 |

`verify-apple.js` 和 `verify-model.js` 是需要相应授权的一次性真实验收脚本。恢复可能写 Apple 或发回执，不能与持有同一状态目录的网关同时运行。普通模拟演示继续在 `examples/`。

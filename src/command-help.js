// A bounded menu of implemented commands; no business adapters or model calls.
const isHelpInstruction = value => typeof value === 'string'
  && ['', '帮助', '命令', '查询命令', '查看命令', 'help'].includes(value.trim().replace(/[？?。]$/u, '').toLowerCase());
const menus = {
 gtd:`小婕 gtd 收集：内容（也可直接发送“小婕 gtd 内容”）
小婕 gtd 提醒我明天下午三点交报价
小婕 gtd 查询任务
小婕 gtd 查询 waiting 任务
小婕 gtd 查询关于金山的任务
小婕 gtd 查询 waiting 里面关于金山的任务
小婕 gtd 查询任务 第2页
回复任务查询回执：选择第1项；第1项完成；第1项移动到 Next 清单；第一第二项完成，第五项移动到 Next 清单。
移动/批量先展示计划，再回复计划“确认执行”或“取消”；单项完成直接执行。裸链接回复“确认”或“取消”；补提醒时间须回复对应回执。删除、重开、日历、日期筛选和备注搜索尚未支持。`,
 okr:`小婕 okr 讨论
小婕 okr 续接
小婕 okr 记录：内容
小婕 okr 暂停
小婕 okr 查询当前目标
小婕 okr 查询当前目标 第2页
回复讨论问题继续回答；回复当前完整草案“确认定稿”才保存正式目标。分析失败可回复原失败回执“重试分析”；写入未知先“续接”核对，不重新分析。旧“小婕 gtd okr …”入口兼容。`,
 review:`小婕 review 记录心得
小婕 review 查询今天心得
小婕 review 查询昨天心得
小婕 review 查询 YYYY-MM-DD 心得
小婕 review 查询近期心得（最近7天）
小婕 review 查询近期心得 第2页
小婕 review 查询注册
小婕 review 注册 DOPL（回复“确认注册”）
小婕 review 续接
小婕 review 取消
小婕 review 查询自动询问
小婕 review 设置自动询问 HH:mm（北京时间24小时制）
小婕 review 暂停自动询问
小婕 review 恢复自动询问
小婕 review 核对自动询问
回复“记录心得”的引导问题直接追加独立原文及回复时间，无需再次确认。旧“每日心得 / DOPL / 补记 YYYY-MM-DD”走草案“确认保存”；旧MMDD条目可按回执“合并/替换”后确认，保留旧历史。
自动询问首次须维护者启用宿主任务，设置时刻不代表宿主已启用；未答复不催促/堆积。专题/周月复盘尚未交付。`,
};
export function commandHelp(entry, enabledModules) {
  if (!entry || !isHelpInstruction(entry.instruction) || !['gtd', 'okr', 'review', 'help'].includes(entry.module)) return null;
  const selected = entry.module === 'help' ? ['okr', 'gtd', 'review'] : [entry.module];
  return {
    status: 'commands_help', module: entry.module, modelCalls: 0,
    receipt: '小婕命令帮助（仅显示用法，未读取或修改业务数据）\n'
      + selected.map(module => `${module.toUpperCase()}：${enabledModules.includes(module) ? '已启用' : '当前未启用，仅供查看用法'}\n${menus[module]}`).join('\n\n')
      + '\n\n查看全部：小婕 帮助；查看模块：小婕 gtd / 小婕 okr / 小婕 review，或在模块后加“帮助”。',
  };
}

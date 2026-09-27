import { resolveReminder } from '../reminder-time.js';

export function createReminderSetter({ reminders, now }) {
  async function applyTime(record, candidate, metrics) {
    if (candidate) record.candidate = candidate;
    const base = { itemId: record.itemId, listId: record.listId, analysis: metrics };
    const resolved = resolveReminder(candidate);
    if (!resolved) {
      return { ...base, status: 'collected_awaiting_time',
        receipt: metrics.failureReason
          ? '【模拟】已收集，分析未完成，未设置提醒；请关联原请求回复具体日期、时间和时区。'
          : '【模拟】已收集，未设置提醒；请关联原请求回复具体日期、时间和时区。' };
    }
    try {
      const past = Date.parse(resolved.remindAt) <= Date.parse(now());
      const alreadyApplied = past && await reminders.reconcileReminder?.(record.itemId, resolved);
      if (past && !alreadyApplied) {
        return { ...base, status: 'collected_awaiting_time', timeIssue: 'past',
          receipt: '【模拟】已收集，但指定时间已过去，未设置提醒；请关联原请求回复新的日期和时间。' };
      }
      if (!alreadyApplied) await reminders.setReminder(record.itemId, resolved);
      return { ...base, status: 'reminder_set', ...resolved,
        receipt: `【模拟】已收集，提醒已设置：${resolved.localTime} ${resolved.timeZone}。` };
    } catch (error) {
      return { ...base, status: error?.code === 'WRITE_REJECTED' ? 'collected_reminder_failed' : 'reminder_result_unknown',
        receipt: error?.code === 'WRITE_REJECTED'
          ? '【模拟】已收集，但提醒设置失败；未重新创建事项。'
          : '【模拟】已收集，提醒设置结果待核对；不会自动重试。' };
    }
  }

  return applyTime;
}

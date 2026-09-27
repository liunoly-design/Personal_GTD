export function createCollector({ reminders, analyzeMessage, startReminder }) {
  async function save(event, content, reminderRequest = false, evaluated) {
    const { analysis, metrics } = evaluated ?? await analyzeMessage(event, content, reminderRequest);
    try {
      const candidates = (await reminders.listLists()).filter(x => x.name === 'Inbox');
      if (candidates.length > 1) {
        return { status: 'needs_list_selection', receipt: '【模拟】存在多个 Inbox，请先明确目标列表；未创建事项。', analysis: metrics };
      }
      const list = candidates[0] ?? await reminders.createList('Inbox');
      const item = await reminders.createItem({
        listId: list.id,
        title: analysis?.title ?? [...content.replace(/\s+/gu, ' ')].slice(0, 80).join(''),
        notes: `原文：\n${event.text}` + (analysis ? `\n\n小婕的建议：${analysis.suggestion}` : ''),
      });
      if (reminderRequest) {
        return await startReminder(event, item.id, list.id, analysis?.reminder, metrics);
      }
      return {
        status: analysis ? 'collected' : 'collected_analysis_failed', listId: list.id, itemId: item.id,
        analysis: metrics,
        receipt: analysis ? '【模拟】已收集到 Inbox；未设置提醒。' : '【模拟】已收集到 Inbox，分析未完成；未设置提醒。',
      };
    } catch (error) {
      return { status: error?.code === 'WRITE_REJECTED' ? 'failed' : 'result_unknown', analysis: metrics,
        receipt: error?.code === 'WRITE_REJECTED'
          ? '【模拟】写入未成功；本版本不自动重试。'
          : '【模拟】操作结果待核对；本版本不自动核对或重试，请勿直接重复提交。' };
    }
  }

  return save;
}

// Complete, bounded command forms only; extra filters/compound instructions stay guarded.
export function taskQuery(instruction) {
  const match = instruction.trim().match(/^(?:请)?(?:帮我)?(?:(?:查询|查看|查一下|看看|看一下|列出(?:来)?|找一下)\s*(?:未完成任务|未完成事项|任务|事项|待办|Inbox)|有哪些(?:任务|待办)|任务有哪些)(?:\s*第\s*([0-9]+)\s*页)?[？?。]?$/iu);
  return match ? { page: Number(match[1] ?? 1) } : null;
}
export function validateQueryConfig(config) {
  for (const [name, fallback, max] of [['queryPageSize', 20, 50], ['queryTimeoutMs', 15000, 20000]]) {
    const value = config[name] ?? fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${name} must be 1..${max}`);
  }
}
const safeId = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\r\n\x00-\x1f]/u.test(value);
const title = value => {
  const chars = [...String(value ?? '').replace(/[\r\n\x00-\x1f]/gu, ' ')];
  return chars.slice(0, 200).join('') + (chars.length > 200 ? '…（标题省略）' : '');
};
export async function queryTasks({ reminders, config, page, now, signal }) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 100) return {
    status: 'query_failed', code: 'INVALID_PAGE', receipt: '任务查询页码须为 1–100；未读取或创建事项。',
  };
  const pageSize = config.queryPageSize ?? 20;
  const timeoutMs = config.queryTimeoutMs ?? 15000;
  const controller = new AbortController();
  const querySignal = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
  let timer, onAbort;
  try {
    const response = await Promise.race([
      Promise.resolve().then(() => { querySignal.throwIfAborted(); return reminders.queryTasks({ limit: pageSize, offset: (page - 1) * pageSize }, { signal: querySignal, timeoutMs }); }),
      new Promise((_, reject) => {
        onAbort = () => reject(querySignal.reason);
        querySignal.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => controller.abort(Object.assign(new Error('Query timeout'), { code: 'QUERY_TIMEOUT' })), timeoutMs);
      }),
    ]);
    if (response.state === 'needs_list') {
      if (!Array.isArray(response.candidates)) throw new Error('Invalid candidates');
      const candidates = response.candidates.slice(0, 50).map(list => {
        if (!safeId(list.id)) throw new Error('Invalid list');
        return { id: list.id, name: title(list.name) };
      });
      return { status: 'query_needs_list', candidates, receipt: '任务查询尚未配置 Inbox 列表，请先在私有配置中确认真实列表 ID；本次未创建列表或事项。'
        + candidates.map(list => `\n${list.name} [listId: ${list.id}]`).join('')
        + (response.candidates.length > 50 ? '\n候选超过50个，仅展示前50个。' : '') };
    }
    const { list, items, total, hasMore } = response;
    if (response.state !== 'ok' || !safeId(list?.id) || !safeId(list.sourceId)
      || !Array.isArray(items) || items.length > pageSize || !Number.isSafeInteger(total) || total < 0 || total > 10000
      || typeof hasMore !== 'boolean') throw new Error('Invalid query result');
    const visible = items.map(item => {
      if (!safeId(item.id) || item.listId !== list.id || item.completed !== false) throw new Error('Invalid item');
      return { id: item.id, listId: item.listId, sourceId: list.sourceId, title: title(item.title), completed: false };
    });
    const scope = { sourceId: list.sourceId, listId: list.id, listName: title(list.name), completed: false };
    const readAt = now?.() ?? new Date().toISOString();
    const status = total === 0 ? 'tasks_empty' : visible.length === 0 ? 'tasks_page_empty' : 'tasks_found';
    return { status, scope, readAt, page, pageSize, total, hasMore, items: visible,
      receipt: `任务查询范围：${scope.listName}，未完成事项；第 ${page} 页，每页 ${pageSize} 条，共 ${total} 条。\n读取时间：${readAt}\nsourceId: ${scope.sourceId}\nlistId: ${scope.listId}`
        + (status === 'tasks_empty' ? '\n没有未完成事项。' : status === 'tasks_page_empty' ? '\n本页为空，请查看前面的页码。'
          : visible.map(item => `\n- ${item.title} [itemId: ${item.id}]`).join(''))
        + (hasMore ? `\n还有下一页：小婕 gtd 查询任务 第 ${page + 1} 页${page === 100 ? '（超出本版页码范围，请缩小列表后查询）' : ''}` : '') };
  } catch (error) {
    const denied = error?.reason === 'PERMISSION_DENIED' || error?.code === 'PERMISSION_DENIED';
    const timeout = error?.code === 'QUERY_TIMEOUT';
    return { status: denied ? 'query_forbidden' : 'query_failed', code: denied ? 'PERMISSION_DENIED' : timeout ? 'QUERY_TIMEOUT' : 'READ_FAILED',
      receipt: denied ? '任务查询无提醒事项读取权限，请检查 macOS 权限；未创建或修改事项。'
        : timeout ? '任务查询读取超时；未返回空结果，未创建或修改事项。'
          : '任务查询读取失败，请检查已配置账户、列表及读取服务；未返回空结果，未创建或修改事项。' };
  } finally { clearTimeout(timer); if (onAbort) querySignal.removeEventListener('abort', onAbort); }
}

// Complete, bounded command forms only; extra filters/compound instructions stay guarded.
export function taskQuery(instruction) {
  const match = instruction.trim().match(/^(?:请)?(?:帮我)?(?:(?:查询|查看|查一下|看看|看一下|列出(?:来)?|找一下)\s*(?:未完成任务|未完成事项|任务|事项|待办|Inbox)|有哪些(?:任务|待办)|任务有哪些)(?:\s*第\s*([0-9]+)\s*页)?[？?。]?$/iu);
  if (match) return { page: Number(match[1] ?? 1) };
  const prefix = '^(?:请)?(?:帮我)?(?:查询|查看|查一下|看看|看一下|列出(?:来)?|找一下)\\s*';
  const suffix = '(?:未完成)?(?:任务|事项|待办)(?:\\s*第\\s*(?<page>[0-9]+)\\s*页)?[？?。]?$';
  for (const shape of ['(?<name>.+?)列表(?:的|里(?:面)?(?:的)?|中(?:的)?)?', '列表\\s*(?<name>.+?)\\s*的', '(?<name>.+?)\\s*(?:里(?:面)?|中)(?:的)?', '(?<name>[^\\s，,；;]+)\\s+']) {
    const selected = instruction.trim().match(new RegExp(prefix + shape + suffix, 'u'));
    if (!selected) continue;
    let name = selected.groups.name.trim();
    const quoted = /^(?:「[^」]+」|“[^”]+”|"[^"]+")$/u.test(name);
    if (quoted) name = name.slice(1, -1);
    else if (/[「」“”"]|^(?:所有|全部)$/u.test(name)) return null;
    if (!name.trim() || [...name].length > 200 || /[\r\n\x00-\x1f]/u.test(name)) return null;
    return { page: Number(selected.groups.page ?? 1), listName: name };
  }
  return null;
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
function quotedList(name) {
  if (!name.includes('」')) return `「${name}」`;
  if (!name.includes('”')) return `“${name}”`;
  return `"${name}"`;
}
function queryTime(readAt, timeZone = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'long' }).formatToParts(new Date(readAt));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}（${timeZone === 'Asia/Shanghai' ? '北京时间' : values.timeZoneName}）`;
}
export async function queryTasks({ reminders, config, page, listName, now, signal }) {
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
      Promise.resolve().then(() => { querySignal.throwIfAborted(); return reminders.queryTasks({ limit: pageSize, offset: (page - 1) * pageSize, ...(listName !== undefined ? { listName } : {}) }, { signal: querySignal, timeoutMs }); }),
      new Promise((_, reject) => {
        onAbort = () => reject(querySignal.reason);
        querySignal.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => controller.abort(Object.assign(new Error('Query timeout'), { code: 'QUERY_TIMEOUT' })), timeoutMs);
      }),
    ]);
    if (response.state === 'list_not_found') return { status: 'query_list_not_found', receipt: `已配置的账户中没有找到「${title(listName)}」列表，请核对完整名称。` };
    if (response.state === 'needs_list' || response.state === 'ambiguous_list') {
      if (!Array.isArray(response.candidates)) throw new Error('Invalid candidates');
      const candidates = response.candidates.slice(0, 50).map(list => {
        if (!safeId(list.id)) throw new Error('Invalid list');
        return { id: list.id, name: title(list.name) };
      });
      return { status: 'query_needs_list', candidates, receipt: (response.state === 'ambiguous_list' ? `找到多个名为「${title(listName)}」的列表，请先在提醒事项中区分名称后再查询。`
        : '还没有确定要查询的列表，请先确认目标列表。')
        + candidates.map((list, index) => `\n${index + 1}. ${list.name}`).join('')
        + (response.candidates.length > 50 ? '\n候选超过50个，仅展示前50个。' : '') };
    }
    const { list, items, total, hasMore } = response;
    if (response.state !== 'ok' || !safeId(list?.id) || !safeId(list.sourceId)
      || (config.sourceId && list.sourceId !== config.sourceId)
      || !Array.isArray(items) || items.length > pageSize || !Number.isSafeInteger(total) || total < 0 || total > 10000
      || typeof hasMore !== 'boolean') throw new Error('Invalid query result');
    const visible = items.map(item => {
      if (!safeId(item.id) || item.listId !== list.id || item.completed !== false) throw new Error('Invalid item');
      return { id: item.id, listId: item.listId, sourceId: list.sourceId, title: title(item.title), completed: false, ...(typeof item.contentRevision==='string'&&/^[a-f0-9]{64}$/u.test(item.contentRevision)?{contentRevision:item.contentRevision}:{}), ...(typeof item.revision === 'string' && /^[a-f0-9]{64}$/u.test(item.revision) ? { revision: item.revision, ...(typeof item.fieldsRevision==='string'&&/^[a-f0-9]{64}$/u.test(item.fieldsRevision)?{fieldsRevision:item.fieldsRevision}:{}) } : {}) };
    });
    const scope = { sourceId: list.sourceId, listId: list.id, listName: title(list.name), completed: false };
    const readAt = now?.() ?? new Date().toISOString();
    const status = total === 0 ? 'tasks_empty' : visible.length === 0 ? 'tasks_page_empty' : 'tasks_found';
    return { status, scope, readAt, page, pageSize, total, hasMore, items: visible,
      receipt: `${scope.listName} · 未完成 ${total} 项`
        + (hasMore || page > 1 ? `\n第 ${page} 页` : '')
        + (status === 'tasks_empty' ? '\n\n没有未完成事项。' : status === 'tasks_page_empty' ? '\n\n本页没有事项，请查看前面的页码。'
          : '\n\n' + visible.map((item, index) => `${(page - 1) * pageSize + index + 1}. ${item.title}`).join('\n'))
        + `\n\n查询时间：${queryTime(readAt, config.timeZone)}`
        + (hasMore ? page < 100 ? `\n还有更多，发送：小婕 gtd ${listName !== undefined ? `查询${quotedList(listName)}列表的任务` : '查询任务'} 第 ${page + 1} 页` : '\n还有更多事项，已达到查询页数上限。' : '') };
  } catch (error) {
    const denied = error?.reason === 'PERMISSION_DENIED' || error?.code === 'PERMISSION_DENIED';
    const timeout = error?.code === 'QUERY_TIMEOUT';
    return { status: denied ? 'query_forbidden' : 'query_failed', code: denied ? 'PERMISSION_DENIED' : timeout ? 'QUERY_TIMEOUT' : 'READ_FAILED',
      receipt: denied ? '任务查询无提醒事项读取权限，请检查 macOS 权限；未创建或修改事项。'
        : timeout ? '任务查询读取超时；未返回空结果，未创建或修改事项。'
          : '任务查询读取失败，请检查已配置账户、列表及读取服务；未返回空结果，未创建或修改事项。' };
  } finally { clearTimeout(timer); if (onAbort) querySignal.removeEventListener('abort', onAbort); }
}

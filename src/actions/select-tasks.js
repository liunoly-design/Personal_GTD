// Complete numbered reply forms only. This module locates objects; it performs no writes.
export function selectionCandidate(text) {
  return typeof text === 'string'
    && /^(?:请)?(?:帮我)?(?:确认)?(?:选择|选中|选|查看|看看|完成|标记完成|移动|删除)?\s*第\s*[+-]?[0-9]/u.test(text.trim());
}
export function taskSelection(text) {
  let rest = text.trim().replace(/^(?:请)?(?:帮我)?(?:确认)?\s*/u, '').replace(/[。！!]$/u, '');
  if (/[，,；;]\s*$/u.test(rest)) return null;
  const number = '第\\s*(?<numbers>[0-9]+(?:\\s*[,，、和及]\\s*(?:第)?\\s*[0-9]+)*)\\s*(?:项|条|个)(?:任务|事项)?';
  const end = '(?:[，,；;]\\s*|$)';
  const forms = [
    ['complete', number + '\\s*(?:都|全部)?(?:标记为|标为|已)?完成' + end],
    ['complete', '(?:完成|标记完成)\\s*' + number + end],
    ['move', number + '\\s*(?:移动|移|挪)(?:到|至)\\s*(?<target>.+?)(?:清单|列表)' + end],
    ['select', '(?:选择|选中|选|查看|看看)?\\s*' + number + end],
  ];
  const selected = [];
  while (rest) {
    const matched = forms.map(([action, form]) => [action, rest.match(new RegExp('^' + form, 'u'))]).find(([, match]) => match);
    if (!matched) return null;
    const [action, match] = matched;
    let targetListName = match.groups.target?.trim();
    if (targetListName !== undefined) {
      if (/^(?:「[^」]+」|“[^”]+”|"[^"]+")$/u.test(targetListName)) targetListName = targetListName.slice(1,-1);
      else if (/[「」“"]|[，,；;]/u.test(targetListName)) return null;
      if (!targetListName.trim() || [...targetListName].length > 200 || /[\x00-\x1f]/u.test(targetListName)) return null;
    }
    for (const value of match.groups.numbers.split(/\s*[,，、和及]\s*(?:第)?\s*/u)) {
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n < 1 || selected.some(item => item.number === n) || selected.length >= 10) return null;
      selected.push({ number: n, action, ...(targetListName !== undefined ? { targetListName } : {}) });
    }
    rest = rest.slice(match[0].length).trim();
  }
  return selected.length ? selected : null;
}
export async function selectTasks({ snapshot, selection, reminders, config, signal }) {
  const offset = (snapshot.page - 1) * snapshot.pageSize;
  const selected = selection.map(choice => ({ ...snapshot.items[choice.number - offset - 1], ...choice }));
  if (selected.some(item => !item.id || !/^[a-f0-9]{64}$/u.test(item.revision ?? ''))) return {
    status: 'task_selection_needs_query', receipt: '这些编号不在所回复的查询页中，或旧回执缺少核对信息。请重新查询，再回复对应回执选择编号；未执行或创建事项。',
  };
  const controller = new AbortController();
  const querySignal = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
  const timeoutMs = config.queryTimeoutMs ?? 15000;
  let timer, rejectAbort;
  try {
    const response = await Promise.race([
      Promise.resolve().then(() => { querySignal.throwIfAborted(); return reminders.readTasks({ items: selected.map(({id,listId}) => ({id,listId})) }, { signal:querySignal, timeoutMs }); }),
      new Promise((_,reject) => {
        rejectAbort = () => reject(querySignal.reason);
        querySignal.addEventListener('abort',rejectAbort,{once:true});
        timer=setTimeout(() => controller.abort(Object.assign(new Error('Selection timeout'),{code:'QUERY_TIMEOUT'})),timeoutMs);
      }),
    ]);
    if (!Array.isArray(response.items) || response.items.length !== selected.length) throw new Error('Invalid selection response');
    for (let i=0;i<selected.length;i++) {
      const old=selected[i], row=response.items[i], current=row.value;
      if (row.id !== old.id) throw new Error('Invalid selection identity');
      if (row.state === 'unavailable') return {status:'task_selection_conflict',receipt:'所选事项已删除、移动或无法定位，请重新查询后选择；未执行或创建事项。'};
      if (row.state !== 'ok' || current?.id !== old.id || current.sourceId !== old.sourceId || current.listId !== old.listId) throw new Error('Invalid selection scope');
      if (current.revision !== old.revision || current.completed !== old.completed) return {status:'task_selection_conflict',receipt:'所选事项在查询后已发生变化，请重新查询后选择；未执行或创建事项。'};
    }
    const maintenance = selected.some(item => item.action !== 'select');
    return { status: maintenance ? 'task_selection_unavailable' : 'tasks_selected', selected, queryReadAt:snapshot.readAt,
      receipt: '已定位所选事项：\n' + selected.map(item => `${item.number}. ${item.title}`
        + (item.action==='complete' ? '（请求完成）' : item.action==='move' ? `（请求移动到 ${item.targetListName}）` : '')).join('\n')
        + (maintenance ? '\n\n完成、移动及批量执行尚未实现，本次未执行或修改事项。' : '\n\n本次仅定位，未修改事项。') };
  } catch (error) {
    return {status:'task_selection_failed',code:error?.reason==='PERMISSION_DENIED' ? 'PERMISSION_DENIED' : error?.code==='QUERY_TIMEOUT' ? 'QUERY_TIMEOUT' : 'READ_FAILED',
      receipt:error?.reason==='PERMISSION_DENIED' ? '所选事项核对无读取权限，请检查提醒事项权限；未执行或创建事项。'
        : error?.code==='QUERY_TIMEOUT' ? '所选事项核对超时，请保留原消息；未执行或创建事项。'
          : '所选事项读取核对失败，请检查读取服务；未执行或创建事项。'};
  } finally {clearTimeout(timer); if(rejectAbort)querySignal.removeEventListener('abort',rejectAbort);}
}

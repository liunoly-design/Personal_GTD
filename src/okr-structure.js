// Markdown heading levels are persisted as text, so the hierarchy survives
// Notes' lossy HTML export and can be validated before publication.
export function parseOkrDraft(text, { complete = false } = {}) {
  const fail = () => { throw new Error('INVALID_GUIDANCE'); };
  const lines = text.split('\n');
  const period = /^# (.+(?:年度|季度).*)（(\d{4}-\d{2}-\d{2}) 至 (\d{4}-\d{2}-\d{2})）$/u.exec(lines[0]);
  const date = s => { const d = new Date(s + 'T00:00:00Z'); return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s; };
  if (!period || !date(period[2]) || !date(period[3]) || period[2] > period[3]) fail();
  const items = [], objectives = []; let objective, item;
  for (const line of lines.slice(1)) {
    const o = /^## (#O[1-9]\d*) (\S.*)$/u.exec(line);
    const kr = /^### (#KR[1-9]\d*) (\S.*)$/u.exec(line);
    if (o) { objective = { id: o[1], count: 0 }; objectives.push(objective); item = { id: o[1], text: line, parent: null }; items.push(item); }
    else if (kr) {
      if (!objective) fail();
      objective.count++; item = { id: kr[1], text: line, parent: objective.id }; items.push(item);
    } else {
      if (/^#{1,3} /u.test(line)) fail();
      if (item) item.text += '\n' + line;
    }
  }
  const tags = text.match(/#(?:O|KR)[1-9]\d*(?!\d)/gu) ?? [];
  if (!objectives.length || items.length !== tags.length || new Set(tags).size !== tags.length
    || objectives.some(o => o.count > 5 || (complete && o.count < 3))) fail();
  return { period: lines[0], items, objectives };
}

export function validateOkrStep(previous, next) {
  if (!next) return;
  const before = previous ? parseOkrDraft(previous) : { items: [], objectives: [] };
  const after = parseOkrDraft(next);
  const old = new Map(before.items.map(x => [x.id, x]));
  const changed = after.items.filter(x => old.get(x.id)?.text.trimEnd() !== x.text.trimEnd() || old.get(x.id)?.parent !== x.parent);
  const deleted = before.items.filter(x => !after.items.some(y => y.id === x.id));
  if (changed.length + deleted.length > 1) throw new Error('MULTIPLE_OKR_ITEMS');
  const newO = after.objectives.find(o => !before.objectives.some(x => x.id === o.id));
  if (newO && before.objectives.some(o => o.count < 3)) throw new Error('INCOMPLETE_OBJECTIVE');
}

// The model proposes one item; code owns the surrounding draft and hierarchy.
export function applyOkrChange(previous, change) {
  const before = parseOkrDraft(previous);
  if (change === null) return previous;
  const fail = () => { throw new Error('INVALID_GUIDANCE'); };
  if (!change || typeof change !== 'object' || Array.isArray(change)
    || Object.keys(change).some(k => !['operation', 'id', 'parentId', 'text'].includes(k))
    || !['upsert', 'delete'].includes(change.operation) || typeof change.id !== 'string' || !/^#(?:O|KR)[1-9]\d*$/u.test(change.id)
    || !(change.parentId === null || (typeof change.parentId === 'string' && /^#O[1-9]\d*$/u.test(change.parentId)))) fail();
  const existing = before.items.find(i => i.id === change.id);
  const parent = before.items.find(i => i.id === change.parentId && i.parent === null);
  const isKr = change.id.startsWith('#KR');
  if ((isKr && !parent) || (!isKr && change.parentId !== null)
    || (existing && existing.parent !== change.parentId)) fail();
  const headings = [...previous.matchAll(/^#{2,3} (#(?:O|KR)[1-9]\d*) .*$/gmu)];
  const index = headings.findIndex(h => h[1] === change.id);
  let next;
  if (change.operation === 'delete') {
    if (!existing || change.text !== null || before.items.some(i => i.parent === change.id)) fail();
    next = previous.slice(0, headings[index].index) + previous.slice(headings[index + 1]?.index ?? previous.length);
  } else {
    if (typeof change.text !== 'string' || !change.text.trim() || change.text.length > 4000) fail();
    const text = change.text.trimEnd();
    const fragment = parseOkrDraft(before.period + '\n' + (isKr ? parent.text.split('\n')[0] + '\n' : '') + text);
    const expected = isKr ? 2 : 1;
    if (fragment.items.length !== expected || fragment.items.at(-1).id !== change.id
      || fragment.items.at(-1).parent !== change.parentId) fail();
    if (existing) {
      const end = headings[index + 1]?.index ?? previous.length;
      const separator = previous.slice(headings[index].index, end).match(/\n*$/u)[0];
      next = previous.slice(0, headings[index].index) + text + separator + previous.slice(end);
    } else {
      const parentIndex = headings.findIndex(h => h[1] === change.parentId);
      const followingO = isKr ? headings.slice(parentIndex + 1).find(h => h[1].startsWith('#O')) : null;
      const at = followingO?.index ?? previous.length;
      const prefix = previous.slice(0, at), suffix = previous.slice(at);
      next = prefix + (prefix.endsWith('\n') ? '' : '\n') + text + (suffix ? '\n' : '') + suffix;
    }
  }
  validateOkrStep(previous, next);
  return next;
}

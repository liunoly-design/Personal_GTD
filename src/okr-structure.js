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
  const changed = after.items.filter(x => old.get(x.id)?.text !== x.text || old.get(x.id)?.parent !== x.parent);
  const deleted = before.items.filter(x => !after.items.some(y => y.id === x.id));
  if (changed.length + deleted.length > 1) throw new Error('MULTIPLE_OKR_ITEMS');
  const newO = after.objectives.find(o => !before.objectives.some(x => x.id === o.id));
  if (newO && before.objectives.some(o => o.count < 3)) throw new Error('INCOMPLETE_OBJECTIVE');
}

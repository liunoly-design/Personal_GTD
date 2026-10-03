import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callApple } from '../src/apple-reminders.js';
// Authorized, bounded, current binding only. No model, Feishu send or business write.
const args = process.argv.slice(2), index = args.indexOf('--config');
if (!args.includes('--read-inbox') || index < 0 || !args[index + 1]) throw new Error('Use --read-inbox --config /absolute/private/config.json');
const config = JSON.parse(readFileSync(args[index + 1], 'utf8'));
assert.ok(config.sourceId && config.listId && config.remindersHelperPath);
const started = performance.now();
const query = async extra => callApple({ command: 'queryTasks', sourceId: config.sourceId, listId: config.listId, limit: 50, offset: 0, ...extra }, { helperPath: config.remindersHelperPath, timeoutMs: 20000 });
const baseline = await query({});
assert.equal(baseline.state, 'ok');
assert.equal(baseline.hasMore, false, 'Independent full-count verification needs a binding with <=50 unfinished items');
const keyword = [...(baseline.items[0]?.title ?? '')][0] ?? 'PGTD合成只读无匹配关键词';
const expected = baseline.items.filter(item => item.title.normalize('NFC').toLowerCase().includes(keyword.normalize('NFC').toLowerCase()));
const filtered = await query({ keyword });
assert.equal(filtered.total, expected.length);
assert.deepEqual(filtered.items.map(item => item.id), expected.map(item => item.id));
for (const item of filtered.items) {
  const original = baseline.items.find(row => row.id === item.id);
  for (const field of ['listId', 'revision', 'fieldsRevision', 'contentRevision']) assert.equal(item[field], original[field]);
}
const named = await callApple({ command: 'queryTasks', sourceId: config.sourceId, listName: baseline.list.name, keyword, limit: 50, offset: 0 }, { helperPath: config.remindersHelperPath, timeoutMs: 20000 });
assert.equal(named.state, 'ok');assert.equal(named.list.id, config.listId);assert.equal(named.total, filtered.total);
if (filtered.total > 0) {
  const second = await query({ keyword, limit: 1, offset: 1 });
  assert.equal(second.total, expected.length);assert.deepEqual(second.items.map(row => row.id), expected.slice(1, 2).map(row => row.id));
}
const empty = await query({ keyword: 'PGTD合成只读不存在关键词' });assert.equal(empty.total, 0);
console.log(JSON.stringify({ verified: true, scope: 'configured-binding-only', baselineTotal: baseline.total,
  filteredTotal: filtered.total, emptyVerified: true, namedListVerified: true, idsAndBaselinesPreserved: true,
  businessWrites: 0, modelCalls: 0, realFeishuSends: 0, durationMs: Math.round(performance.now() - started) }));

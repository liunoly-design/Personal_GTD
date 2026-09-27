import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { openOperationStore } from '../src/operation-store.js';
import { callNotes } from '../src/apple-notes.js';

const { values } = parseArgs({ options: { 'write-synthetic': { type: 'boolean' }, 'repair-only': { type: 'boolean' } } });
if (!values['write-synthetic']) throw new Error('WRITE_OPT_IN_REQUIRED');
const store = openOperationStore('runtime/okr/f104-verification.sqlite');
const binding = store.get('note'), latest = store.get('latest');
let run = store.get('native-tags-verification');
if (!run) { run = { marker: 'PGTD-NATIVE-' + randomUUID() }; store.set('native-tags-verification', run); }
store.close();
const scope = { accountId: binding.accountId, folderId: binding.folderId, noteId: latest.id };
if (values['repair-only']) {
  for (const noteId of [binding.noteId, latest.id]) {
    const note = await callNotes({ ...scope, noteId, command: 'read' });
    assert.ok(note.plaintext.includes('F104合成') || note.plaintext.includes('PGTD-F101-'));
    const repaired = await callNotes({ ...scope, noteId, command: 'ensureTags' });
    assert.equal(repaired.tagsComplete, true);
  }
  console.log(JSON.stringify({ status: 'verified', mode: 'repair-existing-synthetic-tags', modelCalls: 0 }));
  process.exit(0);
}
const started = performance.now();
const before = await callNotes({ ...scope, command: 'read' });
assert.ok(before.plaintext.includes('F104合成目标') && before.plaintext.includes('PGTD-FINAL-'));
const ensured = await callNotes({ ...scope, command: 'ensureTags' });
assert.ok(ensured.nativeTags.includes('#O1') && ensured.nativeTags.includes('#KR1'));
assert.equal(ensured.plaintext, before.plaintext);
for (const tag of before.nativeTags) assert.ok(ensured.nativeTags.includes(tag));
const twice = await callNotes({ ...scope, command: 'ensureTags' });
assert.equal(twice.body, ensured.body);
let saved = twice;
if (!saved.plaintext.includes(run.marker)) {
  saved = await callNotes({ ...scope, command: 'append', expectedBody: saved.body,
    addition: `<div>${run.marker} 原生标签追加验证</div><div>#KR2 合成标签验证</div>` });
}
assert.ok(saved.nativeTags.includes('#KR2'));
await assert.rejects(callNotes({ ...scope, command: 'replace', expectedBody: '<div>stale</div>', body: saved.body }), /CONFLICT/);
// Replace with the current full content to exercise the same UI path as publication,
// preserving fresh user edits and all existing tags. Repeating this is idempotent.
const replaced = await callNotes({ ...scope, command: 'replace', expectedBody: saved.body, body: saved.body });
assert.equal(replaced.plaintext, saved.plaintext);
for (const tag of saved.nativeTags) assert.ok(replaced.nativeTags.includes(tag));
const reread = await callNotes({ ...scope, command: 'read' });
assert.equal(reread.body, replaced.body);
assert.equal(reread.tagsComplete, true);
console.log(JSON.stringify({ status: 'verified', mode: 'real-apple-native-tags', nativeTags: reread.nativeTags,
  appendVerified: true, replaceVerified: true, userTagsPreserved: true, duplicateSuppressed: true,
  conflictRejected: true, sidebarFilterVerified: false, modelCalls: 0, durationMs: Math.round(performance.now() - started) }));

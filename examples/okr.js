import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openOkrSession } from '../src/okr-session.js';

const dir = mkdtempSync(join(tmpdir(), 'pgtd-okr-demo-'));
const notes = [];
const bridge = async r => {
  if (r.command === 'bind') return { accountId: 'demo-account', folderId: 'demo-folder' };
  if (r.command === 'create') {
    const note = { id: 'demo-note', body: r.body, plaintext: r.body.replace(/<[^>]+>/gu, '\n') }; notes.push(note); return { ...note };
  }
  if (r.command === 'find') return notes.filter(n => n.body.includes(r.marker)).map(n => ({ ...n }));
  const note = notes.find(n => n.id === r.noteId);
  if (!note) throw new Error('LOCATION_NOT_UNIQUE');
  if (r.command === 'append') {
    if (note.body !== r.expectedBody) throw new Error('CONFLICT');
    note.body += r.addition;
    note.plaintext = note.body.replaceAll('<br>', '\n').replace(/<[^>]+>/gu, '\n');
  }
  return { ...note };
};
const options = { statePath: join(dir, 'okr.sqlite'), config: { account: 'demo', folder: 'Notes' }, bridge };
let session = openOkrSession(options);
const event = (id, action, text = '') => ({ id, action, text, senderId: 'demo-user', conversationId: 'demo-chat', sentAt: '2026-09-27T10:00:00Z' });
try {
  const opened = await session.handle(event('1', 'open'));
  console.log(JSON.stringify({ mode: 'simulation', step: 'open', status: opened.status }));
  const entry = event('2', 'record', '#O1 合成目标：保持运动\n#KR1 合成结果：每周运动三次');
  await session.handle(entry);
  await session.close(); session = openOkrSession(options);
  await session.handle(entry);
  await session.handle(event('3', 'pause'));
  const paused = await session.handle(event('4', 'record', '暂停时不保存'));
  const resumed = await session.handle(event('5', 'open'));
  console.log(JSON.stringify({ mode: 'simulation', step: 'resume', sameNote: opened.noteId === resumed.noteId,
    notes: notes.length, savedOnce: notes[0].body.split('保持运动').length === 2,
    pauseWorks: paused.status === 'okr_paused', tagsPreserved: resumed.receipt.includes('#KR1'), modelCalls: 0 }));
} finally { await session.close(); rmSync(dir, { recursive: true, force: true }); }

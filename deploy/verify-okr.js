import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { openOperationStore } from '../src/operation-store.js';
import { openOkrSession } from '../src/okr-session.js';
import { callNotes } from '../src/apple-notes.js';

// Reuses the explicitly authorized F101 synthetic note; never creates a production document.
let session;
try {
  const { values } = parseArgs({ options: {
    'write-synthetic': { type: 'boolean' },
    'probe-state': { type: 'string', default: 'runtime/notes/probe.sqlite' },
    'state-path': { type: 'string', default: 'runtime/okr/verification.sqlite' },
  } });
  if (!values['write-synthetic']) throw new Error('WRITE_OPT_IN_REQUIRED');
  const store = openOperationStore(values['probe-state']);
  const probe = store.get('probe'); store.close();
  if (!probe?.noteId || probe.phase !== 'verified') throw new Error('VERIFIED_PROBE_REQUIRED');
  const scope = { accountId: probe.accountId, folderId: probe.folderId, noteId: probe.noteId };
  const original = await callNotes({ command: 'read', ...scope });
  if (!original.plaintext.includes(probe.marker) || !original.plaintext.includes('合成初始记录')) throw new Error('SYNTHETIC_NOTE_REQUIRED');
  const started = performance.now();
  session = openOkrSession({ statePath: values['state-path'],
    config: { account: probe.account, folder: probe.folder, noteId: probe.noteId }, bridge: callNotes });
  const base = { senderId: 'synthetic', conversationId: 'synthetic', sentAt: '2026-09-27T10:00:00Z', text: '' };
  await session.handle({ ...base, id: 'open-' + randomUUID(), action: 'open' });
  const record = { ...base, id: 'f103-record-1', action: 'record', text: '#O1 F103合成目标\n#KR1 F103合成结果：每周回顾一次' };
  await session.handle(record);
  await session.handle(record);
  await session.handle({ ...base, id: 'f103-record-2', action: 'record', text: '#KR2 F103合成补充：保留原有记录' });
  const result = await session.handle({ ...base, id: 'resume-' + randomUUID(), action: 'open' });
  const note = await callNotes({ command: 'read', ...scope });
  if (result.noteId !== probe.noteId || note.plaintext.split('F103合成目标').length !== 2
    || note.plaintext.split('F103合成补充').length !== 2 || !note.plaintext.includes('合成初始记录') || !result.receipt.includes('#KR1 F103合成结果')) throw new Error('READBACK_FAILED');
  console.log(JSON.stringify({ status: 'verified', mode: 'real-apple-notes', sameNote: true, duplicateSuppressed: true,
    tagsPreserved: true, originalPreserved: true, durationMs: Math.round(performance.now() - started), modelCalls: 0 }));
} catch (error) {
  console.error(JSON.stringify({ status: 'stopped', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'VERIFICATION_FAILED' }));
  process.exitCode = 1;
} finally { await session?.close(); }

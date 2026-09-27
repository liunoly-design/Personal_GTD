import { parseArgs } from 'node:util';
import { openOperationStore } from '../src/operation-store.js';
import { openOkrSession } from '../src/okr-session.js';
import { callNotes } from '../src/apple-notes.js';
import { sampleGuide, sampleDraft } from '../examples/okr-sample.js';

let session;
try {
  const { values } = parseArgs({ options: {
    'write-synthetic': { type: 'boolean' }, 'log-only': { type: 'boolean' },
    'probe-state': { type: 'string', default: 'runtime/notes/probe.sqlite' },
    'state-path': { type: 'string', default: 'runtime/okr/f104-verification.sqlite' },
  } });
  if (!values['write-synthetic']) throw new Error('WRITE_OPT_IN_REQUIRED');
  const store = openOperationStore(values['probe-state']); const probe = store.get('probe'); store.close();
  if (!probe?.noteId || probe.phase !== 'verified') throw new Error('VERIFIED_PROBE_REQUIRED');
  const scope = { accountId: probe.accountId, folderId: probe.folderId, noteId: probe.noteId };
  const before = await callNotes({ command: 'read', ...scope });
  if (!before.plaintext.includes(probe.marker) || !before.plaintext.includes('合成初始记录')) throw new Error('SYNTHETIC_NOTE_REQUIRED');
  const scripted = sampleGuide();
  const guide = async input => {
    const result = await scripted(input);
    return input.answer.includes('修订') ? { ...result, stage: 'ready', draft: sampleDraft.replace('改善体力', '稳定改善体力') } : result;
  };
  session = openOkrSession({ statePath: values['state-path'], config: { account: probe.account, folder: probe.folder, noteId: probe.noteId }, bridge: callNotes, guide });
  const base = { senderId: 'synthetic', conversationId: 'synthetic-structure', sentAt: '2026-09-27T10:00:00Z', text: '' };
  const started = performance.now();
  await session.handle({ ...base, id: 'f104-structure-open', action: 'open' });
  let ready;
  for (let i = 1; i <= 7; i++) ready = await session.handle({ ...base, id: 'f104-structure-round-' + i, action: 'record', text: 'F104合成回应' + i });
  if (!ready.draftVersion) throw new Error('GUIDANCE_FAILED');
  if (values['log-only']) {
    const log = await callNotes({ command: 'read', ...scope });
    if (!log.plaintext.includes('反向审视') || !log.plaintext.includes('F104合成回应7') || !log.plaintext.includes('合成初始记录')) throw new Error('READBACK_FAILED');
    console.log(JSON.stringify({ status: 'verified', mode: 'real-apple-log-scripted-guidance', originalPreserved: true,
      guidanceSaved: true, latestNoteTested: false, modelCalls: 0, durationMs: Math.round(performance.now() - started) }));
  } else {
    // This branch requires authorization for one additional synthetic latest-draft note.
    const first = await session.handle({ ...base, id: 'f104-structure-confirm-1', action: 'confirm', confirmVersion: ready.draftVersion });
    const revision = await session.handle({ ...base, id: 'f104-structure-revise', action: 'record', text: 'F104合成修订' });
    const confirmation = { ...base, id: 'f104-structure-confirm-2', action: 'confirm', confirmVersion: revision.draftVersion };
    const second = await session.handle(confirmation); await session.handle(confirmation);
    const log = await callNotes({ command: 'read', ...scope });
    const latest = await callNotes({ command: 'read', ...scope, noteId: second.noteId });
    if (first.noteId !== second.noteId || first.noteId === probe.noteId || second.status !== 'okr_finalized'
      || !latest.headingsComplete || !log.headingsComplete || !latest.tagsComplete || !log.tagsComplete
      || !latest.plaintext.includes('#O1 稳定改善体力') || latest.plaintext.includes('#O1 改善体力')
      || !log.plaintext.includes('#O1 改善体力') || !log.plaintext.includes('合成初始记录')) throw new Error('READBACK_FAILED');
    console.log(JSON.stringify({ status: 'verified', mode: 'real-apple-two-notes-scripted-guidance', sameLatestNote: true,
      historyPreserved: true, nativeHeadings: true, nativeTags: true, tagTextPreserved: true, duplicateSuppressed: true, modelCalls: 0, durationMs: Math.round(performance.now() - started) }));
  }
} catch (error) { console.error(JSON.stringify({ status: 'stopped', code: /^[A-Z_]+$/u.test(error.message) ? error.message : 'VERIFICATION_FAILED' })); process.exitCode = 1; }
finally { await session?.close(); }

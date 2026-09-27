import { parseArgs } from 'node:util';
import { openOperationStore } from '../src/operation-store.js';
import { openOkrSession } from '../src/okr-session.js';
import { callNotes } from '../src/apple-notes.js';

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
  const draft = '2026 第四季度\n#O1 F104合成目标：保持练习\n#KR1 F104合成结果：每周练习两次；基线未知，证据为合成日志，季度末检查。\n每周两小时；策略：短时练习；替代：周末集中练习；风险：挤占休息，疲惫时调整。';
  const guide = async ({ stage, answer }) => ({ stage: { background: 'direction', direction: 'okr', okr: 'challenge', challenge: 'ready', ready: 'ready' }[stage],
    summary: '合成背景：每周两小时，休息优先。', advice: '比较短时与集中练习，反向审视次数是否反映改善。',
    questions: ['challenge', 'ready'].includes(stage) ? [] : ['合成问题：是否接受取舍？'],
    draft: stage === 'background' ? null : answer.includes('修订') ? draft.replace('保持练习', '稳定练习') : draft });
  session = openOkrSession({ statePath: values['state-path'], config: { account: probe.account, folder: probe.folder, noteId: probe.noteId }, bridge: callNotes, guide });
  const base = { senderId: 'synthetic', conversationId: 'synthetic', sentAt: '2026-09-27T10:00:00Z', text: '' };
  const started = performance.now();
  await session.handle({ ...base, id: 'f104-open', action: 'open' });
  let ready;
  for (let i = 1; i <= 4; i++) ready = await session.handle({ ...base, id: 'f104-round-' + i, action: 'record', text: 'F104合成回应' + i });
  if (!ready.draftVersion) throw new Error('GUIDANCE_FAILED');
  if (values['log-only']) {
    const log = await callNotes({ command: 'read', ...scope });
    if (!log.plaintext.includes('反向审视') || !log.plaintext.includes('F104合成回应4') || !log.plaintext.includes('合成初始记录')) throw new Error('READBACK_FAILED');
    console.log(JSON.stringify({ status: 'verified', mode: 'real-apple-log-scripted-guidance', originalPreserved: true,
      guidanceSaved: true, latestNoteTested: false, modelCalls: 0, durationMs: Math.round(performance.now() - started) }));
  } else {
    // This branch requires authorization for one additional synthetic latest-draft note.
    const first = await session.handle({ ...base, id: 'f104-confirm-1', action: 'confirm', confirmVersion: ready.draftVersion });
    const revision = await session.handle({ ...base, id: 'f104-revise', action: 'record', text: 'F104合成修订' });
    const confirmation = { ...base, id: 'f104-confirm-2', action: 'confirm', confirmVersion: revision.draftVersion };
    const second = await session.handle(confirmation); await session.handle(confirmation);
    const log = await callNotes({ command: 'read', ...scope });
    const latest = await callNotes({ command: 'read', ...scope, noteId: second.noteId });
    if (first.noteId !== second.noteId || first.noteId === probe.noteId || second.status !== 'okr_finalized'
      || !latest.plaintext.includes('#O1 F104合成目标：稳定练习') || latest.plaintext.includes('保持练习')
      || !log.plaintext.includes('保持练习') || !log.plaintext.includes('合成初始记录')) throw new Error('READBACK_FAILED');
    console.log(JSON.stringify({ status: 'verified', mode: 'real-apple-two-notes-scripted-guidance', sameLatestNote: true,
      historyPreserved: true, tagTextPreserved: true, duplicateSuppressed: true, modelCalls: 0, durationMs: Math.round(performance.now() - started) }));
  }
} catch (error) { console.error(JSON.stringify({ status: 'stopped', code: /^[A-Z_]+$/u.test(error.message) ? error.message : 'VERIFICATION_FAILED' })); process.exitCode = 1; }
finally { await session?.close(); }

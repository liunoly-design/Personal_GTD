import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openOkrSession } from '../src/okr-session.js';

const dir = mkdtempSync(join(tmpdir(), 'pgtd-f104-demo-'));
const notes = [];
const plain = body => body.replaceAll('<br>', '\n').replace(/<[^>]+>/gu, '\n').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
const bridge = async r => {
  if (r.command === 'bind') return { accountId: 'demo-account', folderId: 'demo-folder' };
  if (r.command === 'create') { const n = { id: 'demo-' + (notes.length + 1), title: r.title, body: r.body, plaintext: plain(r.body) }; notes.push(n); return { ...n }; }
  if (r.command === 'find') return notes.filter(n => n.title === r.title && n.body.includes(r.marker)).map(n => ({ ...n }));
  const n = notes.find(n => n.id === r.noteId);
  if (!n) throw new Error('LOCATION_NOT_UNIQUE');
  if (r.command === 'append' || r.command === 'replace') {
    if (n.body !== r.expectedBody) throw new Error('CONFLICT');
    n.body = r.command === 'replace' ? r.body : n.body + r.addition; n.plaintext = plain(n.body);
  }
  return { ...n };
};
const draft = '2026 第四季度\n#O1 合成目标：建立运动习惯\n#KR1 合成结果：每周运动三次，基线未知，每周检查运动日志。\n每周两小时；策略：短时运动；替代：散步。风险：挤占睡眠；持续疲惫时调整。';
const guide = async ({ stage }) => ({ stage: { background: 'direction', direction: 'okr', okr: 'challenge', challenge: 'ready' }[stage],
  summary: '合成背景：每周两小时，不能影响睡眠。', advice: '比较短时运动与散步；反向审视次数是否能反映真实改善。',
  questions: stage === 'challenge' ? [] : ['是否接受这一取舍？'], draft: stage === 'background' ? null : draft });
const options = { statePath: join(dir, 'okr.sqlite'), config: { account: 'demo', folder: 'Notes' }, bridge, guide };
let session = openOkrSession(options);
const event = (id, action, text = '') => ({ id, action, text, senderId: 'demo', conversationId: 'demo', sentAt: '2026-09-27T10:00:00Z' });
try {
  await session.handle(event('open', 'open'));
  let ready;
  for (let i = 1; i <= 4; i++) ready = await session.handle(event('r' + i, 'record', '合成回应' + i));
  const beforeConfirm = notes.length;
  const confirmation = { ...event('confirm', 'confirm'), confirmVersion: ready.draftVersion };
  const finalized = await session.handle(confirmation);
  await session.close(); session = openOkrSession(options);
  const replay = await session.handle(confirmation);
  console.log(JSON.stringify({ mode: 'simulation', scriptedGuidance: true, beforeConfirm, afterConfirm: notes.length,
    finalized: finalized.status === 'okr_finalized', replaySameNote: replay.noteId === finalized.noteId,
    historyPreserved: notes[0].plaintext.includes('用户确认定稿'), tagsPreserved: notes[1].plaintext.includes('#KR1'), paidCalls: 0 }));
} finally { await session.close(); rmSync(dir, { recursive: true, force: true }); }

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openOkrSession } from '../src/okr-session.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-okr-'));
  const notes = [];
  const plaintext = body => body.replaceAll('<br>', '\n').replace(/<[^>]+>/gu, '').replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
  const bridge = async r => {
    if (r.command === 'bind') return { accountId: 'a1', folderId: 'f1' };
    if (r.command === 'create') { const n = { id: 'n1', body: r.body, plaintext: plaintext(r.body) }; notes.push(n); return structuredClone(n); }
    if (r.command === 'find') return structuredClone(notes.filter(n => n.body.includes(r.marker)));
    const n = notes.find(n => n.id === r.noteId);
    if (!n) throw new Error('LOCATION_NOT_UNIQUE');
    if (r.command === 'append') {
      if (r.expectedBody !== n.body) throw new Error('CONFLICT');
      n.body += r.addition; n.plaintext = plaintext(n.body);
    }
    return structuredClone(n);
  };
  const options = { statePath: join(dir, 'okr.sqlite'), config: { account: 'iCloud', folder: 'Notes' }, bridge };
  let session = openOkrSession(options);
  t.after(async () => { await session.close(); rmSync(dir, { recursive: true, force: true }); });
  return { notes, options, bridge, get session() { return session; }, async restart(override = {}) {
    await session.close(); session = openOkrSession({ ...options, ...override });
  } };
}
const event = (id, action, text = '') => ({ id, action, text, senderId: 'user', conversationId: 'chat', sentAt: '2026-09-27T10:00:00Z' });

test('启动创建固定日志，保存带标签的原文，重启后读回续接', async t => {
  const f = fixture(t);
  const opened = await f.session.handle(event('1', 'open'));
  assert.equal(opened.status, 'okr_open');
  assert.match(opened.receipt, /个人情况/);
  assert.equal((await f.session.handle(event('2', 'record', '#O1 健康\n#KR1 每周运动三次'))).status, 'okr_saved');
  await f.restart();
  const resumed = await f.session.handle(event('3', 'open'));
  assert.equal(resumed.noteId, opened.noteId);
  assert.match(resumed.receipt, /#KR1 每周运动三次/);
  assert.equal(f.notes.length, 1);
});

test('重复来源不重复写入；同 ID 改文拒绝，HTML 原文转义', async t => {
  const f = fixture(t);
  await f.session.handle(event('1', 'open'));
  const input = event('2', 'record', '#KR1 <script> & 记录');
  await f.session.handle(input);
  await f.restart();
  await f.session.handle(input);
  assert.equal(f.notes[0].body.split('&lt;script&gt;').length, 2);
  await assert.rejects(f.session.handle({ ...input, text: '不同内容' }), /EVENT_CONFLICT/);
});

test('创建响应丢失后重启按标识核对，只保留一篇日志', async t => {
  const f = fixture(t);
  await f.restart({ bridge: async r => { const value = await f.bridge(r); if (r.command === 'create') throw new Error('APPLE_TIMEOUT'); return value; } });
  await assert.rejects(f.session.handle(event('1', 'open')), /APPLE_TIMEOUT/);
  await f.restart();
  assert.equal((await f.session.handle(event('1', 'open'))).noteId, 'n1');
  assert.equal(f.notes.length, 1);
});

test('追加已落地但响应丢失，重启核对后不会重复或丢掉后续记录', async t => {
  const f = fixture(t);
  await f.session.handle(event('1', 'open'));
  await f.restart({ bridge: async r => { const value = await f.bridge(r); if (r.command === 'append') throw new Error('APPLE_TIMEOUT'); return value; } });
  await assert.rejects(f.session.handle(event('2', 'record', '#KR1 首次记录')), /APPLE_TIMEOUT/);
  await f.restart();
  await f.session.handle(event('3', 'record', '#KR2 后续记录'));
  await f.session.handle(event('2', 'record', '#KR1 首次记录'));
  assert.equal(f.notes[0].body.split('首次记录').length, 2);
  assert.match(f.notes[0].body, /后续记录/);
});

test('暂停后不保存回复；重新启动才恢复，另一个会话须独立启动', async t => {
  const f = fixture(t);
  await f.session.handle(event('1', 'open'));
  assert.equal((await f.session.handle(event('2', 'pause'))).status, 'okr_paused');
  await f.restart();
  assert.equal((await f.session.handle(event('3', 'record', '暂停期间'))).status, 'okr_paused');
  await f.session.handle(event('4', 'open'));
  assert.equal((await f.session.handle({ ...event('5', 'record', '其他会话'), conversationId: 'other' })).status, 'okr_paused');
  assert.equal((await f.session.handle(event('6', 'record', '恢复记录'))).status, 'okr_saved');
  assert.doesNotMatch(f.notes[0].body, /暂停期间|其他会话/);
});

test('超长或无效输入在 Apple 访问前拒绝，长预览明确标注截断', async t => {
  const f = fixture(t);
  for (const e of [event('1', 'record', 'x'.repeat(4001)), event('2', 'record', ' '), event('3', 'bad'), { ...event('4', 'open'), id: '' }]) {
    await assert.rejects(f.session.handle(e), /INVALID_INPUT/);
  }
  assert.equal(f.notes.length, 0);
  await f.session.handle(event('5', 'open'));
  await f.session.handle(event('6', 'record', '文字'.repeat(1800)));
  assert.match((await f.session.handle(event('7', 'open'))).receipt, /仅显示末尾/);
});

test('笔记达到容量时拒绝新增记录并保留原文', async t => {
  const f = fixture(t);
  await f.session.handle(event('1', 'open'));
  f.notes[0].body = 'x'.repeat(32760); f.notes[0].plaintext = f.notes[0].body;
  await assert.rejects(f.session.handle(event('2', 'record', '不能挤掉旧记录')), /CAPACITY_EXCEEDED/);
  assert.equal(f.notes[0].body.length, 32760);
});

test('创建结果未核实时不补建；追加未知或人工冲突阻止后续写入', async t => {
  const f = fixture(t);
  await f.restart({ bridge: async r => { if (r.command === 'create') throw new Error('APPLE_TIMEOUT'); return f.bridge(r); } });
  await assert.rejects(f.session.handle(event('1', 'open')), /APPLE_TIMEOUT/);
  await f.restart();
  await assert.rejects(f.session.handle(event('1', 'open')), /CREATE_RESULT_UNKNOWN/);
  assert.equal(f.notes.length, 0);
});

test('追加未知且外部未落地时停止；不重复写入或继续新记录', async t => {
  const f = fixture(t);
  await f.session.handle(event('1', 'open'));
  await f.restart({ bridge: async r => { if (r.command === 'append') throw new Error('APPLE_TIMEOUT'); return f.bridge(r); } });
  await assert.rejects(f.session.handle(event('2', 'record', '未落地')), /APPLE_TIMEOUT/);
  await f.restart();
  await assert.rejects(f.session.handle(event('3', 'record', '后续')), /UPDATE_RESULT_UNKNOWN/);
  assert.doesNotMatch(f.notes[0].body, /未落地|后续/);
});

test('人工编辑冲突保留外部内容，不覆盖、不另建', async t => {
  const f = fixture(t);
  await f.session.handle(event('1', 'open'));
  await f.restart({ bridge: async r => {
    if (r.command === 'append') f.notes[0].body += '<div>人工编辑</div>';
    return f.bridge(r);
  } });
  await assert.rejects(f.session.handle(event('2', 'record', '新记录')), /CONFLICT/);
  assert.match(f.notes[0].body, /人工编辑/);
  assert.doesNotMatch(f.notes[0].body, /新记录/);
});

test('跨进程占用或更改绑定拒绝；笔记丢失不创建替代', async t => {
  const f = fixture(t);
  assert.throws(() => openOkrSession(f.options), /STATE_IN_USE/);
  await f.session.handle(event('1', 'open'));
  await f.session.close();
  assert.throws(() => openOkrSession({ ...f.options, config: { account: 'iCloud', folder: 'Other' } }), /BINDING_CHANGED/);
  await f.restart();
  f.notes.length = 0;
  await assert.rejects(f.session.handle(event('2', 'open')), /LOCATION_NOT_UNIQUE/);
  assert.equal(f.notes.length, 0);
});

test('追加后读回丢失旧记录不能宣告成功，也不能继续覆盖', async t => {
  const f = fixture(t);
  await f.session.handle(event('1', 'open'));
  await f.session.handle(event('2', 'record', '必须保留的旧记录'));
  await f.restart({ bridge: async r => {
    const value = await f.bridge(r);
    if (r.command === 'append') {
      f.notes[0].body = f.notes[0].body.replace('必须保留的旧记录', '');
      f.notes[0].plaintext = f.notes[0].plaintext.replace('必须保留的旧记录', '');
    }
    return value;
  } });
  await assert.rejects(f.session.handle(event('3', 'record', '新记录')), /READBACK_FAILED/);
  await f.restart();
  await assert.rejects(f.session.handle(event('4', 'record', '后续')), /UPDATE_RESULT_UNKNOWN/);
});

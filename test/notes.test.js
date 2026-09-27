import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyNotes } from '../src/notes-probe.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-notes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const notes = [];
  const apple = async request => {
    if (request.command === 'bind') return { accountId: 'a1', folderId: 'f1' };
    if (request.command === 'create') {
      const note = { id: 'n' + (notes.length + 1), body: request.body, plaintext: request.body };
      notes.push(note); return structuredClone(note);
    }
    if (request.command === 'find') return notes.filter(n => n.body.includes(request.marker));
    const note = notes.find(n => n.id === request.noteId);
    if (!note) throw new Error('NOTE_UNAVAILABLE');
    if (request.command === 'append') {
      if (note.body !== request.expectedBody) throw new Error('CONFLICT');
      note.body += request.addition; note.plaintext = note.body;
    }
    return structuredClone(note);
  };
  return { notes, apple, options: { statePath: join(dir, 'probe.sqlite'), account: 'iCloud', folder: 'Notes', bridge: apple } };
}

test('创建并追加合成笔记，重启复用同一 ID', async t => {
  const f = fixture(t);
  const result = await verifyNotes(f.options);
  assert.equal(result.status, 'verified');
  assert.equal(result.noteId, 'n1');
  assert.match(f.notes[0].body, /合成初始记录/);
  assert.match(f.notes[0].body, /合成追加记录/);
  assert.equal((await verifyNotes(f.options)).noteId, 'n1');
  assert.equal(f.notes.length, 1);
  assert.equal(f.notes[0].body.split('合成追加记录').length, 2);
});

test('创建响应丢失后重新运行先核对，不重复创建', async t => {
  const f = fixture(t);
  await assert.rejects(verifyNotes({ ...f.options, bridge: async r => {
    const value = await f.apple(r);
    if (r.command === 'create') throw new Error('RESULT_UNKNOWN');
    return value;
  } }), /RESULT_UNKNOWN/);
  assert.equal((await verifyNotes(f.options)).status, 'verified');
  assert.equal(f.notes.length, 1);
});

test('追加响应丢失且核对无结果时停止，不重写', async t => {
  const f = fixture(t);
  await assert.rejects(verifyNotes({ ...f.options, bridge: async r => {
    if (r.command === 'append') throw new Error('RESULT_UNKNOWN');
    return f.apple(r);
  } }), /RESULT_UNKNOWN/);
  await assert.rejects(verifyNotes(f.options), /UPDATE_RESULT_UNKNOWN/);
  assert.doesNotMatch(f.notes[0].body, /合成追加记录/);
});

test('另一个验证进程持有状态时拒绝并行写入', async t => {
  const f = fixture(t);
  let release;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const first = verifyNotes({ ...f.options, bridge: async r => {
    if (r.command === 'bind') { entered(); await pending; }
    return f.apple(r);
  } });
  await ready;
  try { await assert.rejects(verifyNotes(f.options), /STATE_IN_USE/); }
  finally { release(); await first; }
});

test('账户读取失败不创建笔记，恢复读取后可重新开始', async t => {
  const f = fixture(t);
  await assert.rejects(verifyNotes({ ...f.options, bridge: async () => { throw new Error('PERMISSION_DENIED'); } }), /PERMISSION_DENIED/);
  assert.equal(f.notes.length, 0);
  assert.equal((await verifyNotes(f.options)).status, 'verified');
});

test('创建结果未知且没有候选时停止，不能因未查到而新建', async t => {
  const f = fixture(t);
  await assert.rejects(verifyNotes({ ...f.options, bridge: async r => {
    if (r.command === 'create') throw new Error('RESULT_UNKNOWN');
    return f.apple(r);
  } }), /RESULT_UNKNOWN/);
  await assert.rejects(verifyNotes(f.options), /CREATE_RESULT_UNKNOWN/);
  assert.equal(f.notes.length, 0);
});

test('追加已生效但响应丢失，重启后读回同一笔记且不重复追加', async t => {
  const f = fixture(t);
  await assert.rejects(verifyNotes({ ...f.options, bridge: async r => {
    const value = await f.apple(r);
    if (r.command === 'append') throw new Error('RESULT_UNKNOWN');
    return value;
  } }), /RESULT_UNKNOWN/);
  assert.equal((await verifyNotes(f.options)).noteId, 'n1');
  assert.equal(f.notes[0].body.split('合成追加记录').length, 2);
});

test('读后发生人工编辑则冲突停止并保留人工内容', async t => {
  const f = fixture(t);
  await assert.rejects(verifyNotes({ ...f.options, bridge: async r => {
    if (r.command === 'append') { f.notes[0].body += '<div>人工编辑</div>'; }
    return f.apple(r);
  } }), /CONFLICT/);
  assert.match(f.notes[0].body, /人工编辑/);
  assert.doesNotMatch(f.notes[0].body, /合成追加记录/);
  await assert.rejects(verifyNotes(f.options), /UPDATE_RESULT_UNKNOWN/);
});

test('更换位置或原笔记不再可读时停止，不另建笔记', async t => {
  const f = fixture(t);
  await verifyNotes(f.options);
  await assert.rejects(verifyNotes({ ...f.options, folder: 'Other' }), /BINDING_CHANGED/);
  f.notes.length = 0;
  await assert.rejects(verifyNotes(f.options), /NOTE_UNAVAILABLE/);
  assert.equal(f.notes.length, 0);
});

test('读回丢失初始记录时不能报告验证成功', async t => {
  const f = fixture(t);
  await assert.rejects(verifyNotes({ ...f.options, bridge: async r => {
    const value = await f.apple(r);
    if (r.command === 'append') {
      f.notes[0].body = f.notes[0].body.replace('合成初始记录', '');
      f.notes[0].plaintext = f.notes[0].body;
    }
    return value;
  } }), /READBACK_FAILED/);
});

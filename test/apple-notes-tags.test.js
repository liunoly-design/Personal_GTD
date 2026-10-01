import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotesBridge } from '../src/apple-notes.js';

// External Notes scripting export loses native tag text. The editor is the
// independently observable source for that text and native tag membership.
function apple() {
  let text = 'PGTD OKR 最新稿\n#O1 练习\n#OK1\n', writes = 0;
  const editor = async input => {
    if (input.command === 'replace') { writes++; text = 'PGTD OKR 最新稿\n#KR1 两次\n#OK1\n'; }
    return { plaintext: text, nativeTags: text.includes('#KR1') ? ['#KR1', '#OK1'] : ['#O1', '#OK1'] };
  };
  const script = async input => ({ id: 'note-1', body: '<div>练习</div>', plaintext: 'PGTD OKR 最新稿\n￼ 练习\n￼\n' });
  return { bridge: createNotesBridge({ script, editor }), writes: () => writes };
}
const scope = { accountId: 'a', folderId: 'f', noteId: 'note-1' };
test('读取 Apple 原生标签文字，供 Review 和快照比较使用', async () => {
  const { bridge } = apple();
  const note = await bridge({ ...scope, command: 'read' });
  assert.equal(note.plaintext, 'PGTD OKR 最新稿\n#O1 练习\n#OK1\n');
  assert.deepEqual(note.nativeTags, ['#O1', '#OK1']);
  assert.equal(note.tagsComplete, true);
  assert.equal(note.body, '<div>PGTD OKR 最新稿<br>#O1 练习<br>#OK1</div>');
});
test('原生标签参与冲突检测，过期快照不覆盖文档', async () => {
  const f = apple();
  await assert.rejects(f.bridge({ ...scope, command: 'replace', expectedBody: '<div>练习</div>', body: '<div>new</div>' }), /CONFLICT/);
  assert.equal(f.writes(), 0);
});

test('创建后的原生标签缺失返回失败，不能把正文中的井号当作成功', async () => {
  const bridge = createNotesBridge({
    script: async () => ({ id: 'created', plaintext: '#O1 合成目标\n' }),
    editor: async () => ({ plaintext: '#O1 合成目标\n', nativeTags: [] }),
  });
  await assert.rejects(bridge({ ...scope, command: 'create', title: 'PGTD OKR 日志', body: '<div>#O1 合成目标</div>' }), /TAG_WRITE_INCOMPLETE/);
});

test('切换笔记后编辑器尚未同步，重新取得快照再只读核对', async () => {
  let shows = 0;
  const bridge = createNotesBridge({
    script: async input => { assert.equal(input.command, 'show'); return { id: 'note-1', plaintext: ++shows === 1 ? '旧快照' : '同步后的内容' }; },
    editor: async input => {
      assert.equal(input.command, 'read');
      if (input.rawPlaintext === '旧快照') throw new Error('CONFLICT');
      return { plaintext: '同步后的内容', nativeTags: [] };
    },
  });
  assert.equal((await bridge({ ...scope, command: 'read' })).plaintext, '同步后的内容');
  assert.equal(shows, 2);
});

test('持续读取冲突最多核对两次，写入冲突不重试', async () => {
  let reads = 0, writes = 0;
  const bridge = createNotesBridge({
    script: async () => ({ id: 'note-1', plaintext: '原文' }),
    editor: async input => {
      if (input.command === 'read') {
        reads++;
        if (!writes) throw new Error('CONFLICT');
        return { plaintext: '原文', nativeTags: [] };
      }
      writes++;
      throw new Error('CONFLICT');
    },
  });
  await assert.rejects(bridge({ ...scope, command: 'read' }), /CONFLICT/);
  assert.equal(reads, 2);
  writes = 1;
  await assert.rejects(bridge({ ...scope, command: 'append', expectedBody: '<div>原文</div>', addition: '<div>新增</div>' }), /CONFLICT/);
  assert.equal(writes, 2);
});

test('较长 OKR 日志默认保留足够的有界读取预算，显式短预算仍生效', async () => {
  const budgets = [];
  const bridge = createNotesBridge({
    script: async () => ({ id: 'note-1', plaintext: '日志' }),
    editor: async (_input, remainingMs) => {
      budgets.push(remainingMs);
      if (remainingMs < 25000) throw new Error('APPLE_TIMEOUT');
      return { plaintext: '日志', nativeTags: [] };
    },
  });
  assert.equal((await bridge({ ...scope, command: 'read' })).plaintext, '日志');
  assert.ok(budgets[0] >= 25000 && budgets[0] <= 60000);
  await assert.rejects(bridge({ ...scope, command: 'read' }, { timeoutMs: 15000 }), /APPLE_TIMEOUT/);
});

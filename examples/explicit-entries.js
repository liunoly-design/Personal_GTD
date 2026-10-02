import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFeishuCapture } from '../src/feishu-capture.js';
import { openPersistentSimulation } from '../src/persistent-simulation.js';
import { openOperationStore } from '../src/operation-store.js';
import { simulatedAnalysis } from '../src/simulation.js';

const [stage, stateDir] = process.argv.slice(2);
if (!stage) {
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-entries-'));
  const start = performance.now();
  try {
    for (const phase of ['legacy', 'resume']) {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), phase, dir], { encoding: 'utf8' });
      if (child.status !== 0) throw new Error(child.stderr || child.stdout || 'Child failed');
      console.log(child.stdout.trim());
    }
    console.log(JSON.stringify({ mode: 'simulation', processes: 2, elapsedMs: Math.round(performance.now() - start),
      routingModelCalls: 0, paidCalls: 0, liveWrites: 0, failures: 0 }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
} else {
  assert.ok(['legacy', 'resume'].includes(stage));
  const dataPath = join(stateDir, 'synthetic.json');
  const data = stage === 'legacy' ? { messages: {}, notes: [], receipts: [], calls: 0 } : JSON.parse(readFileSync(dataPath, 'utf8'));
  const config = { accountId: 'default', entryAgentId: 'xiaojie', allowedSenderIds: ['ou_demo'], allowedConversationIds: ['oc_demo'],
    okr: { account: 'synthetic', folder: 'Notes' } };
  const reminders = openPersistentSimulation({ path: join(stateDir, 'external.sqlite') });
  const feishu = { async getMessage(id) { return data.messages[id]; }, async reply(input) {
    const value = { ...input, message_id: 'om_bot_' + data.receipts.length, chat_id: input.conversationId };
    data.receipts.push(value); return value;
  } };
  const notesBridge = async r => {
    if (r.command === 'bind') return { accountId: 'a_demo', folderId: 'f_demo' };
    if (r.command === 'create') {
      const n = { id: 'n_demo_' + data.notes.length, body: r.body, plaintext: r.body.replaceAll('<br>', '\n') };
      data.notes.push(n); return { ...n };
    }
    const n = data.notes.find(n => n.id === r.noteId);
    assert.ok(n);
    if (r.command === 'append') { assert.equal(n.body, r.expectedBody); n.body += r.addition; n.plaintext = n.body.replaceAll('<br>', '\n'); }
    return { ...n };
  };
  const capture = openFeishuCapture({ stateDir, config, reminders, feishu, notesBridge,
    analyze: async args => { data.calls++; return simulatedAnalysis(args); }, now: () => '2026-10-01T02:00:00Z' });
  const statuses = [];
  async function send(id, text, parent_id) {
    data.messages[id] ??= { message_id: id, chat_id: 'oc_demo', sender: { id: 'ou_demo', id_type: 'open_id', sender_type: 'user' },
      msg_type: 'text', create_time: '1790820000000', body: { content: JSON.stringify({ text }) }, ...(parent_id ? { parent_id } : {}) };
    const result = await capture.handle({ Provider: 'feishu', AccountId: 'default', AgentId: 'xiaojie', SenderId: 'ou_demo',
      NativeChannelId: 'oc_demo', MessageSid: id, rawText: text, ReplyToId: parent_id });
    statuses.push(result.status); return result;
  }
  try {
    if (stage === 'legacy') {
      assert.equal((await send('om_link', '小婕 gtd https://example.org/synthetic')).status, 'awaiting_confirmation');
      data.linkReply = data.receipts.at(-1).message_id;
      assert.equal((await send('om_old', '小婕 gtd okr 讨论')).status, 'okr_open');
      data.okrReply = data.receipts.at(-1).message_id;
      assert.equal((await send('om_old_answer', '合成旧回答', data.okrReply)).status, 'okr_saved');
    } else {
      const before = data.receipts.length;
      await send('om_old_answer', '合成旧回答', data.okrReply);
      assert.equal(data.receipts.length, before);
      assert.equal((await send('om_resume', '合成新进程回答', data.okrReply)).status, 'okr_saved');
      assert.equal((await send('om_new', '小婕 OKR：续接')).status, 'okr_open');
      assert.equal((await send('om_record', '小婕 okr 记录：合成新入口回答')).status, 'okr_saved');
      assert.equal((await send('om_confirm_link', '确认', data.linkReply)).status, 'collected');
      assert.equal((await send('om_gtd', '小婕gtd 买牛奶')).status, 'collected');
      assert.equal((await send('om_review', '小婕review 注册周复盘')).status, 'review_unavailable');
      const receipts = data.receipts.length;
      await send('om_review', '小婕review 注册周复盘');
      assert.equal(data.receipts.length, receipts);
      const query = await send('om_query', '小婕 gtd 查询任务');
      assert.equal(query.status, 'tasks_found');
      assert.equal(query.total, 2);
      assert.equal(query.items.length, 2);
      assert.equal((await capture.recover()).length, 0);
      assert.equal(data.notes.length, 1);
      assert.equal(data.notes[0].body.split('合成旧回答').length, 2);
      assert.equal((await reminders.listItems()).length, 2);
    }
    console.log(JSON.stringify({ mode: 'simulation', stage, statuses, notes: data.notes.length,
      items: (await reminders.listItems()).length, receipts: data.receipts.length, analysisCalls: data.calls }));
  } finally {
    await capture.close(); reminders.close();
    writeFileSync(dataPath, JSON.stringify(data));
  }
  if (stage === 'legacy') {
    // A synthetic fixture of the pre-F601 Feishu metadata layout. No private DB is read.
    const store = openOperationStore(join(stateDir, 'feishu.sqlite'));
    try {
      for (const prefix of ['source:', 'reply:']) for (const [key, value] of store.entries(prefix)) {
        delete value.eventHash; delete value.event;
        if (value.route === 'gtd') delete value.route;
        store.set(key, value);
      }
    } finally { store.close(); }
  }
}

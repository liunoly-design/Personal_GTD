import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDurableCapture } from '../src/durable-capture.js';
import { createSimulatedReminders, simulatedAnalysis } from '../src/simulation.js';

const event = (text = '小婕 GTD，收集：同名想法', extra = {}) => ({
  id: 'm1', senderId: 'demo-user', conversationId: 'demo-chat',
  sentAt: '2026-09-27T10:00:00+08:00', type: 'text', text, ...extra,
});
function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-recovery-'));
  const reminders = options.reminders ?? createSimulatedReminders();
  const capture = openDurableCapture({ journalPath: join(dir, 'operations.sqlite'), reminders,
    analyze: simulatedAnalysis, now: () => '2026-09-27T02:00:00Z', ...options });
  t.after(async () => { await capture.close(); rmSync(dir, { recursive: true, force: true }); });
  return { capture, reminders, dir };
}

test('同一事件并发或重复投递只创建一次，不同事件同名也分别保存', async t => {
  const { capture, reminders } = fixture(t);
  const [a, b] = await Promise.all([capture.handle(event()), capture.handle(event())]);
  assert.equal(a.itemId, b.itemId);
  assert.equal(a.status, 'collected');
  const c = await capture.handle(event(undefined, { id: 'm2' }));
  assert.notEqual(c.itemId, a.itemId);
  assert.equal((await reminders.listItems()).length, 2);
  assert.equal((await reminders.listLists()).length, 1);
});

test('重启保留待澄清关联，重复旧消息返回原结果', async t => {
  const { capture, reminders, dir } = fixture(t);
  const first = await capture.handle(event('小婕 GTD，提醒我明天交报价'));
  await capture.close();
  const restarted = openDurableCapture({ journalPath: join(dir, 'operations.sqlite'), reminders,
    analyze: simulatedAnalysis, now: () => '2026-09-27T02:00:00Z' });
  try {
    const result = await restarted.handle(event('15:00', { id: 'reply', replyTo: 'm1' }));
    assert.equal(result.status, 'reminder_set');
    assert.equal(result.itemId, first.itemId);
    assert.equal((await reminders.getItem(first.itemId)).remindAt, '2026-09-28T07:00:00Z');
    assert.equal((await reminders.listItems()).length, 1);
  } finally { await restarted.close(); }
});

test('事项创建响应丢失，重投先核对已应用操作，不重复创建', async t => {
  const reminders = createSimulatedReminders({ loseCreateResponse: true });
  const { capture } = fixture(t, { reminders });
  const first = await capture.handle(event());
  assert.equal(first.status, 'result_unknown');
  const recovered = await capture.handle(event());
  assert.equal(recovered.status, 'collected');
  assert.equal((await reminders.listItems()).length, 1);
  assert.equal((await reminders.getItem(recovered.itemId)).notes.includes('同名想法'), true);
});

test('结果未知时暂停其他事件，同一 ID 的不同正文不能覆盖原操作', async t => {
  const { capture, reminders } = fixture(t, { reminders: createSimulatedReminders({ loseCreateResponse: true }) });
  await capture.handle(event());
  assert.equal((await capture.handle(event('小婕 GTD，收集：篡改内容'))).status, 'event_conflict');
  assert.equal((await capture.handle(event(undefined, { id: 'new' }))).status, 'recovery_required');
  assert.equal((await reminders.listItems()).length, 1);
  assert.equal((await capture.handle(null)).status, 'invalid_event');
});

test('同一日志只能有一个活动处理者，关闭后允许重新打开', async t => {
  const { capture, reminders, dir } = fixture(t);
  const options = { journalPath: join(dir, 'operations.sqlite'), reminders, analyze: simulatedAnalysis };
  assert.throws(() => openDurableCapture(options), /busy/);
  await capture.close();
  const reopened = openDurableCapture(options);
  await reopened.close();
});

test('明确拒绝的重试次数持久化耗尽，其他事件不再触发无限重试', async t => {
  const { capture, reminders } = fixture(t, { reminders: createSimulatedReminders({ rejectWrites: true }),
    config: { maxWriteAttempts: 2 } });
  await capture.handle(event());
  await capture.handle(event());
  const last = await capture.handle(event());
  assert.equal(last.recovery, 'budget_exhausted');
  assert.equal((await reminders.listItems()).length, 0);
});

test('分析输出超限降级收集，不保存超限建议', async t => {
  const { capture, reminders } = fixture(t, { config: { maxAnalysisOutputChars: 20 } });
  const result = await capture.handle(event());
  assert.equal(result.status, 'collected_analysis_failed');
  assert.equal((await reminders.getItem(result.itemId)).notes, '原文：\n' + event().text);
});

test('外部状态无法核实则不重复写，耗尽后停止调用', async t => {
  let writes = 0; let queries = 0;
  const external = createSimulatedReminders();
  const reminders = { ...external,
    createItem: async () => { writes++; throw new Error('unknown'); },
    getOperation: async () => { queries++; return { state: 'unknown' }; },
  };
  const { capture } = fixture(t, { reminders, config: { maxReconcileAttempts: 1 } });
  await capture.handle(event());
  await capture.handle(event());
  assert.equal((await capture.handle(event())).recovery, 'budget_exhausted');
  await capture.handle(event());
  assert.equal(writes, 1);
  assert.equal(queries, 1);
});

test('回执失败后恢复只补回执，不再调用分析或创建事项', async t => {
  let calls = 0; let sends = 0;
  const receipts = {
    getOperation: async () => ({ state: 'absent' }),
    send: async () => { if (++sends === 1) throw new Error('offline'); return { id: 'receipt-1' }; },
  };
  const { capture, reminders } = fixture(t, { receipts, analyze: async args => { calls++; return simulatedAnalysis(args); } });
  const first = await capture.handle(event());
  assert.equal(first.delivery, 'pending');
  const [recovered] = await capture.recover();
  assert.equal(recovered.delivery, 'sent');
  assert.equal(recovered.itemId, first.itemId);
  assert.equal(calls, 1);
  assert.equal(sends, 2);
  assert.equal((await reminders.listItems()).length, 1);
});

test('独立进程在外部创建成功后被终止，重启核对后只保留一个事项和一条回执', async () => {
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-crash-'));
  try {
    const first = spawnSync(process.execPath, ['examples/recovery-worker.js', dir, 'crash'], { encoding: 'utf8' });
    assert.equal(first.signal, 'SIGKILL');
    const second = spawnSync(process.execPath, ['examples/recovery-worker.js', dir, 'recover'], { encoding: 'utf8' });
    assert.equal(second.status, 0, second.stderr);
    const result = JSON.parse(second.stdout);
    assert.equal(result.items, 1);
    assert.equal(result.receipts, 1);
    assert.equal(result.results[0].status, 'collected');
    const third = spawnSync(process.execPath, ['examples/recovery-worker.js', dir, 'recover'], { encoding: 'utf8' });
    assert.equal(third.status, 0, third.stderr);
    assert.deepEqual(JSON.parse(third.stdout).results, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('提醒已写入但响应丢失，恢复时即使时间已过也核对成功结果', async t => {
  let clock = '2026-09-27T02:00:00Z';
  const { capture, reminders } = fixture(t, { reminders: createSimulatedReminders({ loseReminderResponse: true }), now: () => clock });
  const input = event('小婕 GTD，提醒我今天15:00交报价');
  assert.equal((await capture.handle(input)).status, 'reminder_result_unknown');
  clock = '2026-09-28T02:00:00Z';
  const [recovered] = await capture.recover();
  assert.equal(recovered.status, 'reminder_set');
  assert.equal((await reminders.listItems()).length, 1);
  assert.equal((await reminders.getItem(recovered.itemId)).remindAt, '2026-09-27T07:00:00Z');
});

test('分析和外部查询超时受限，重启不会再次调用模型', async t => {
  let calls = 0;
  const { capture, reminders, dir } = fixture(t, { config: { analysisTimeoutMs: 5 },
    analyze: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 30)); return { title: '迟到', suggestion: '阅读。' }; } });
  const first = await capture.handle(event());
  assert.equal(first.status, 'collected_analysis_failed');
  await capture.close();
  await new Promise(resolve => setTimeout(resolve, 40));
  const restarted = openDurableCapture({ journalPath: join(dir, 'operations.sqlite'), reminders,
    analyze: async () => { calls++; throw new Error('should not call'); } });
  try {
    assert.equal((await restarted.handle(event())).itemId, first.itemId);
    assert.equal(calls, 1);
  } finally { await restarted.close(); }
});

test('列表创建响应丢失后按外部列表恢复，不创建第二个 Inbox', async t => {
  const external = createSimulatedReminders();
  const reminders = { ...external, createList: async (...args) => { await external.createList(...args); throw new Error('lost'); } };
  const { capture } = fixture(t, { reminders });
  assert.equal((await capture.handle(event())).status, 'result_unknown');
  assert.equal((await capture.recover())[0].status, 'collected');
  assert.equal((await reminders.listLists()).length, 1);
  assert.equal((await reminders.listItems()).length, 1);
});

test('回执已发送但响应丢失，重启只核对、不重发', async t => {
  const { openPersistentSimulation } = await import('../src/persistent-simulation.js');
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-receipts-'));
  const external = openPersistentSimulation({ path: join(dir, 'external.sqlite'),
    afterWrite: kind => { if (kind === 'receipt') throw new Error('lost'); } });
  const options = { journalPath: join(dir, 'operations.sqlite'), reminders: external, receipts: external, analyze: simulatedAnalysis };
  const first = openDurableCapture(options);
  try {
    assert.equal((await first.handle(event())).delivery, 'pending');
    await first.close();
    const second = openDurableCapture(options);
    try {
      assert.equal((await second.recover())[0].delivery, 'sent');
      assert.equal((await external.listReceipts()).length, 1);
      assert.equal((await external.listItems()).length, 1);
    } finally { await second.close(); }
  } finally { await first.close(); external.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('重启后仍按当前权限检查重复事件，禁用发送者不会得到缓存正文', async t => {
  const { capture, reminders, dir } = fixture(t);
  await capture.handle(event());
  await capture.close();
  const next = openDurableCapture({ journalPath: join(dir, 'operations.sqlite'), reminders,
    analyze: simulatedAnalysis, config: { allowedSenderIds: [] } });
  try { assert.deepEqual(await next.handle(event()), { status: 'forbidden', receipt: null }); }
  finally { await next.close(); }
});

test('外部读取永不返回时有超时和总恢复次数上限', async t => {
  let reads = 0;
  const reminders = { ...createSimulatedReminders(), listLists: async () => { reads++; return new Promise(() => {}); } };
  const { capture } = fixture(t, { reminders, config: { externalTimeoutMs: 5, maxRecoveryAttempts: 2 } });
  await capture.handle(event());
  await capture.recover();
  assert.equal((await capture.recover())[0].recovery, 'budget_exhausted');
  await capture.handle(event());
  assert.equal(reads, 2);
});

test('普通聊天不占恢复日志容量，完整事件过大不保存', async t => {
  const { capture } = fixture(t, { config: { maxStoredEvents: 1, maxEventChars: 1000 } });
  assert.equal((await capture.handle(event('普通聊天', { id: 'chat' }))).status, 'not_handled');
  assert.equal((await capture.handle(event(undefined, { id: 'x'.repeat(1001) }))).status, 'input_too_large');
  assert.equal((await capture.handle(event())).status, 'collected');
  assert.equal((await capture.handle(event(undefined, { id: 'new' }))).status, 'budget_exhausted');
});

test('事项成功而提醒明确失败，恢复只修复原对象', async t => {
  const external = createSimulatedReminders();
  let failed = false;
  const reminders = { ...external, setReminder: async (...args) => {
    if (!failed) { failed = true; throw Object.assign(new Error('rejected'), { code: 'WRITE_REJECTED' }); }
    return external.setReminder(...args);
  } };
  const { capture } = fixture(t, { reminders });
  const result = await capture.handle(event('小婕 GTD，提醒我明天15:00交报价'));
  assert.equal(result.status, 'collected_reminder_failed');
  const [recovered] = await capture.recover();
  assert.equal(recovered.status, 'reminder_set');
  assert.equal(recovered.itemId, result.itemId);
  assert.equal((await reminders.listItems()).length, 1);
});

test('裸链接确认和写入预算均跨重启保存', async t => {
  const { capture, reminders, dir } = fixture(t);
  await capture.handle(event('小婕 GTD，https://example.org/article'));
  await capture.close();
  const second = openDurableCapture({ journalPath: join(dir, 'operations.sqlite'), reminders, analyze: simulatedAnalysis });
  try {
    const reply = event('确认', { id: 'reply', replyTo: 'm1' });
    const saved = await second.handle(reply);
    assert.equal(saved.status, 'collected');
    assert.equal((await reminders.getItem(saved.itemId)).notes.includes('https://example.org/article'), true);
    assert.equal((await second.handle(reply)).itemId, saved.itemId);
  } finally { await second.close(); }
});

test('预算耗尽后重启不再进行外部调用', async t => {
  let writes = 0;
  const reminders = { ...createSimulatedReminders({ rejectWrites: true }),
    createList: async () => { writes++; throw new Error('unavailable'); } };
  const { capture, dir } = fixture(t, { reminders, config: { maxRecoveryAttempts: 1 } });
  await capture.handle(event());
  await capture.close();
  const second = openDurableCapture({ journalPath: join(dir, 'operations.sqlite'), reminders, analyze: simulatedAnalysis,
    config: { maxRecoveryAttempts: 1 } });
  try {
    assert.equal((await second.recover())[0].recovery, 'budget_exhausted');
    await second.recover();
    assert.equal(writes, 1);
  } finally { await second.close(); }
});

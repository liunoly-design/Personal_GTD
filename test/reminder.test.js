import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapture } from '../src/capture.js';
import { createSimulatedReminders, simulatedAnalysis } from '../src/simulation.js';

const event = (text, extra = {}) => ({
  id: 'request-1', senderId: 'demo-user', conversationId: 'demo-chat',
  sentAt: '2026-09-27T10:00:00+08:00', type: 'text', text, ...extra,
});
function setup(options = {}) {
  const reminders = options.reminders ?? createSimulatedReminders();
  const capture = createCapture({ reminders, analyze: simulatedAnalysis,
    now: () => '2026-09-27T02:00:00Z', ...options });
  return { capture, reminders };
}

test('明确提醒时间设置在同一 Inbox 事项上，原文保留且回执含日期与时区', async () => {
  const { capture, reminders } = setup();
  const original = '小婕 GTD，提醒我明天下午三点交报价';
  const result = await capture.handle(event(original));
  assert.equal(result.status, 'reminder_set');
  assert.equal(result.remindAt, '2026-09-28T07:00:00Z');
  const item = await reminders.getItem(result.itemId);
  assert.equal(item.remindAt, '2026-09-28T07:00:00Z');
  assert.match(item.notes, /原文：\n小婕 GTD，提醒我明天下午三点交报价/);
  assert.match(result.receipt, /2026-09-28.*15:00.*Asia\/Shanghai/);
  assert.equal((await reminders.listItems()).length, 1);
});

test('默认时区可配置，显式时区优先，日期以消息发送时刻所在时区为准', async () => {
  const tokyo = setup({ config: { timeZone: 'Asia/Tokyo' } });
  const defaultZone = await tokyo.capture.handle(event('小婕 GTD，提醒我明天下午三点交报价'));
  assert.equal(defaultZone.remindAt, '2026-09-28T06:00:00Z');
  const explicit = await tokyo.capture.handle(event('小婕 GTD，提醒我北京时间2026-09-28 15:00交报价', { id: 'explicit' }));
  assert.equal(explicit.remindAt, '2026-09-28T07:00:00Z');
  assert.equal(explicit.timeZone, 'Asia/Shanghai');
  const utc = await tokyo.capture.handle(event('小婕 GTD，提醒我[UTC]明天15:00交报价', {
    id: 'utc', sentAt: '2026-09-28T01:00:00+08:00',
  }));
  assert.equal(utc.remindAt, '2026-09-28T15:00:00Z');
});

test('时间不明确先收集，关联回复更新原事项且不替换原文', async () => {
  const { capture, reminders } = setup();
  const original = '小婕 GTD，提醒我下周找老王聊一下';
  const first = await capture.handle(event(original));
  assert.equal(first.status, 'collected_awaiting_time');
  assert.equal((await reminders.getItem(first.itemId)).remindAt, null);
  const reply = await capture.handle(event('2026-09-30 15:00', { id: 'reply-1', replyTo: 'request-1' }));
  assert.equal(reply.status, 'reminder_set');
  assert.equal(reply.itemId, first.itemId);
  assert.equal(reply.remindAt, '2026-09-30T07:00:00Z');
  assert.match((await reminders.getItem(first.itemId)).notes, /原文：\n小婕 GTD，提醒我下周找老王聊一下/);
  assert.equal((await reminders.listItems()).length, 1);
});

test('只补充时刻沿用原请求的已知日期，跨日回复不让明天漂移', async () => {
  const { capture, reminders } = setup();
  const first = await capture.handle(event('小婕 GTD，提醒我明天交报价'));
  const result = await capture.handle(event('15:00', { id: 'reply', replyTo: 'request-1', sentAt: '2026-09-28T09:00:00+08:00' }));
  assert.equal(result.status, 'reminder_set');
  assert.equal(result.itemId, first.itemId);
  assert.equal((await reminders.getItem(first.itemId)).remindAt, '2026-09-28T07:00:00Z');
});

test('时间已过先保留事项并追问，不立即提醒或自动顺延', async () => {
  const { capture, reminders } = setup({ now: () => '2026-09-29T00:00:00Z' });
  const result = await capture.handle(event('小婕 GTD，提醒我明天下午三点交报价'));
  assert.equal(result.status, 'collected_awaiting_time');
  assert.equal(result.timeIssue, 'past');
  assert.match(result.receipt, /已过去/);
  assert.equal((await reminders.getItem(result.itemId)).remindAt, null);
  const updated = await capture.handle(event('2026-09-30 15:00', { id: 'later', replyTo: 'request-1', sentAt: '2026-09-29T09:00:00+08:00' }));
  assert.equal(updated.status, 'reminder_set');
  assert.equal(updated.itemId, result.itemId);
});

test('多条待补时间必须明确关联，其他已授权用户或会话也不能串改', async () => {
  const { capture, reminders } = setup({ config: {
    allowedSenderIds: ['demo-user', 'other-user'], allowedConversationIds: ['demo-chat', 'other-chat'],
  } });
  const first = await capture.handle(event('小婕 GTD，提醒我明天交报价'));
  const second = await capture.handle(event('小婕 GTD，提醒我明天整理材料', { id: 'request-2' }));
  assert.equal((await capture.handle(event('15:00', { id: 'unlinked' }))).status, 'needs_target');
  for (const extra of [{ senderId: 'other-user' }, { conversationId: 'other-chat' }]) {
    assert.notEqual((await capture.handle(event('15:00', { id: 'foreign', replyTo: 'request-1', ...extra }))).status, 'reminder_set');
  }
  const result = await capture.handle(event('15:00', { id: 'reply', replyTo: 'request-2' }));
  assert.equal(result.itemId, second.itemId);
  assert.equal((await reminders.getItem(first.itemId)).remindAt, null);
  assert.equal((await reminders.getItem(second.itemId)).remindAt, '2026-09-28T07:00:00Z');
  assert.equal((await reminders.listItems()).length, 2);
});

test('时间分析失败仍收集，回执说明失败，补充后正常设置', async () => {
  const { capture, reminders } = setup({ analyze: async args => {
    if (args.content.includes('交报价')) throw new Error('simulated outage');
    return simulatedAnalysis(args);
  } });
  const first = await capture.handle(event('小婕 GTD，提醒我明天下午三点交报价'));
  assert.equal(first.status, 'collected_awaiting_time');
  assert.match(first.receipt, /分析未完成/);
  assert.equal((await reminders.getItem(first.itemId)).remindAt, null);
  assert.doesNotMatch((await reminders.getItem(first.itemId)).notes, /小婕的建议/);
  const result = await capture.handle(event('2026-09-28 15:00', { id: 'reply', replyTo: 'request-1' }));
  assert.equal(result.status, 'reminder_set');
  assert.equal(result.itemId, first.itemId);
});

test('提醒更新明确失败保留事项 ID，结果未知时不自动重试', async () => {
  const rejected = setup({ reminders: createSimulatedReminders({ rejectReminders: true }) });
  const failed = await rejected.capture.handle(event('小婕 GTD，提醒我明天下午三点交报价'));
  assert.equal(failed.status, 'collected_reminder_failed');
  assert.match(failed.receipt, /已收集.*提醒设置失败/);
  assert.equal((await rejected.reminders.getItem(failed.itemId)).remindAt, null);
  const unknown = setup({ reminders: createSimulatedReminders({ loseReminderResponse: true }) });
  const first = await unknown.capture.handle(event('小婕 GTD，提醒我明天下午三点交报价'));
  assert.equal(first.status, 'reminder_result_unknown');
  const second = await unknown.capture.handle(event('2026-10-01 12:00', { id: 'reply', replyTo: 'request-1' }));
  assert.equal(second.status, 'reminder_result_unknown');
  assert.equal(second.itemId, first.itemId);
  assert.equal((await unknown.reminders.getItem(first.itemId)).remindAt, '2026-09-28T07:00:00Z');
  assert.equal((await unknown.reminders.listItems()).length, 1);
});

test('非法时区配置和没有时区的消息时间戳不能悄悄采用机器时区', async () => {
  assert.throws(() => setup({ config: { timeZone: 'Invalid/Zone' } }), /timeZone/);
  const { capture, reminders } = setup();
  const result = await capture.handle(event('小婕 GTD，提醒我明天下午三点交报价', { sentAt: '2026-09-27T10:00:00' }));
  assert.equal(result.status, 'invalid_event');
  assert.equal((await reminders.listItems()).length, 0);
});

test('歧义时刻和夏令时跳变先澄清，非法日期不自动修正', async () => {
  const { capture, reminders } = setup({ now: () => '2026-01-01T00:00:00Z' });
  const inputs = [
    '明天下午三点或四点交报价',
    '[America/New_York]2026-03-08 02:30开会',
    '[America/New_York]2026-11-01 01:30开会',
    '2026-02-30 15:00开会',
    '明天25:00开会',
  ];
  for (const [i, text] of inputs.entries()) {
    const result = await capture.handle(event(`小婕 GTD，提醒我${text}`, { id: `ambiguous-${i}` }));
    assert.equal(result.status, 'collected_awaiting_time', text);
    assert.equal((await reminders.getItem(result.itemId)).remindAt, null);
  }
});

test('只补日期沿用已知时刻，重复回复不再改动', async () => {
  const { capture, reminders } = setup();
  const first = await capture.handle(event('小婕 GTD，提醒我下午三点交报价'));
  assert.equal(first.status, 'collected_awaiting_time');
  const result = await capture.handle(event('2026-09-30', { id: 'date', replyTo: 'request-1' }));
  assert.equal(result.status, 'reminder_set');
  assert.equal(result.remindAt, '2026-09-30T07:00:00Z');
  const again = await capture.handle(event('2026-10-01 16:00', { id: 'again', replyTo: 'request-1' }));
  assert.equal(again.remindAt, '2026-09-30T07:00:00Z');
  assert.equal((await reminders.listItems()).length, 1);
});

test('关联回复中的新激活请求单独收集，带额外指令的时间回复不盲目设置', async () => {
  const { capture, reminders } = setup();
  const first = await capture.handle(event('小婕 GTD，提醒我明天交报价'));
  const unclear = await capture.handle(event('15:00 或者算了', { id: 'unclear', replyTo: 'request-1' }));
  assert.equal(unclear.status, 'collected_awaiting_time');
  const explicit = await capture.handle(event('小婕 GTD，收集：另一个想法', { id: 'new', replyTo: 'request-1' }));
  assert.equal(explicit.status, 'collected');
  assert.notEqual(explicit.itemId, first.itemId);
  assert.equal((await reminders.getItem(first.itemId)).remindAt, null);
});

test('并发澄清回复复用已设置结果，同一原请求重投不创建新的提醒', async () => {
  const { capture, reminders } = setup();
  const original = event('小婕 GTD，提醒我明天交报价');
  const first = await capture.handle(original);
  const replies = await Promise.all(['a', 'b'].map(id => capture.handle(event('15:00', { id, replyTo: 'request-1' }))));
  assert.equal(replies[0].itemId, first.itemId);
  assert.equal(replies[1].itemId, first.itemId);
  const repeated = await capture.handle(original);
  assert.equal(repeated.itemId, first.itemId);
  assert.equal(repeated.status, 'reminder_set');
  assert.equal((await reminders.listItems()).length, 1);
});

test('时间范围或未支持的 ISO 偏移后缀不能被截成第一个本地时刻', async () => {
  const { capture, reminders } = setup();
  for (const [i, text] of ['明天15:00-16:00开会', '2026-09-28T15:00Z交报价', '2026-09-28T15:00+09:00交报价'].entries()) {
    const result = await capture.handle(event(`小婕 GTD，提醒我${text}`, { id: `range-${i}` }));
    assert.equal(result.status, 'collected_awaiting_time', text);
    assert.equal((await reminders.getItem(result.itemId)).remindAt, null);
  }
});

test('澄清分析超时保留原事项及已知日期，之后可以继续补齐', { timeout: 1000 }, async () => {
  const { capture, reminders } = setup({ config: { analysisTimeoutMs: 10 }, analyze: args =>
    args.content === '超时样例' ? new Promise(() => {}) : simulatedAnalysis(args) });
  const first = await capture.handle(event('小婕 GTD，提醒我明天交报价'));
  const timeout = await capture.handle(event('超时样例', { id: 'timeout', replyTo: 'request-1' }));
  assert.equal(timeout.status, 'collected_awaiting_time');
  assert.equal(timeout.analysis.failureReason, 'timeout');
  assert.equal(timeout.itemId, first.itemId);
  const result = await capture.handle(event('15:00', { id: 'retry', replyTo: 'request-1' }));
  assert.equal(result.remindAt, '2026-09-28T07:00:00Z');
  assert.equal((await reminders.listItems()).length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapture } from '../src/capture.js';
import { createSimulatedReminders, simulatedAnalysis } from '../src/simulation.js';

const event = (text, extra = {}) => ({
  id: 'msg-1', senderId: 'demo-user', conversationId: 'demo-chat',
  sentAt: '2026-09-27T10:00:00+08:00', type: 'text', text, ...extra,
});

test('只有配置的完整开头激活词触发明确收集，普通聊天和讨论不写入', async () => {
  const { capture, reminders } = setup({ config: { activation: '收件助手' } });
  for (const text of ['小婕 GTD，收集：想法', '正文提到收件助手，收集：想法', '收件助手扩展，收集：想法', '“收件助手，收集：想法”']) {
    assert.equal((await capture.handle(event(text))).status, 'not_handled');
  }
  assert.equal((await capture.handle(event('收件助手，这篇文章怎么样：https://example.org'))).status, 'needs_instruction');
  assert.equal((await reminders.listItems()).length, 0);
  const result = await capture.handle(event('收件助手，帮我记录一下：周末的想法'));
  assert.equal((await reminders.getItem(result.itemId)).title, '周末的想法');
});

function setup(options = {}) {
  const reminders = createSimulatedReminders();
  return { reminders, capture: createCapture({ reminders, analyze: simulatedAnalysis, ...options }) };
}

test('文章只保存链接，裸链接需关联确认且重复确认不增项，其他用户不能代确认', async () => {
  const { capture, reminders } = setup();
  const original = '小婕 GTD，https://example.org/article';
  assert.equal((await capture.handle(event(original))).status, 'awaiting_confirmation');
  assert.equal((await reminders.listItems()).length, 0);
  const foreign = await capture.handle(event('确认', { id: 'foreign', senderId: 'other', replyTo: 'msg-1' }));
  assert.notEqual(foreign.status, 'collected');
  const unrelated = await capture.handle(event('确认', { id: 'no-reply' }));
  assert.equal(unrelated.status, 'not_handled');
  const result = await capture.handle(event('确认', { id: 'reply-1', replyTo: 'msg-1' }));
  assert.equal(result.status, 'collected');
  assert.match((await reminders.getItem(result.itemId)).notes, /原文：\n小婕 GTD，https:\/\/example.org\/article/);
  const repeated = await capture.handle(event('确认', { id: 'reply-2', replyTo: 'msg-1' }));
  assert.equal(repeated.itemId, result.itemId);
  assert.equal((await reminders.listItems()).length, 1);
  const direct = await capture.handle(event('小婕 GTD，收集：https://example.org/another', { id: 'msg-2' }));
  assert.equal((await reminders.getItem(direct.itemId)).title, 'https://example.org/another');
  assert.equal((await reminders.listLists()).length, 1);
});

test('明确收集创建 Inbox 和一条事项，保留原文及署名建议，返回可定位 ID', async () => {
  const { capture, reminders } = setup();
  const original = '小婕 GTD，收集：研究家庭网络升级';
  const result = await capture.handle(event(original));
  assert.equal(result.status, 'collected');
  const item = await reminders.getItem(result.itemId);
  assert.equal(item.title, '研究家庭网络升级');
  assert.equal(item.notes, `原文：\n${original}\n\n小婕的建议：明确这件事的下一步处理方式。`);
  assert.equal(item.listId, result.listId);
  assert.equal(item.remindAt, null);
  assert.deepEqual((await reminders.listLists()).map(x => x.name), ['Inbox']);
  assert.equal((await reminders.listItems()).length, 1);
  assert.match(result.receipt, /模拟.*已收集/);
});

test('明确收集在分析异常时仍保留完整原文，绝不生成假建议', async () => {
  const { capture, reminders } = setup({ analyze: async () => { throw new Error('simulated failure'); } });
  const original = '小婕 GTD，收集：一个想法\n第二行也需保留';
  const result = await capture.handle(event(original));
  assert.equal(result.status, 'collected_analysis_failed');
  assert.equal((await reminders.getItem(result.itemId)).notes, `原文：\n${original}`);
  assert.match(result.receipt, /已收集.*分析未完成/);
});

test('未实现提醒、非文字消息及空收集不会误报成功', async () => {
  const { capture, reminders } = setup();
  assert.equal((await capture.handle(event('小婕 GTD，提醒我明天交报价'))).status, 'unsupported');
  assert.equal((await capture.handle(event('小婕 GTD，收集：附件', { type: 'file' }))).status, 'unsupported');
  assert.equal((await capture.handle(event('', { type: 'image' }))).status, 'unsupported');
  assert.equal((await capture.handle(event('小婕 GTD，收集：   '))).status, 'needs_instruction');
  assert.equal((await reminders.listItems()).length, 0);
});

test('输入必须有可信事件身份且位于允许范围，超限不截断保存', async () => {
  const { capture, reminders } = setup({ config: { maxInputChars: 30 } });
  assert.equal((await capture.handle(event('小婕 GTD，收集：想法', { senderId: 'stranger' }))).status, 'forbidden');
  assert.equal((await capture.handle(event('小婕 GTD，收集：想法', { conversationId: 'other-chat' }))).status, 'forbidden');
  assert.equal((await capture.handle(event('小婕 GTD，收集：想法', { id: '' }))).status, 'invalid_event');
  assert.equal((await capture.handle(event('小婕 GTD，收集：' + '字'.repeat(40)))).status, 'input_too_large');
  assert.equal((await reminders.listItems()).length, 0);
  assert.throws(() => setup({ config: { activation: '' } }), /activation/);
});

test('分析超时或输出无效会降级，并返回不含正文的调用统计', { timeout: 1000 }, async () => {
  const { capture, reminders } = setup({
    config: { analysisTimeoutMs: 10 }, analyze: async () => new Promise(() => {}),
  });
  const result = await capture.handle(event('小婕 GTD，收集：合成隐私内容'));
  assert.equal(result.status, 'collected_analysis_failed');
  assert.match((await reminders.getItem(result.itemId)).notes, /合成隐私内容/);
  assert.equal(result.analysis.calls, 1);
  assert.equal(result.analysis.failureReason, 'timeout');
  assert.equal(result.analysis.inputTokens, null);
  assert.doesNotMatch(JSON.stringify(result.analysis), /合成隐私内容/);
  const invalid = setup({ analyze: async () => ({ title: '想法', suggestion: '第一句。第二句。' }) });
  const bad = await invalid.capture.handle(event('小婕 GTD，收集：想法'));
  assert.equal(bad.status, 'collected_analysis_failed');
  assert.equal(bad.analysis.failureReason, 'invalid_output');
});

test('多个同名 Inbox 不随意写入，明确写入拒绝也不返回成功', async () => {
  const { capture, reminders } = setup();
  await reminders.createList('Inbox');
  await reminders.createList('Inbox');
  const ambiguous = await capture.handle(event('小婕 GTD，收集：想法'));
  assert.equal(ambiguous.status, 'needs_list_selection');
  assert.equal((await reminders.listItems()).length, 0);
  const denied = setup({ reminders: createSimulatedReminders({ rejectWrites: true }) });
  const failed = await denied.capture.handle(event('小婕 GTD，收集：想法'));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.itemId, undefined);
  assert.match(failed.receipt, /未成功/);
});

test('讨论收集本身不创建，模拟版只接受带分隔符的明确命令', async () => {
  const { capture, reminders } = setup();
  const result = await capture.handle(event('小婕 GTD，收集是什么意思？'));
  assert.equal(result.status, 'needs_instruction');
  assert.equal((await reminders.listItems()).length, 0);
});

test('同一链接的同时确认只创建一次，取消后不会再收集', async () => {
  const { capture, reminders } = setup();
  await capture.handle(event('小婕 GTD，https://example.org/one'));
  const replies = await Promise.all(['reply-a', 'reply-b'].map(id =>
    capture.handle(event('确认', { id, replyTo: 'msg-1' }))));
  assert.equal(replies[0].itemId, replies[1].itemId);
  assert.equal((await reminders.listItems()).length, 1);
  await capture.handle(event('小婕 GTD，https://example.org/two', { id: 'msg-2' }));
  assert.equal((await capture.handle(event('取消', { id: 'cancel', replyTo: 'msg-2' }))).status, 'cancelled');
  assert.equal((await capture.handle(event('确认', { id: 'later', replyTo: 'msg-2' }))).status, 'cancelled');
  assert.equal((await reminders.listItems()).length, 1);
});

test('多行原文逐字保留，标题保持单行且建议正常生成', async () => {
  const { capture, reminders } = setup();
  const text = '小婕 GTD，收集：第一行\n第二行';
  const result = await capture.handle(event(text));
  assert.equal(result.status, 'collected');
  const item = await reminders.getItem(result.itemId);
  assert.equal(item.title, '第一行 第二行');
  assert.equal(item.notes, `原文：\n${text}\n\n小婕的建议：明确这件事的下一步处理方式。`);
});

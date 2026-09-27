import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAppleReminders } from '../src/apple-reminders.js';
import { openDurableCapture } from '../src/durable-capture.js';
import { simulatedAnalysis } from '../src/simulation.js';

test('Apple 创建响应丢失后只核对操作标识，不重复写入', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-apple-'));
  const items = [];
  // Native EventKit process is the external system boundary.
  const bridge = async input => {
    if (input.command === 'boundList') return { id: 'apple-list', name: 'Inbox', sourceId: 'source-1' };
    if (input.command === 'lists') return { lists: [{ id: 'apple-list', name: 'Inbox', sourceId: 'source-1' }] };
    if (input.command === 'createItem') {
      items.push({ id: 'apple-item', listId: input.listId, title: input.title, notes: input.notes });
      throw new Error('Response lost');
    }
    if (input.command === 'findCreate') return { state: 'applied', value: items[0] };
    throw new Error('Unexpected command');
  };
  const apple = openAppleReminders({ statePath: join(dir, 'apple.sqlite'), sourceId: 'source-1', bridge });
  const capture = openDurableCapture({ journalPath: join(dir, 'capture.sqlite'), reminders: apple, analyze: simulatedAnalysis });
  t.after(async () => { await capture.close(); apple.close(); rmSync(dir, { recursive: true, force: true }); });
  const event = { id: 'a1', senderId: 'demo-user', conversationId: 'demo-chat', sentAt: '2026-09-27T10:00:00+08:00', type: 'text', text: '小婕 GTD，收集：PGTD 测试' };
  assert.equal((await capture.handle(event)).status, 'result_unknown');
  assert.equal((await capture.recover())[0].itemId, 'apple-item');
  assert.equal(items.length, 1);
});

test('Apple 无法核实时停止写入，权限拒绝不声称保存成功', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-apple-denied-'));
  let writes = 0;
  const bridge = async input => {
    if (input.command === 'lists') return { lists: [{ id: 'L', name: 'Inbox' }] };
    if (input.command === 'boundList') return { id: 'L', name: 'Inbox' };
    if (input.command === 'findCreate') return { state: 'unknown' };
    if (input.command === 'createItem') { writes++; throw Object.assign(new Error('Denied'), { code: 'WRITE_REJECTED' }); }
    throw new Error('Unexpected');
  };
  const apple = openAppleReminders({ statePath: join(dir, 'apple.sqlite'), sourceId: 'S', bridge });
  const capture = openDurableCapture({ journalPath: join(dir, 'capture.sqlite'), reminders: apple, analyze: simulatedAnalysis });
  t.after(async () => { await capture.close(); apple.close(); rmSync(dir, { recursive: true, force: true }); });
  const event = { id: 'denied', senderId: 'demo-user', conversationId: 'demo-chat', sentAt: '2026-09-27T10:00:00+08:00', type: 'text', text: '小婕 GTD，收集：测试' };
  assert.equal((await capture.handle(event)).status, 'failed');
  assert.equal((await capture.recover())[0].status, 'result_unknown');
  assert.equal(writes, 1);
});

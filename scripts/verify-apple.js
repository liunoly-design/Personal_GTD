import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Temporal } from '@js-temporal/polyfill';
import { openAppleReminders } from '../src/apple-reminders.js';
import { openDurableCapture } from '../src/durable-capture.js';
import { simulatedAnalysis } from '../src/simulation.js';

// Explicit opt-in: writes three labelled synthetic items to the configured real Inbox.
if (!process.argv.includes('--write-synthetic')) throw new Error('Pass --write-synthetic for real Apple verification');
const config = JSON.parse(readFileSync('runtime/apple/config.json', 'utf8'));
const apple = openAppleReminders({ ...config, statePath: 'runtime/apple/adapter.sqlite' });
const capture = openDurableCapture({ journalPath: 'runtime/apple/capture.sqlite', reminders: apple, analyze: simulatedAnalysis, config });
const time = Temporal.Now.instant().add({ seconds: 180 }).toZonedDateTimeISO('Asia/Shanghai').round({ smallestUnit: 'minute', roundingMode: 'ceil' });
const prefix = '小婕 GTD，收集：PGTD 测试 原文容量\n';
const inputs = [prefix + '测'.repeat(8000 - [...prefix].length),
  `小婕 GTD，提醒我${time.toPlainDate()} ${String(time.hour).padStart(2,'0')}:${String(time.minute).padStart(2,'0')} PGTD 测试 通知验收`,
  '小婕 GTD，收集：PGTD 测试 链接待整理 https://example.org/pgtd-test'];
const results = [];
try {
  for (let index = 0; index < inputs.length; index++) {
    const event = { id: 'apple-live-v1-' + index, senderId: 'demo-user', conversationId: 'demo-chat', type: 'text', sentAt: new Date().toISOString(), text: inputs[index] };
    const result = await capture.handle(event);
    assert.ok(result.itemId, result.status);
    const item = await apple.getItem(result.itemId);
    assert.equal(item.notes, '原文：\n' + event.text + '\n\n小婕的建议：明确这件事的下一步处理方式。');
    if (index === 1) { assert.equal(result.status, 'reminder_set'); assert.equal(item.remindAt, result.remindAt); }
    assert.equal((await capture.handle(event)).itemId, result.itemId);
    results.push({ itemId: result.itemId, listId: result.listId, status: result.status, remindAt: item.remindAt, originalChars: [...event.text].length });
  }
  writeFileSync('runtime/apple/verification.json', JSON.stringify({ results, notificationObserved: false, wikiMoveObserved: false }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ mode: 'real-apple', analysis: 'simulation', itemsVerified: results.length, originalChars: results[0].originalChars,
    notificationLocalTime: time.toPlainDateTime().toString(), notificationObserved: false }));
} finally { await capture.close(); apple.close(); }

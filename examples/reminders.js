import assert from 'node:assert/strict';
import { createCapture } from '../src/capture.js';
import { createSimulatedReminders, simulatedAnalysis } from '../src/simulation.js';

// Fixed synthetic clock keeps this demo reproducible after the example dates pass.
const reminders = createSimulatedReminders();
const capture = createCapture({ reminders, analyze: simulatedAnalysis, now: () => '2026-09-27T02:00:00Z' });
const inputs = [
  { id: 'timed', text: '小婕 GTD，提醒我明天下午三点交报价' },
  { id: 'unclear', text: '小婕 GTD，提醒我下周找老王聊一下' },
  { id: 'reply', text: '2026-09-30 15:00', replyTo: 'unclear' },
];
const results = [];
for (const input of inputs) {
  const result = await capture.handle({ senderId: 'demo-user', conversationId: 'demo-chat',
    sentAt: '2026-09-27T10:00:00+08:00', type: 'text', ...input });
  results.push(result);
  console.log(JSON.stringify({ mode: 'simulation', result, item: await reminders.getItem(result.itemId) }));
}
assert.deepEqual(results.map(x => x.status), ['reminder_set', 'collected_awaiting_time', 'reminder_set']);
assert.equal(results[1].itemId, results[2].itemId);
assert.equal((await reminders.listItems()).length, 2);

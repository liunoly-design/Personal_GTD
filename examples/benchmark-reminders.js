import assert from 'node:assert/strict';
import { createCapture } from '../src/capture.js';
import { createSimulatedReminders, simulatedAnalysis } from '../src/simulation.js';

const reminders = createSimulatedReminders();
const capture = createCapture({ reminders, analyze: simulatedAnalysis, now: () => '2026-09-27T02:00:00Z' });
const durations = [];
for (let i = 0; i < 10; i++) {
  const inputs = [
    { id: `direct-${i}`, text: '小婕 GTD，提醒我明天下午三点交报价' },
    { id: `pending-${i}`, text: '小婕 GTD，提醒我下周整理材料' },
    { id: `reply-${i}`, text: '2026-09-30 15:00', replyTo: `pending-${i}` },
  ];
  for (const [index, input] of inputs.entries()) {
    const started = performance.now();
    const result = await capture.handle({ senderId: 'demo-user', conversationId: 'demo-chat',
      sentAt: '2026-09-27T10:00:00+08:00', type: 'text', ...input });
    durations.push(performance.now() - started);
    assert.equal(result.status, index === 1 ? 'collected_awaiting_time' : 'reminder_set');
  }
}
assert.equal((await reminders.listItems()).length, 20);
durations.sort((a, b) => a - b);
console.log(JSON.stringify({ mode: 'simulation', events: 30, items: 20, realModelCalls: 0,
  p50Ms: durations[14], p95Ms: durations[28], maxMs: durations[29] }));

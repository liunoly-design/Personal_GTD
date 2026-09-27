import { createCapture } from '../src/capture.js';
import { createSimulatedReminders, simulatedAnalysis } from '../src/simulation.js';

const reminders = createSimulatedReminders();
const capture = createCapture({ reminders, analyze: simulatedAnalysis });
const elapsed = [];
for (let i = 0; i < 30; i++) {
  const started = performance.now();
  const result = await capture.handle({
    id: `perf-${i}`, senderId: 'demo-user', conversationId: 'demo-chat',
    sentAt: '2026-09-27T10:00:00+08:00', type: 'text', text: `小婕 GTD，收集：合成性能样例 ${i}`,
  });
  if (result.status !== 'collected') throw new Error('Simulation benchmark did not collect all samples');
  elapsed.push(performance.now() - started);
}
elapsed.sort((a, b) => a - b);
console.log(JSON.stringify({
  mode: 'simulation', samples: 30, items: (await reminders.listItems()).length,
  p50Ms: elapsed[14], p95Ms: elapsed[28], maxMs: elapsed[29], realModelCalls: 0,
}));

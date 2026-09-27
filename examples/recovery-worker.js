import { join } from 'node:path';
import { openPersistentSimulation } from '../src/persistent-simulation.js';
import { openDurableCapture } from '../src/durable-capture.js';
import { simulatedAnalysis } from '../src/simulation.js';

const [dir, mode] = process.argv.slice(2);
if (!dir || !['crash', 'recover'].includes(mode)) throw new Error('Expected directory and crash/recover');
const external = openPersistentSimulation({ path: join(dir, 'external.sqlite'),
  afterWrite: kind => { if (mode === 'crash' && kind === 'item') process.kill(process.pid, 'SIGKILL'); } });
const capture = openDurableCapture({ journalPath: join(dir, 'operations.sqlite'), reminders: external,
  receipts: external, analyze: simulatedAnalysis, now: () => '2026-09-27T02:00:00Z' });
try {
  const results = mode === 'recover' ? await capture.recover() : [await capture.handle({
    id: 'crash-demo', senderId: 'demo-user', conversationId: 'demo-chat', type: 'text',
    sentAt: '2026-09-27T10:00:00+08:00', text: '小婕 GTD，收集：合成恢复演示',
  })];
  console.log(JSON.stringify({ results, items: (await external.listItems()).length, receipts: (await external.listReceipts()).length }));
} finally { await capture.close(); external.close(); }

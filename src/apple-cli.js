import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';
import { openAppleReminders } from './apple-reminders.js';
import { openDurableCapture } from './durable-capture.js';
import { simulatedAnalysis } from './simulation.js';

async function main() {
  const args = process.argv.slice(2);
  const configArg = args.indexOf('--config'), stateArg = args.indexOf('--state-dir');
  if (configArg < 0 || stateArg < 0 || !args[configArg + 1] || !args[stateArg + 1]) throw new Error('Config and state directory required');
  const config = JSON.parse(await readFile(resolve(args[configArg + 1]), 'utf8'));
  const state = resolve(args[stateArg + 1]);
  const apple = openAppleReminders({ sourceId: config.sourceId, listId: config.listId, statePath: join(state, 'adapter.sqlite') });
  let capture;
  const print = result => console.log(JSON.stringify({ mode: 'apple', analysisMode: 'simulation',
    result: { ...result, receipt: result.receipt?.replace('【模拟】', '【Apple；分析模拟】') ?? null } }));
  try {
    capture = openDurableCapture({ journalPath: join(state, 'capture.sqlite'), reminders: apple, analyze: simulatedAnalysis, config });
    if (args.includes('--recover')) { for (const result of await capture.recover()) print(result); return; }
    let count = 0;
    for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      if (++count > 1000) throw new Error('Input capacity reached');
      let event;
      try { event = JSON.parse(line); } catch { print({ status: 'invalid_event' }); continue; }
      print(await capture.handle(event));
    }
  } finally { await capture?.close(); apple.close(); }
}
main().catch(() => { console.error('Apple 收集未完成，请检查配置、权限和操作状态；未自动重复写入。'); process.exitCode = 1; });

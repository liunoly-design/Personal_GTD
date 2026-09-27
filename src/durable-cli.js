import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { openDurableCapture } from './durable-capture.js';
import { openPersistentSimulation } from './persistent-simulation.js';
import { simulatedAnalysis } from './simulation.js';

async function main() {
  const args = process.argv.slice(2);
  let dir; let config = {}; let recover = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--recover') { recover = true; continue; }
    if (args[i] === '--help') {
      console.log('Local simulation only. --state-dir <directory> [--config <file>] [--recover]. Otherwise JSONL on stdin.');
      return;
    }
    if (!['--state-dir', '--config'].includes(args[i]) || !args[i + 1]) throw new Error('Invalid arguments');
    if (args[i] === '--state-dir') dir = args[++i];
    else config = JSON.parse(await readFile(args[++i], 'utf8'));
  }
  if (!dir || !config || Array.isArray(config) || typeof config !== 'object') throw new Error('Invalid configuration');
  const external = openPersistentSimulation({ path: join(dir, 'external.sqlite') });
  let capture;
  try {
    capture = openDurableCapture({ journalPath: join(dir, 'operations.sqlite'), reminders: external,
      receipts: external, analyze: simulatedAnalysis, config });
    if (recover) {
      for (const result of await capture.recover()) console.log(JSON.stringify({ mode: 'simulation', result }));
      return;
    }
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    let count = 0;
    for await (const line of lines) {
      if (!line.trim()) continue;
      if (++count > 1000) throw new Error('Session capacity exceeded');
      let event;
      try { event = JSON.parse(line); }
      catch { console.log(JSON.stringify({ mode: 'simulation', result: { status: 'invalid_event' } })); continue; }
      console.log(JSON.stringify({ mode: 'simulation', result: await capture.handle(event) }));
    }
  } finally { await capture?.close(); external.close(); }
}
main().catch(() => {
  console.error('持久化模拟未完成：请检查参数、配置、目录权限和是否已有处理进程。未连接 Apple、飞书或模型服务。');
  process.exitCode = 1;
});

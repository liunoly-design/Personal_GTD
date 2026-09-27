import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createCapture } from './capture.js';
import { createSimulatedReminders, simulatedAnalysis } from './simulation.js';

async function main() {
  const args = process.argv.slice(2);
  let config = {};
  let failAnalysis = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') {
      console.log('Local simulation only. JSONL on stdin. Options: --config <file> --analysis-failure');
      return;
    }
    if (args[i] === '--analysis-failure') { failAnalysis = true; continue; }
    if (args[i] !== '--config' || !args[i + 1]) throw new Error('Invalid CLI arguments');
    config = JSON.parse(await readFile(args[++i], 'utf8'));
    if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error('Invalid config');
  }
  const reminders = createSimulatedReminders();
  const capture = createCapture({ reminders, config, analyze: failAnalysis
    ? async () => { throw new Error('Synthetic analysis failure'); }
    : simulatedAnalysis });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let count = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    if (++count > 1000) throw new Error('Simulation session capacity exceeded');
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      console.log(JSON.stringify({ mode: 'simulation', result: { status: 'invalid_event', receipt: '输入不是有效 JSON；未创建事项。' } }));
      process.exitCode = 1;
      continue;
    }
    const result = await capture.handle(event);
    const item = result.itemId ? await reminders.getItem(result.itemId) : null;
    console.log(JSON.stringify({ mode: 'simulation', result, item }));
  }
}

main().catch(() => {
  // Never print arbitrary exception messages: input, paths or credentials may be embedded.
  console.error('本地模拟未完成：请检查参数、配置和输入；每个进程最多处理 1000 条消息。未连接 Apple、飞书或模型服务。');
  process.exitCode = 1;
});

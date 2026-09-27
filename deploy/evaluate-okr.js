import { parseArgs } from 'node:util';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { openGeminiAnalyzer } from '../src/gemini.js';
import { openClawGoogleKey } from '../src/openclaw-auth.js';

import { sampleDraft as draft } from '../examples/okr-sample.js';
const samples = [
  { name: 'background', stage: 'background', answer: '合成情况：2026第四季度，10月1日到12月31日，每周两小时，希望改善体力，不能牺牲睡眠。', workingDraft: null, recentLog: '', currentGoals: '', goalsTruncated: false },
  { name: 'challenge', stage: 'okr', answer: '这三个结果已逐项讨论，请先质询最重要的风险。', workingDraft: draft, recentLog: draft, currentGoals: '', goalsTruncated: false },
  { name: 'ready', stage: 'challenge', answer: '我回应风险：指标不是全部，还要对照日常生活的改善；持续不适时暂停并调整。请整理完整草案给我确认。', workingDraft: draft, recentLog: draft, currentGoals: '', goalsTruncated: false },
];
let model;
try {
  const { values } = parseArgs({ options: {
    'allow-model': { type: 'boolean' }, case: { type: 'string' }, config: { type: 'string', default: 'runtime/feishu/runtime-config.json' },
    output: { type: 'string', default: 'runtime/okr/f104-evaluation.json' },
  } });
  if (!values['allow-model']) throw new Error('MODEL_OPT_IN_REQUIRED');
  const selected = values.case ? samples.filter(s => s.name === values.case) : samples;
  if (!selected.length) throw new Error('INVALID_CASE');
  const config = JSON.parse(readFileSync(values.config, 'utf8'));
  // Use the existing shared ledger and caps; never reset or enlarge the approved budget.
  const apiKey = openClawGoogleKey({ agentId: config.authAgent ?? 'gtd', ...(config.openclawPackageDir ? { packageDir: config.openclawPackageDir } : {}) });
  let timer;
  try { await Promise.race([apiKey(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('AUTH_TIMEOUT')), 30000); })]); }
  finally { clearTimeout(timer); }
  model = openGeminiAnalyzer({ statePath: config.usagePath, config: config.model, apiKey });
  const before = model.usage(); const results = [];
  for (const { name, ...input } of selected) {
    try { results.push({ name, status: 'returned', result: await model.discussOkr(input) }); }
    catch { results.push({ name, status: 'unavailable' }); break; }
  }
  const after = model.usage();
  const report = { mode: 'real-model-synthetic-input', results,
    calls: after.calls - before.calls, inputTokens: after.inputTokens - before.inputTokens,
    outputTokens: after.outputTokens - before.outputTokens, estimatedCostUsd: after.estimatedCostUsd - before.estimatedCostUsd,
    records: after.records.slice(before.records.length) };
  mkdirSync(dirname(values.output), { recursive: true, mode: 0o700 });
  writeFileSync(values.output, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...report, results: results.map(r => ({ name: r.name, status: r.status, stage: r.result?.stage })), records: undefined }));
  if (results.length !== selected.length || results.some(r => r.status !== 'returned')) process.exitCode = 1;
} catch (error) { console.error(JSON.stringify({ status: 'stopped', code: /^[A-Z_]+$/u.test(error.message) ? error.message : 'EVALUATION_FAILED' })); process.exitCode = 1; }
finally { await model?.close(); }

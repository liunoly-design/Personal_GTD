import { parseArgs } from 'node:util';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { openGeminiAnalyzer } from '../src/gemini.js';
import { openClawGoogleKey } from '../src/openclaw-auth.js';

const draft = '2026 第四季度，年度方向：建立稳定的学习习惯。\n#O1 能独立完成一个小型编程作品\n#KR1 季度末交付一个可运行作品，基线：尚无作品，证据：演示和代码；每周检查。\n每周3小时。策略：边做边学；替代：先完整上课。风险：课程挤占实践；停止条件：连续两周无可运行成果时缩小范围。待决：具体作品题材。';
const samples = [
  { name: 'background', stage: 'background', answer: '合成情况：工作日忙，每周可投入3小时，希望学编程做一个小作品。上次整套课程没坚持，不能牺牲睡眠。', recentLog: '', currentGoals: '', goalsTruncated: false },
  { name: 'challenge', stage: 'okr', answer: '这个季度做一个小作品，先选最小功能，每周3小时。基线是尚无作品。希望讨论最强反对理由和替代策略。', recentLog: draft, currentGoals: '', goalsTruncated: false },
  { name: 'ready', stage: 'challenge', answer: '接受先做最小作品；我回应风险：不再追求上完课程，每周做演示，连续两周没有成果就缩小范围。题材选番茄钟。请整理完整草案给我确认。', recentLog: draft + '\n已审视：完成课程未必能独立开发，替代路径是先做最小作品。', currentGoals: '', goalsTruncated: false },
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

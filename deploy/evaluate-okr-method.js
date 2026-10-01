import { parseArgs } from 'node:util';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { openGeminiAnalyzer } from '../src/gemini.js';
import { openClawGoogleKey } from '../src/openclaw-auth.js';

const cases = [
  { name: 'outcomes-and-unknown-baseline', answer: '合成场景：2026第四季度，10月1日至12月31日。希望验证课程产品是否值得继续做，每周只能投入两小时。我想把“访谈10次”直接当KR，基线没有数据，你帮我填0并一次写完全部目标吧。', criteria: '每轮一个问题；区分访谈行动和可验证结果；未知基线不填0；最多一个O/KR，保留资源约束。' },
  { name: 'commitment-and-gtd-evidence', answer: '合成场景：2026第四季度，10月1日至12月31日。团队要求重要数据每次都能从备份恢复，这是不能失守的底线。我听说OKR完成70%就成功，所以这条也按70%算，而且提醒事项打勾就说明KR完成，对吗？', criteria: '底线不套70%成功；任务打勾不等于结果验收；要求恢复证据；每轮一个核心问题，不自动创建任务。' },
];
let model;
try {
  const { values } = parseArgs({ options: { 'allow-model': { type: 'boolean' }, case: { type: 'string' }, config: { type: 'string', default: 'runtime/feishu/runtime-config.json' }, output: { type: 'string', default: 'runtime/okr/skill-review/evaluation.json' } } });
  if (!values['allow-model']) throw new Error('MODEL_OPT_IN_REQUIRED');
  const selected = values.case ? cases.filter(c => c.name === values.case) : cases;
  if (!selected.length) throw new Error('INVALID_CASE');
  const rawResponses = [];
  const config = JSON.parse(readFileSync(values.config, 'utf8'));
  const apiKey = openClawGoogleKey({ agentId: config.authAgent ?? 'gtd', ...(config.openclawPackageDir ? { packageDir: config.openclawPackageDir } : {}) });
  let timer;
  try { await Promise.race([apiKey(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('AUTH_TIMEOUT')), 30000); })]); }
  finally { clearTimeout(timer); }
  model = openGeminiAnalyzer({ statePath: config.usagePath, config: config.model, apiKey, fetchImpl: async (...args) => {
    const response = await fetch(...args);
    // This evaluator only sends the synthetic fixtures above, never private discussions.
    if (response.ok) { const payload = await response.clone().json(); rawResponses.push(payload.candidates); }
    return response;
  } });
  const before = model.usage(), results = [];
  for (const { name, answer, criteria } of selected) {
    try { results.push({ name, criteria, result: await model.discussOkr({ stage: 'background', sentAt: '2026-10-01T00:00:00Z', answer, workingDraft: null, discussionSummary: null, lastQuestion: null, recentLog: '', currentGoals: '', goalsTruncated: false }) }); }
    catch { results.push({ name, status: 'unavailable' }); break; }
  }
  const after = model.usage();
  const report = { mode: 'real-model-synthetic-input', calls: after.calls - before.calls, estimatedCostUsd: after.estimatedCostUsd - before.estimatedCostUsd, records: after.records.slice(before.records.length), results, rawResponses };
  mkdirSync(dirname(values.output), { recursive: true, mode: 0o700 });
  writeFileSync(values.output, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ calls: report.calls, estimatedCostUsd: report.estimatedCostUsd, returned: results.filter(r => r.result).length, totalCalls: after.calls }));
  if (results.length !== selected.length || results.some(r => !r.result)) process.exitCode = 1;
} catch (error) { console.error(JSON.stringify({ status: 'stopped', code: /^[A-Z_]+$/u.test(error.message) ? error.message : 'EVALUATION_FAILED' })); process.exitCode = 1; }
finally { await model?.close(); }

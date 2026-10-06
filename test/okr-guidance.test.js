import { sampleDraft } from '../examples/okr-sample.js';
import { validateGuidance } from '../src/okr-guidance.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openGeminiAnalyzer } from '../src/gemini.js';
test('模型输出校验失败传播安全原因，账本不记录私人返回正文',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'okr-output-error-'));
  const model=openGeminiAnalyzer({statePath:join(dir,'usage.sqlite'),apiKey:async()=>'synthetic',config:{maxBudgetUsd:1},fetchImpl:async()=>new Response(JSON.stringify({modelVersion:'gemini-3.8-flash',usageMetadata:{promptTokenCount:10,candidatesTokenCount:10},candidates:[{finishReason:'STOP',content:{parts:[{text:'synthetic-private-invalid-json'}]}}]}))});
  t.after(async()=>{await model.close();rmSync(dir,{recursive:true,force:true});});
  await assert.rejects(model.discussOkr({stage:'background',answer:'合成回答'}),/MODEL_OUTPUT_INVALID/);
  assert.equal(model.usage().records[0].failureReason,'invalid_output');
  assert.doesNotMatch(JSON.stringify(model.usage()),/synthetic-private-invalid-json/);
});

test('OKR 模型单轮返回结构化建议，共用预算账本且没有工具权限', async t => {
  const dir=mkdtempSync(join(tmpdir(),'pgtd-okr-model-'));
  const value={stage:'direction',summary:'每周可投入两小时，背景待用户核对。',advice:'可先比较运动与睡眠两种改善路径。',questions:['本季度更想改善哪一个？'],draft:null};
  const model=openGeminiAnalyzer({statePath:join(dir,'usage.sqlite'),apiKey:async()=> 'synthetic',config:{maxBudgetUsd:1},fetchImpl:async(_url,options)=>{
    const body=JSON.parse(options.body);assert.equal(body.tools,undefined);
    assert.match(body.systemInstruction.parts[0].text,/反向审视/);
    assert.ok(body.systemInstruction.parts[0].text.includes(readFileSync(new URL('../src/okr-method.md', import.meta.url), 'utf8')));
    assert.ok(Buffer.byteLength(options.body) <= 30000);
    assert.equal(body.generationConfig.maxOutputTokens,4096);
    return new Response(JSON.stringify({modelVersion:'gemini-3.8-flash',usageMetadata:{promptTokenCount:200,candidatesTokenCount:80},
      candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]}));
  }});
  t.after(async()=>{await model.close();rmSync(dir,{recursive:true,force:true});});
  const result=await model.discussOkr({stage:'background',answer:'合成资料：每周两小时'});
  assert.equal(result.stage,'direction');assert.deepEqual(result.questions,['本季度更想改善哪一个？']);
  assert.equal(model.usage().calls,1);assert.equal(model.usage().inputTokens,200);
});

test('模型草案的误转义换行修正为可读分行，超量问题和无标签草案拒绝', () => {
  const base={stage:'ready',summary:'背景待核对',advice:'建议先小规模验证',questions:[],draft:sampleDraft.replaceAll('\n','\\n')};
  assert.match(validateGuidance(base).draft,/季度.*\n## #O1/);
  assert.throws(()=>validateGuidance({...base,questions:['a','b','c','d']}),/INVALID_GUIDANCE/);
  assert.throws(()=>validateGuidance({...base,draft:'没有标签的草案'}),/INVALID_GUIDANCE/);
});

test('已有草案的模型只返回单项KR变更，由代码保留O原文并组装完整草案', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-okr-change-'));
  const before = '# 2026 第四季度（2026-10-01 至 2026-12-31）\n## #O1 合成学习目标\n策略：每周练习两小时。';
  const model = openGeminiAnalyzer({ statePath: join(dir, 'usage.sqlite'), apiKey: async () => 'synthetic', config: { maxBudgetUsd: 1 },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.ok(body.generationConfig.responseJsonSchema.required.includes('change'));
      assert.equal(body.generationConfig.responseJsonSchema.properties.draft, undefined);
      const value = { stage: 'okr', summary: '当前合成学习目标已明确。', advice: '建议只完善第一个KR。', questions: ['独立完成的验收标准是什么？'],
        change: { operation: 'upsert', id: '#KR1', parentId: '#O1', text: '### #KR1 独立完成合成练习\n验收标准：待确认。' } };
      return new Response(JSON.stringify({ modelVersion: 'gemini-3.8-flash', usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 80 },
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }));
    } });
  t.after(async () => { await model.close(); rmSync(dir, { recursive: true, force: true }); });
  const result = await model.discussOkr({ stage: 'okr', workingDraft: before, answer: '我想完善第一个KR' });
  assert.equal(result.draft, '# 2026 第四季度（2026-10-01 至 2026-12-31）\n## #O1 合成学习目标\n策略：每周练习两小时。\n### #KR1 独立完成合成练习\n验收标准：待确认。');
  assert.equal(model.usage().calls, 1);
});

test('request rejection receipt states HTTP 400 and does not invite blind model retry', async () => {
  const {guidanceFailureReceipt}=await import('../src/okr-guidance.js');
  const receipt=guidanceFailureReceipt('MODEL_REQUEST_REJECTED');
  assert.match(receipt,/HTTP 400/);
  assert.match(receipt,/维护者/);
  assert.doesNotMatch(receipt,/发送“重试分析”/);
});

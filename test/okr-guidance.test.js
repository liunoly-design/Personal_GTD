import { validateGuidance } from '../src/okr-guidance.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openGeminiAnalyzer } from '../src/gemini.js';

test('OKR 模型单轮返回结构化建议，共用预算账本且没有工具权限', async t => {
  const dir=mkdtempSync(join(tmpdir(),'pgtd-okr-model-'));
  const value={stage:'direction',summary:'每周可投入两小时，背景待用户核对。',advice:'可先比较运动与睡眠两种改善路径。',questions:['本季度更想改善哪一个？'],draft:null};
  const model=openGeminiAnalyzer({statePath:join(dir,'usage.sqlite'),apiKey:async()=> 'synthetic',config:{maxBudgetUsd:1},fetchImpl:async(_url,options)=>{
    const body=JSON.parse(options.body);assert.equal(body.tools,undefined);
    assert.match(body.systemInstruction.parts[0].text,/反向审视/);
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
  const base={stage:'ready',summary:'背景待核对',advice:'建议先小规模验证',questions:[],draft:'2026季度\\n#O1 合成目标\\n#KR1 合成标准'};
  assert.match(validateGuidance(base).draft,/季度\n#O1/);
  assert.throws(()=>validateGuidance({...base,questions:['a','b','c','d']}),/INVALID_GUIDANCE/);
  assert.throws(()=>validateGuidance({...base,draft:'没有标签的草案'}),/INVALID_GUIDANCE/);
});

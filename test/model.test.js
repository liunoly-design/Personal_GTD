import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openGeminiAnalyzer } from '../src/gemini.js';
import { createCapture } from '../src/capture.js';
import { createSimulatedReminders } from '../src/simulation.js';

test('真实模型接口返回结构化建议和时间，公开收集入口校验后写入', async t => {
  const dir=mkdtempSync(join(tmpdir(),'pgtd-model-'));
  const model=openGeminiAnalyzer({ statePath:join(dir,'usage.sqlite'), apiKey: async ()=>'synthetic-key',
    fetchImpl:async (_url, options)=>{
      const request=JSON.parse(options.body);
      assert.equal(request.generationConfig.responseMimeType,'application/json');
      assert.equal(request.tools,undefined);
      return new Response(JSON.stringify({ modelVersion:'gemini-3.8-flash', usageMetadata:{promptTokenCount:80,candidatesTokenCount:50,thoughtsTokenCount:0},
        candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({intent:'remind',title:'交报价',suggestion:'核对报价后发送。',reminder:{date:'2026-09-28',time:'15:00:00',timeZone:'Asia/Shanghai'}})}]}}] }));
    } });
  t.after(async()=>{await model.close();rmSync(dir,{recursive:true,force:true});});
  const reminders=createSimulatedReminders();
  const capture=createCapture({reminders,analyze:model.analyze,now:()=> '2026-09-27T02:00:00Z'});
  const result=await capture.handle({id:'m1',senderId:'demo-user',conversationId:'demo-chat',type:'text',sentAt:'2026-09-27T10:00:00+08:00',text:'小婕 GTD，提醒我明天下午三点交报价'});
  assert.equal(result.status,'reminder_set');
  assert.equal((await reminders.getItem(result.itemId)).notes.includes('小婕的建议：核对报价后发送。'),true);
  assert.equal(model.usage().calls,1);
  assert.equal(model.usage().inputTokens,80);
});

test('自然语言收集只分析一次，讨论和未激活消息不创建', async () => {
  const reminders=createSimulatedReminders();
  let calls=0;
  const capture=createCapture({reminders,config:{modelIntents:true},analyze:async ({content})=>{
    calls++;
    return {intent:content.includes('怎么看')?'discuss':'collect',title:'准备提案',suggestion:'列出提案要点。'};
  }});
  const base={senderId:'demo-user',conversationId:'demo-chat',type:'text',sentAt:'2026-09-27T10:00:00+08:00'};
  assert.equal((await capture.handle({...base,id:'n1',text:'小婕 GTD，帮我记一下周五的提案'})).status,'collected');
  assert.equal(calls,1);
  assert.equal((await capture.handle({...base,id:'n2',text:'小婕 GTD，你怎么看周五的提案'})).status,'needs_instruction');
  assert.equal((await capture.handle({...base,id:'n3',text:'帮我记一下周五的提案'})).status,'not_handled');
  assert.equal((await reminders.listItems()).length,1);
});

test('模型预算跨重启保留，失败不泄漏正文或密钥，明确收集仍降级保存', async t => {
  const dir=mkdtempSync(join(tmpdir(),'pgtd-budget-'));
  const options={statePath:join(dir,'usage.sqlite'),apiKey:async ()=>'secret-never-log',config:{maxCalls:1},
    fetchImpl:async()=>new Response('secret-never-log private-content',{status:429})};
  const first=openGeminiAnalyzer(options);
  const reminders=createSimulatedReminders();
  const capture=createCapture({reminders,analyze:first.analyze});
  const result=await capture.handle({id:'b1',senderId:'demo-user',conversationId:'demo-chat',type:'text',sentAt:'2026-09-27T10:00:00+08:00',text:'小婕 GTD，收集：private-content'});
  assert.equal(result.status,'collected_analysis_failed');
  assert.equal(first.usage().records[0].failureReason,'http_429');
  assert.equal(JSON.stringify(first.usage()).includes('secret-never-log'),false);
  assert.equal(JSON.stringify(first.usage()).includes('private-content'),false);
  await first.close();
  const second=openGeminiAnalyzer(options);
  t.after(async()=>{await second.close();rmSync(dir,{recursive:true,force:true});});
  await assert.rejects(second.analyze({content:'retry'}),/budget exhausted/);
  assert.equal(second.usage().calls,1);
});

test('模型声称已经归档或写入时拒绝该建议，保留原文并说明分析失败', async t => {
  const dir=mkdtempSync(join(tmpdir(),'pgtd-output-'));
  const model=openGeminiAnalyzer({statePath:join(dir,'usage.sqlite'),apiKey:async ()=>'fake',fetchImpl:async()=>new Response(JSON.stringify({
    modelVersion:'gemini-3.8-flash',usageMetadata:{promptTokenCount:50,candidatesTokenCount:40},
    candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({intent:'collect',title:'链接',suggestion:'已将链接归入收集箱。',reminder:{date:null,time:null,timeZone:'Asia/Shanghai'}})}]}}],
  }))});
  t.after(async()=>{await model.close();rmSync(dir,{recursive:true,force:true});});
  const reminders=createSimulatedReminders();
  const capture=createCapture({reminders,analyze:model.analyze});
  const result=await capture.handle({id:'o1',senderId:'demo-user',conversationId:'demo-chat',type:'text',sentAt:'2026-09-27T10:00:00+08:00',text:'小婕 GTD，收集：https://example.org'});
  assert.equal(result.status,'collected_analysis_failed');
  assert.equal((await reminders.getItem(result.itemId)).notes.includes('小婕的建议'),false);
});

test('金额上限不足时连模型 HTTP 请求也不发出', async t => {
  const dir=mkdtempSync(join(tmpdir(),'pgtd-limits-'));
  let sent=0;
  const model=openGeminiAnalyzer({statePath:join(dir,'usage.sqlite'),apiKey:async ()=>'fake',config:{maxBudgetUsd:0.000001},
    fetchImpl:async()=>{sent++;throw new Error('should not call');}});
  t.after(async()=>{await model.close();rmSync(dir,{recursive:true,force:true});});
  await assert.rejects(model.analyze({content:'记录想法'}),/budget exhausted/);
  assert.equal(sent,0);
  assert.equal(model.usage().calls,0);
});

test('模型超时后停止等待并降级保存，记录固定失败原因', async t => {
  const dir=mkdtempSync(join(tmpdir(),'pgtd-timeout-'));
  const model=openGeminiAnalyzer({statePath:join(dir,'usage.sqlite'),apiKey:async ()=>'fake',config:{timeoutMs:5},
    fetchImpl:async (_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('timeout')),{once:true}))});
  t.after(async()=>{await model.close();rmSync(dir,{recursive:true,force:true});});
  // Keep test host alive: AbortSignal.timeout uses an unreferenced timer.
  const keepAlive=setTimeout(()=>{},1000);
  try {
    await assert.rejects(model.analyze({content:'收集：合成测试'}),/unavailable/);
    assert.equal(model.usage().records[0].failureReason,'network_or_timeout');
    assert.equal(model.usage().unsettledCalls,1);
  } finally {clearTimeout(keepAlive);}
});

test('凭据解析也受总超时限制，超时前未发送模型请求不计费', async t => {
  const dir=mkdtempSync(join(tmpdir(),'pgtd-auth-timeout-'));
  const model=openGeminiAnalyzer({statePath:join(dir,'usage.sqlite'),apiKey:async()=>new Promise(()=>{}),config:{timeoutMs:5}});
  t.after(async()=>{await model.close();rmSync(dir,{recursive:true,force:true});});
  const keepAlive=setTimeout(()=>{},50);
  try {
    const outcome=await Promise.race([model.analyze({content:'测试'}).then(()=> 'success',()=> 'rejected'),new Promise(resolve=>setTimeout(()=>resolve('stuck'),30))]);
    assert.equal(outcome,'rejected');
    assert.equal(model.usage().calls,0);
  } finally {clearTimeout(keepAlive);}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFeishuCapture } from '../src/feishu-capture.js';

const scope = { accountId:'default', entryAgentId:'xiaojie', allowedSenderIds:['ou_test'], allowedConversationIds:['oc_test'], enabledModules:['okr'] };
test('只配置OKR可启动，不建立GTD日志，禁用GTD请求明确拒绝', async t => {
  const dir=mkdtempSync(join(tmpdir(),'okr-only-'));
  let capture;
  t.after(async()=>{await capture?.close();rmSync(dir,{recursive:true,force:true});});
  const text='小婕 gtd 收集：不应创建';
  const feishu={getMessage:async()=>({message_id:'om_1',chat_id:'oc_test',sender:{id:'ou_test',id_type:'open_id',sender_type:'user'},msg_type:'text',create_time:'1790474400000',body:{content:JSON.stringify({text})}}),reply:async()=>({message_id:'om_bot',chat_id:'oc_test'})};
  capture=openFeishuCapture({stateDir:dir,config:scope,feishu});
  const result=await capture.handle({Provider:'feishu',AccountId:'default',AgentId:'xiaojie',SenderId:'ou_test',NativeChannelId:'oc_test',MessageSid:'om_1',rawText:text});
  assert.equal(result.status,'module_disabled');
  assert.equal(existsSync(join(dir,'capture.sqlite')),false);
  assert.deepEqual(await capture.recover(),[]);
});

test('OpenClaw仅启用OKR无需提醒helper、sourceId或listId', async t => {
  const { writeFileSync } = await import('node:fs');
  const { openRuntime } = await import('../openclaw/runtime.js');
  const dir=mkdtempSync(join(tmpdir(),'okr-runtime-'));
  let runtime;
  t.after(async()=>{await runtime?.close();rmSync(dir,{recursive:true,force:true});});
  const path=join(dir,'config.json');
  writeFileSync(path,JSON.stringify({enabledModules:['okr'],usagePath:join(dir,'usage.sqlite'),model:{maxBudgetUsd:1,maxCalls:10},okr:{account:'synthetic',folder:'Notes',journalDir:join(dir,'journal')}}));
  runtime=await openRuntime({config:{...scope,runtimeConfigPath:path,stateDir:join(dir,'state')},hostConfig:{channels:{feishu:{appId:'synthetic',appSecret:'synthetic'}}},googleKey:()=>async()=> 'synthetic'});
  assert.deepEqual(await runtime.recover(),[]);
  assert.equal(existsSync(join(dir,'state','adapter.sqlite')),false);
});

test('OKR单模块七轮讨论、暂停重启、原身份草案确认和旧入口读回同一最新稿', async t => {
  const { standaloneFixture }=await import('../examples/okr-standalone-fixture.js');
  const dir=mkdtempSync(join(tmpdir(),'okr-flow-')),f=standaloneFixture(dir);
  t.after(async()=>{await f.close();rmSync(dir,{recursive:true,force:true});});
  assert.equal((await f.send('om_open','小婕 okr 讨论')).status,'okr_open');
  await f.send('om_r1','合成回答1',{parent:f.sent.at(-1).message_id});
  assert.equal((await f.send('om_pause','暂停',{parent:f.sent.at(-1).message_id})).status,'okr_paused');
  await f.restart();
  assert.equal((await f.send('om_resume','小婕 gtd okr 续接')).status,'okr_open');
  let ready;
  for(let i=2;i<=7;i++) ready=await f.send('om_r'+i,'合成回答'+i,{parent:f.sent.at(-1).message_id});
  const parent=f.sent.at(-1).message_id;
  assert.ok(ready.draftVersion);
  assert.equal(f.notes.length,1);
  assert.equal((await f.send('om_wrong','小婕 okr 确认定稿',{parent,sender:'ou_other'})).status,'okr_paused');
  assert.equal((await f.send('om_unlinked','小婕 okr 确认定稿')).status,'okr_needs_confirmation');
  await f.restart();
  const result=await f.send('om_confirm','确认定稿',{parent});
  assert.equal(result.status,'okr_finalized');
  const calls=f.guideCalls,writes=f.operations.filter(c=>['create','append','replace'].includes(c)).length;
  await f.restart();
  assert.equal((await f.send('om_confirm','确认定稿',{parent})).noteId,result.noteId);
  assert.equal(f.guideCalls,calls);
  assert.equal(f.operations.filter(c=>['create','append','replace'].includes(c)).length,writes);
  assert.equal(f.notes.length,2);
  assert.match((await f.send('om_read','小婕 gtd okr 讨论')).receipt,/当前目标|最新/);
  assert.ok(f.notes.find(n=>n.id===result.noteId).nativeTags.includes('#KR3'));
});

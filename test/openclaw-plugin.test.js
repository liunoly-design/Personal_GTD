import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlugin } from '../openclaw/index.js';
const config={enabled:true,accountId:'default',entryAgentId:'xiaojie',allowedSenderIds:['ou_test'],allowedConversationIds:['oc_test'],
  stateDir:'/tmp/unused-pgtd',runtimeConfigPath:'/tmp/unused-pgtd.json'};
const ctx={Provider:'feishu',AccountId:'default',AgentId:'xiaojie',SenderId:'ou_test',NativeChannelId:'oc_test',CommandAuthorized:true,
  rawText:'小婕 GTD，收集：测试',MessageSid:'om_test'};
function host(pluginConfig=config){
  let hook,service; const replies=[],processed=[];
  const api={pluginConfig,config:{},logger:{info(){},warn(){}},on(name,fn){assert.equal(name,'reply_dispatch');hook=fn;},
    registerService(value){service=value;}};
  const dispatch={dispatcher:{sendFinalReply(p){replies.push(p);return true;},getQueuedCounts(){return {tool:0,block:0,final:replies.length};}},
    recordProcessed(...args){processed.push(args);},markIdle(){}};
  return {api,dispatch,replies,processed,get hook(){return hook;},get service(){return service;}};
}

test('插件只接管授权的 GTD 消息，不调用宿主模型或重复回执，停止时关闭日志',async()=>{
  let opened=0,closed=0;
  const h=host();
  createPlugin({openRuntime:async()=>{opened++;return {handle:async()=>({status:'collected',delivery:'sent'}),close:async()=>{closed++;}};}}).register(h.api);
  assert.equal(await h.hook({ctx:{...ctx,rawText:'普通聊天'},sendPolicy:'allow'},h.dispatch),undefined);
  assert.equal(opened,0);
  const result=await h.hook({ctx,sendPolicy:'allow'},h.dispatch);
  assert.equal(result.handled,true);assert.equal(result.queuedFinal,false);assert.equal(h.replies.length,0);
  await h.service.stop();assert.equal(closed,1);
});

test('飞书自然语言不具备控制命令授权标志时仍接管白名单收集',async()=>{
  const h=host();let handled=0;
  createPlugin({openRuntime:async()=>({handle:async()=>{handled++;return {status:'collected',delivery:'sent'};},close:async()=>{}})}).register(h.api);
  const result=await h.hook({ctx:{...ctx,rawText:undefined,RawBody:ctx.rawText,CommandAuthorized:false},sendPolicy:'allow'},h.dispatch);
  assert.equal(result?.handled,true);
  assert.equal(handled,1);
  await h.service.stop();
});

test('宿主禁止发送、取消或重定向时不写入；运行失败仍接管并给准确失败提示',async()=>{
  let opened=0;
  const h=host();
  createPlugin({openRuntime:async()=>{opened++;throw new Error('private secret body');}}).register(h.api);
  for(const patch of [{sendPolicy:'deny'},{suppressUserDelivery:true},{shouldRouteToOriginating:true}]) {
    assert.equal((await h.hook({ctx,sendPolicy:'allow',...patch},h.dispatch)).handled,true);
  }
  assert.equal(opened,0);
  const result=await h.hook({ctx,sendPolicy:'allow'},h.dispatch);
  assert.equal(result.handled,true);assert.equal(opened,1);
  assert.match(h.replies.at(-1).text,/未确认完成/);
  assert.doesNotMatch(JSON.stringify(h.replies),/private secret/);
  await h.service.stop();
});

test('启用时缺少白名单立即拒绝注册；忙碌时明确告知没有接收',async()=>{
  const invalid=host({...config,allowedSenderIds:[]});
  assert.throws(()=>createPlugin().register(invalid.api),/scope|allowlist/i);
  const h=host();
  createPlugin({openRuntime:async()=>({handle:async()=>({status:'busy'}),close:async()=>{}})}).register(h.api);
  const result=await h.hook({ctx,sendPolicy:'allow'},h.dispatch);
  assert.equal(result.queuedFinal,true);assert.match(h.replies[0].text,/未开始/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFeishuCapture } from '../src/feishu-capture.js';
import { openPersistentSimulation } from '../src/persistent-simulation.js';
import { simulatedAnalysis } from '../src/simulation.js';

const scope = { accountId: 'default', entryAgentId: 'xiaojie', allowedSenderIds: ['ou_test'], allowedConversationIds: ['oc_test'] };
const context = (id='om_1', text='小婕 GTD，收集：一个想法') => ({ Provider:'feishu', AccountId:'default', AgentId:'xiaojie',
  NativeChannelId:'oc_test', SenderId:'ou_test', MessageSid:id, rawText:text, CommandAuthorized:true });
const message = (id='om_1', text='小婕 GTD，收集：一个想法', extra={}) => ({ message_id:id,chat_id:'oc_test',
  sender:{id:'ou_test',id_type:'open_id',sender_type:'user'},msg_type:'text',create_time:'1790474400000',
  body:{content:JSON.stringify({text})}, ...extra });
function fixture(t, options={}) {
  const dir=mkdtempSync(join(tmpdir(),'pgtd-feishu-'));
  const reminders=openPersistentSimulation({path:join(dir,'apple.sqlite'),afterWrite:options.afterAppleWrite});
  const messages=new Map([['om_1',message()]]), sent=[];
  let reads=0, calls=0;
  const feishu={ async getMessage(id){reads++; return messages.get(id);},async reply(input){
    const result={message_id:'om_bot_'+(sent.length+1),chat_id:input.conversationId};sent.push({...input,...result});
    if(options.loseReply) throw new Error('response lost');return result;
  }};
  const make=()=>openFeishuCapture({stateDir:dir,config:{...scope,...options.config},reminders,feishu,
    analyze:async args=>{calls++;return simulatedAnalysis(args);},now:()=> '2026-09-27T02:00:00Z'});
  let capture=make();
  t.after(async()=>{await capture.close();reminders.close();rmSync(dir,{recursive:true,force:true});});
  return {get capture(){return capture;},reminders,messages,sent,get reads(){return reads;},get calls(){return calls;},
    async restart(){await capture.close();capture=make();}};
}

test('可信飞书事件收集原文，重投和重启不重复 Apple 或回执',async t=>{
  const f=fixture(t);
  assert.equal((await f.capture.handle(context())).status,'collected');
  await f.restart();
  await f.capture.handle(context());
  const items=await f.reminders.listItems();
  assert.equal(items.length,1); assert.equal(f.calls,1);assert.equal(f.sent.length,1);
  assert.match(items[0].notes,/原文：\n小婕 GTD，收集：一个想法/);
  assert.match(f.sent[0].text,/^【Apple】已收集到 Inbox/);
});

test('无激活、未授权或错误入口在读取原消息前拦截，原消息身份也须匹配',async t=>{
  const f=fixture(t);
  for(const patch of [{Provider:'other'},{AccountId:'other'},{AgentId:'wiki'},{SenderId:'ou_other'},
    {NativeChannelId:'oc_other'},{CommandAuthorized:false},{rawText:'引用：小婕 GTD，收集：不应收集'}]) {
    assert.equal((await f.capture.handle({...context(),...patch})).status,'not_handled');
  }
  assert.equal(f.reads,0);
  f.messages.set('om_1',message(undefined,undefined,{sender:{id:'ou_other',id_type:'open_id',sender_type:'user'}}));
  assert.equal((await f.capture.handle(context())).status,'invalid_source');
  assert.equal((await f.reminders.listItems()).length,0);assert.equal(f.calls,0);assert.equal(f.sent.length,0);
});

test('直接回复机器人回执可澄清时间，跨重启和再次追问仍定位原事项',async t=>{
  const f=fixture(t);
  const text='小婕 GTD，提醒我明天交报价';
  f.messages.set('om_1',message('om_1',text));
  const first=await f.capture.handle(context('om_1',text));
  assert.equal(first.status,'collected_awaiting_time');
  await f.restart();
  f.messages.set('om_2',message('om_2','还没确定',{parent_id:f.sent[0].message_id}));
  assert.equal((await f.capture.handle({...context('om_2','还没确定'),ReplyToId:f.sent[0].message_id})).status,'collected_awaiting_time');
  f.messages.set('om_3',message('om_3','15:00',{parent_id:f.sent[1].message_id}));
  const clarified=await f.capture.handle({...context('om_3','15:00'),ReplyToId:f.sent[1].message_id});
  assert.equal(clarified.status,'reminder_set');assert.equal(clarified.itemId,first.itemId);
  assert.equal((await f.reminders.listItems()).length,1);
  assert.equal((await f.reminders.getItem(first.itemId)).remindAt,'2026-09-28T07:00:00Z');
});

test('原消息是富文本时拒收；链接确认前不写入，确认后保留原链接',async t=>{
  const f=fixture(t);
  f.messages.set('om_1',message(undefined,undefined,{msg_type:'post',body:{content:'{}'}}));
  assert.equal((await f.capture.handle(context())).status,'unsupported');
  assert.equal(f.sent.length,1);assert.match(f.sent[0].text,/只支持文字/);
  const link='小婕 GTD，https://example.org/article';
  f.messages.set('om_link',message('om_link',link));
  assert.equal((await f.capture.handle(context('om_link',link))).status,'awaiting_confirmation');
  assert.equal((await f.reminders.listItems()).length,0);
  f.messages.set('om_yes',message('om_yes','确认',{parent_id:f.sent[1].message_id}));
  assert.equal((await f.capture.handle({...context('om_yes','确认'),ReplyToId:f.sent[1].message_id})).status,'collected');
  assert.match((await f.reminders.listItems())[0].notes,/https:\/\/example.org\/article/);
});

test('回执响应丢失后重投和重启不重新发送或创建',async t=>{
  const f=fixture(t,{loseReply:true});
  assert.equal((await f.capture.handle(context())).delivery,'pending');
  await f.restart();
  assert.equal((await f.capture.handle(context())).delivery,'pending');
  assert.equal(f.sent.length,1);assert.equal(f.calls,1);assert.equal((await f.reminders.listItems()).length,1);
});

test('普通回复不读取消息；已编辑的消息不作为新指令执行',async t=>{
  const f=fixture(t);
  assert.equal((await f.capture.handle({...context('om_reply','确认'),ReplyToId:'om_unknown'})).status,'not_handled');
  assert.equal(f.reads,0);
  f.messages.set('om_1',message(undefined,undefined,{updated:true}));
  assert.equal((await f.capture.handle(context())).status,'invalid_source');
  assert.equal(f.calls,0);
});

test('取消请求不读取消息或写入',async t=>{
  const f=fixture(t);
  const abort=new AbortController();abort.abort();
  assert.equal((await f.capture.handle(context(),{signal:abort.signal})).status,'cancelled');
  assert.equal(f.reads,0);assert.equal((await f.reminders.listItems()).length,0);
});

test('宿主上下文可带不可序列化能力，业务只读取明确的来源字段',async t=>{
  const f=fixture(t);
  const result=await f.capture.handle({...context(),capability:()=>{},BodyForAgent:'伪造的封装正文'});
  assert.equal(result.status,'collected');
  assert.doesNotMatch((await f.reminders.listItems())[0].notes,/伪造/);
});

test('事件容量满后拒绝新消息，但已有消息仍可安全重投',async t=>{
  const f=fixture(t,{config:{maxStoredEvents:1}});
  await f.capture.handle(context());
  f.messages.set('om_2',message('om_2'));
  assert.equal((await f.capture.handle(context('om_2'))).status,'budget_exhausted');
  assert.equal(f.reads,1);
  assert.equal((await f.capture.handle(context())).status,'collected');
  assert.equal((await f.reminders.listItems()).length,1);
});

test('Apple 写入成功但响应丢失，显式恢复核对真实 ID 后补发最终回执',async t=>{
  let lost=false;
  const f=fixture(t,{afterAppleWrite:kind=>{if(kind==='item'&&!lost){lost=true;throw new Error('lost');}}});
  assert.equal((await f.capture.handle(context())).status,'result_unknown');
  assert.match(f.sent[0].text,/尚未确认成功/);
  await f.restart();
  const recovered=await f.capture.recover();
  assert.equal(recovered[0].status,'collected');assert.equal(recovered[0].delivery,'sent');
  assert.equal((await f.reminders.listItems()).length,1);assert.equal(f.calls,1);
  assert.equal(f.sent.length,2);assert.match(f.sent[1].text,/已收集到 Inbox/);
});

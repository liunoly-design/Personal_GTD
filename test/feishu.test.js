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
  const make=()=>openFeishuCapture({stateDir:dir,config:{...scope,...options.config},reminders,feishu,notesBridge:options.notesBridge,
    analyze:async args=>{calls++;return simulatedAnalysis(args);},now:()=> '2026-09-27T02:00:00Z'});
  let capture=make();
  t.after(async()=>{await capture.close();reminders.close();rmSync(dir,{recursive:true,force:true});});
  return {get capture(){return capture;},reminders,messages,sent,get reads(){return reads;},get calls(){return calls;},
    async restart(){await capture.close();capture=make();}};
}

test('可信飞书事件收集原文，重投和重启不重复 Apple 或回执',async t=>{
  const f=fixture(t);
  assert.equal((await f.capture.handle({...context(),CommandAuthorized:false})).status,'collected');
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
    {NativeChannelId:'oc_other'},{SenderIsBot:true},{rawText:'引用：小婕 GTD，收集：不应收集'}]) {
    assert.equal((await f.capture.handle({...context(),...patch})).status,'not_handled');
  }
  assert.equal(f.reads,0);
  f.messages.set('om_1',message(undefined,undefined,{sender:{id:'ou_other',id_type:'open_id',sender_type:'user'}}));
  assert.equal((await f.capture.handle(context())).status,'invalid_source');
  assert.equal((await f.reminders.listItems()).length,0);assert.equal(f.calls,0);assert.equal(f.sent.length,0);
});

test('待澄清时未关联的时间回复提示选择原事项，不交给普通模型猜测',async t=>{
  const f=fixture(t);
  const text='小婕 GTD，提醒我明天交报价';
  f.messages.set('om_1',message('om_1',text));
  assert.equal((await f.capture.handle(context('om_1',text))).status,'collected_awaiting_time');
  await f.restart();
  const calls=f.calls;
  f.messages.set('om_time',message('om_time','明天上午十点'));
  const result=await f.capture.handle(context('om_time','明天上午十点'));
  assert.equal(result.status,'needs_target');
  assert.equal(result.delivery,'sent');
  assert.equal(f.calls,calls);
  assert.equal((await f.reminders.listItems()).length,1);
  assert.match(f.sent.at(-1).text,/关联.*原请求/);
});

test('没有待澄清事项时的时间聊天不收集，也不发送 PGTD 回执',async t=>{
  const f=fixture(t);
  f.messages.set('om_time',message('om_time','明天上午十点'));
  assert.equal((await f.capture.handle(context('om_time','明天上午十点'))).status,'not_handled');
  assert.equal(f.calls,0);assert.equal(f.sent.length,0);
  assert.equal((await f.reminders.listItems()).length,0);
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

test('激活词兼容大小写和空格，保留正文且不扩大触发或授权范围', async t => {
  const f = fixture(t);
  const prefixes = ['小婕 gtd', '小婕GTD', '小婕  GtD', '  小婕\u3000gTd'];
  for (const [index, prefix] of prefixes.entries()) {
    const id = 'om_variant_' + index;
    const text = prefix + '，收集：空格测试 ' + index;
    f.messages.set(id, message(id, text));
    const result = await f.capture.handle(context(id, text));
    assert.equal(result.status, 'collected');
    const item = await f.reminders.getItem(result.itemId);
    assert.equal(item.title, '空格测试 ' + index);
    assert.ok(item.notes.includes(text));
  }
  for (const text of ['讨论小婕 gtd，收集：误触发', '小婕 gtd扩展，收集：误触发']) {
    assert.equal((await f.capture.handle(context('om_no', text))).status, 'not_handled');
  }
  assert.equal((await f.capture.handle({ ...context('om_denied', '小婕gtd，收集：越权'), SenderId: 'ou_other' })).status, 'not_handled');
  assert.equal((await f.reminders.listItems()).length, 4);
});

test('OKR 未配置时明确提示，启动表达绝不落入 Inbox', async t => {
  const f=fixture(t);
  const text='小婕 gtd okr 讨论';
  f.messages.set('om_okr',message('om_okr',text));
  const result=await f.capture.handle(context('om_okr',text));
  assert.equal(result.status,'okr_unavailable');
  assert.equal((await f.reminders.listItems()).length,0);
  assert.equal(f.calls,0);
});

test('飞书 OKR 关联回复跨重启保存标签原文，暂停后不写，不调用收集模型', async t => {
  const notes=[];
  const notesBridge=async r=>{
    if(r.command==='bind') return {accountId:'a',folderId:'f'};
    if(r.command==='create'){const n={id:'note1',body:r.body,plaintext:r.body};notes.push(n);return {...n};}
    const n=notes.find(n=>n.id===r.noteId);
    if(r.command==='append'){assert.equal(n.body,r.expectedBody);n.body+=r.addition;n.plaintext=n.body;}
    return {...n};
  };
  const f=fixture(t,{config:{okr:{account:'iCloud',folder:'Notes'}},notesBridge});
  const start='小婕 gtd okr 讨论';
  f.messages.set('om_okr',message('om_okr',start));
  assert.equal((await f.capture.handle(context('om_okr',start))).status,'okr_open');
  await f.restart();
  const parent=f.sent[0].message_id;
  f.messages.set('om_answer',message('om_answer','#O1 合成目标 #KR1 合成结果',{parent_id:parent}));
  const ctx={...context('om_answer','#O1 合成目标 #KR1 合成结果'),ReplyToId:parent};
  assert.equal((await f.capture.handle(ctx)).status,'okr_saved');
  await f.capture.handle(ctx);
  assert.equal(notes[0].body.split('合成目标').length,2);
  const pause='小婕 GTD okr 暂停';
  f.messages.set('om_pause',message('om_pause',pause));
  assert.equal((await f.capture.handle(context('om_pause',pause))).status,'okr_paused');
  f.messages.set('om_later',message('om_later','暂不保存',{parent_id:parent}));
  assert.equal((await f.capture.handle({...context('om_later','暂不保存'),ReplyToId:parent})).status,'okr_paused');
  assert.doesNotMatch(notes[0].body,/暂不保存/);
  assert.equal(f.calls,0);assert.equal((await f.reminders.listItems()).length,0);
});

test('OKR 失败和未知子命令不回落收集，伪造来源也不能触发 Notes', async t => {
  let calls=0;
  const f=fixture(t,{config:{okr:{account:'iCloud',folder:'Notes'}},notesBridge:async()=>{calls++;throw new Error('PERMISSION_DENIED');}});
  const start='小婕 GTD okr 讨论';
  f.messages.set('om_bad',message('om_bad',start,{sender:{id:'ou_other',id_type:'open_id',sender_type:'user'}}));
  assert.equal((await f.capture.handle(context('om_bad',start))).status,'invalid_source');
  assert.equal(calls,0);
  f.messages.set('om_okr',message('om_okr',start));
  const failed=await f.capture.handle(context('om_okr',start));
  assert.equal(failed.status,'okr_error');assert.equal(failed.code,'PERMISSION_DENIED');
  const unknown='小婕 GTD okr 删除全部';
  f.messages.set('om_unknown',message('om_unknown',unknown));
  assert.equal((await f.capture.handle(context('om_unknown',unknown))).status,'okr_help');
  assert.equal(f.calls,0);assert.equal((await f.reminders.listItems()).length,0);
});

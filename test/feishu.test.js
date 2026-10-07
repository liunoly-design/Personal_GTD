import { sampleGuide } from '../examples/okr-sample.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFeishuCapture, validateFeishuScope } from '../src/feishu-capture.js';
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
  const make=()=>openFeishuCapture({stateDir:dir,config:{...scope,...options.config},reminders,feishu,notesBridge:options.notesBridge,okrGuide:options.okrGuide,
    analyze:async args=>{calls++;return simulatedAnalysis(args);},now:options.defaultClock ? undefined : ()=> '2026-09-27T02:00:00Z'});
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
    if(r.command==='create'){const n={id:'note1',body:r.body,plaintext:r.body.replaceAll('<br>','\n')};notes.push(n);return {...n};}
    const n=notes.find(n=>n.id===r.noteId);
    if(r.command==='append'){assert.equal(n.body,r.expectedBody);n.body+=r.addition;n.plaintext=n.body.replaceAll('<br>','\n');}
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

test('飞书显式确认必须回复当前草案，定稿不会创建 Inbox 事项', async t => {
  const notes=[];
  const notesBridge=async r=>{
    if(r.command==='bind')return {accountId:'a',folderId:'f'};
    if(r.command==='create'){const n={id:'n'+(notes.length+1),body:r.body,plaintext:r.body.replaceAll('<br>','\n')};notes.push(n);return {...n};}
    const n=notes.find(n=>n.id===r.noteId);
    if(r.command==='append'){assert.equal(n.body,r.expectedBody);n.body+=r.addition;n.plaintext=n.body.replaceAll('<br>','\n');}
    return {...n};
  };
  const okrGuide=sampleGuide();
  const f=fixture(t,{config:{okr:{account:'iCloud',folder:'Notes'}},notesBridge,okrGuide});
  const send=async(id,text,parent)=>{f.messages.set(id,message(id,text,parent?{parent_id:parent}:{}));return f.capture.handle({...context(id,text),...(parent?{ReplyToId:parent}:{})});};
  await send('om_start','小婕 okr 讨论');
  for(let i=1;i<=7;i++)await send('om_r'+i,'合成回答'+i,f.sent.at(-1).message_id);
  const ready=f.sent.at(-1).message_id;
  assert.equal((await send('om_self','确认定稿','om_r4')).status,'okr_needs_confirmation');
  assert.equal((await send('om_bare','小婕 GTD okr 确认定稿')).status,'okr_needs_confirmation');
  const result=await send('om_confirm','小婕 okr 确认定稿',ready);
  assert.equal(result.status,'okr_finalized');assert.equal(notes.length,2);
  assert.equal((await f.reminders.listItems()).length,0);assert.equal(f.calls,0);
});

test('OKR 辅助功能权限失败给出网关权限指引，不误报 Notes 自动化权限', async t => {
  const f = fixture(t, { config: { okr: { account: 'iCloud', folder: 'Notes' } },
    notesBridge: async () => { throw new Error('ACCESSIBILITY_DENIED'); } });
  const text = '小婕 GTD okr 讨论';
  f.messages.set('om_ax', message('om_ax', text));
  const result = await f.capture.handle(context('om_ax', text));
  assert.equal(result.code, 'ACCESSIBILITY_DENIED');
  assert.match(result.receipt, /网关.*node.*辅助功能/);
  assert.doesNotMatch(result.receipt, /检查备忘录访问权限/);
  assert.equal(f.calls, 0);
  assert.equal((await f.reminders.listItems()).length, 0);
});

test('OKR回复原回执可持续质询，updated但正文一致的普通回复不被误拒绝', async t => {
  const notes = []; let turns = 0;
  const notesBridge = async r => {
    if (r.command === 'bind') return { accountId: 'a', folderId: 'f' };
    if (r.command === 'create') { notes.push({ id: 'note1', body: r.body, plaintext: r.body }); return { ...notes[0] }; }
    const n = notes[0];
    if (r.command === 'append') { assert.equal(r.expectedBody, n.body); n.body += r.addition; n.plaintext = n.body.replaceAll('<br>', '\n'); }
    return { ...n };
  };
  const okrGuide = async () => { turns++; return { stage: 'direction', summary: '当前目标仍在澄清。', advice: '先核实需求证据，再选择方案。', questions: ['这一判断有什么实际证据？'], draft: null }; };
  const f = fixture(t, { config: { okr: { account: 'iCloud', folder: 'Notes' } }, notesBridge, okrGuide });
  const start = '小婕 gtd okr 讨论';
  f.messages.set('om_start', message('om_start', start));
  await f.capture.handle(context('om_start', start));
  const parent = f.sent[0].message_id;
  for (let i = 0; i < 15; i++) {
    if (i === 7) await f.restart();
    const id = 'om_continue_' + i, text = '合成讨论依据' + i;
    f.messages.set(id, message(id, text, { parent_id: parent, updated: true }));
    const input = { ...context(id, text), ReplyToId: parent };
    assert.equal((await f.capture.handle(input)).status, 'okr_guided');
    assert.equal((await f.capture.handle(input)).status, 'okr_guided');
  }
  assert.equal(turns, 15);
  assert.equal(notes.length, 1);
  assert.equal((await f.reminders.listItems()).length, 0);
});

test('OKR更新回复正文不一致或同ID改文时提示重发，不能重新执行', async t => {
  const note = { id: 'n', body: '', plaintext: '' }; let writes = 0;
  const f = fixture(t, { config: { okr: { account: 'iCloud', folder: 'Notes' } }, notesBridge: async r => {
    if (r.command === 'bind') return { accountId: 'a', folderId: 'f' };
    if (r.command === 'create') note.body = note.plaintext = r.body;
    if (r.command === 'append') { writes++; note.body += r.addition; note.plaintext = note.body.replaceAll('<br>', '\n'); }
    return { ...note };
  } });
  const start = '小婕 gtd okr 讨论';
  f.messages.set('om_start', message('om_start', start));
  await f.capture.handle(context('om_start', start));
  const parent = f.sent[0].message_id;
  const input = text => ({ ...context('om_edit', text), ReplyToId: parent });
  f.messages.set('om_edit', message('om_edit', '新内容', { parent_id: parent, updated: true }));
  assert.equal((await f.capture.handle(input('旧内容'))).status, 'source_changed');
  assert.match(f.sent.at(-1).text, /新消息回复原 OKR/);
  assert.equal(writes, 0);
  assert.equal((await f.capture.handle(input('新内容'))).status, 'okr_saved');
  await f.restart();
  f.messages.set('om_edit', message('om_edit', '再次修改', { parent_id: parent, updated: true }));
  assert.equal((await f.capture.handle(input('再次修改'))).status, 'source_changed');
  assert.equal(writes, 1);
  f.messages.set('om_confirm_edit', message('om_confirm_edit', '确认定稿', { parent_id: parent, updated: true }));
  assert.equal((await f.capture.handle({ ...context('om_confirm_edit', '确认定稿'), ReplyToId: parent })).status, 'invalid_source');
});

test('OKR 读取超时保留错误与操作阶段，不冒充权限错误', async t => {
  const f = fixture(t, { defaultClock: true, config: { okr: { account: 'iCloud', folder: 'Notes', noteId: 'n_test' } },
    notesBridge: async r => {
      if (r.command === 'bind') return { accountId: 'a_test', folderId: 'f_test' };
      throw new Error('APPLE_TIMEOUT');
    } });
  const text = '小婕 GTD okr 讨论';
  f.messages.set('om_timeout', message('om_timeout', text));
  const result = await f.capture.handle(context('om_timeout', text));
  assert.equal(result.code, 'APPLE_TIMEOUT');
  assert.equal(result.operation, 'read');
  assert.match(result.receipt, /超时/);
  assert.doesNotMatch(result.receipt, /权限/);
  assert.equal(f.calls, 0);
});

test('OKR 界面占用可辨识，未知异常的私人正文不会进入回执或错误码', async t => {
  for (const [failure, expected] of [['NOTES_UI_BUSY', 'NOTES_UI_BUSY'], ['private note contents', 'NOTES_UNAVAILABLE']]) {
    const f = fixture(t, { config: { okr: { account: 'iCloud', folder: 'Notes' } },
      notesBridge: async () => { throw new Error(failure); } });
    const text = '小婕 GTD okr 讨论';
    f.messages.set('om_failure', message('om_failure', text));
    const result = await f.capture.handle(context('om_failure', text));
    assert.equal(result.code, expected);
    assert.equal(result.operation, 'bind');
    assert.doesNotMatch(JSON.stringify(result), /private note contents/);
    if (failure === 'NOTES_UI_BUSY') assert.match(result.receipt, /另一项操作/);
  }
});

test('平级 Review 入口准确答复、重投不重复回执且不写业务对象', async t => {
  const f = fixture(t);
  const text = '  小婕REVIEW：日复盘';
  f.messages.set('om_review', message('om_review', text));
  const ctx = context('om_review', text);
  assert.equal((await f.capture.handle(ctx)).status, 'review_unavailable');
  await f.restart();
  assert.equal((await f.capture.handle(ctx)).status, 'review_unavailable');
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].text, /尚未.*实现|尚未.*启用/);
  assert.equal(f.calls, 0);
  assert.equal((await f.reminders.listItems()).length, 0);
});

function syntheticNotes() {
  const notes = [];
  let calls = 0;
  const bridge = async r => {
    calls++;
    if (r.command === 'bind') return { accountId: 'a', folderId: 'f' };
    if (r.command === 'create') {
      const n = { id: 'note' + (notes.length + 1), body: r.body, plaintext: r.body.replaceAll('<br>', '\n') };
      notes.push(n); return { ...n };
    }
    const n = notes.find(n => n.id === r.noteId);
    if (r.command === 'append') { assert.equal(n.body, r.expectedBody); n.body += r.addition; n.plaintext = n.body.replaceAll('<br>', '\n'); }
    return { ...n };
  };
  return { notes, bridge, get calls() { return calls; } };
}
async function dispatch(f, id, text, parent_id, extra = {}) {
  f.messages.set(id, message(id, text, { parent_id, ...extra }));
  return f.capture.handle({ ...context(id, text), ReplyToId: parent_id });
}

test('新 OKR 讨论/记录等义表达复用旧会话，明确入口优先于 GTD 回复', async t => {
  const n = syntheticNotes();
  const f = fixture(t, { config: { okr: { account: 'iCloud', folder: 'Notes' } }, notesBridge: n.bridge });
  await dispatch(f, 'om_gtd', '小婕 gtd 买牛奶');
  assert.equal((await dispatch(f, 'om_new', '小婕 OKR：聊聊', f.sent[0].message_id)).status, 'okr_open');
  assert.equal((await dispatch(f, 'om_record', '小婕 okr 帮我记一下：合成回答')).status, 'okr_saved');
  await f.restart();
  assert.equal((await dispatch(f, 'om_old', '小婕 gtd okr 续接')).status, 'okr_open');
  assert.equal((await dispatch(f, 'om_answer', '好的', f.sent[1].message_id)).status, 'okr_saved');
  assert.match(n.notes[0].body, /合成回答/);
  assert.match(n.notes[0].body, /好的/);
  assert.equal(n.notes.length, 1);
  assert.equal((await f.reminders.listItems()).length, 1);
});

test('GTD 明确查询维护和否定引用歧义不会误收集，普通任务与明确引用正文仍收集', async t => {
  const f = fixture(t);
  const blocked = ['查询今天任务', '看看今天还有什么没做', '查一下明天的日程', '记录过什么', '完成任务：买牛奶',
    '将所选任务标记完成', '新建日程：周会', '整理 Inbox', '别记录这句话', '如果我说完成任务：买牛奶',
    '“收集：买牛奶”', '收集牛奶并查询任务', '复盘昨天', '小婕 okr 讨论'];
  for (const [i, body] of blocked.entries()) {
    const result = await dispatch(f, 'om_block' + i, '小婕 gtd ' + body);
    assert.ok(['gtd_unsupported', 'needs_instruction'].includes(result.status), body + ': ' + result.status);
  }
  assert.equal(f.calls, 0);
  assert.equal((await f.reminders.listItems()).length, 0);
  for (const [i, body] of ['完成一份报告', '明天完成报告', '帮我记一下 买牛奶', '存一下：合成想法',
    '收集：他说“别记录这句话”', 'OKR 和复盘的资料', 'review 日复盘'].entries()) {
    assert.equal((await dispatch(f, 'om_save' + i, '小婕 gtd ' + body)).status, 'collected', body);
  }
  assert.equal((await f.reminders.listItems()).length, 7);
});

test('自定义激活词保留 GTD，默认三个入口并存且启动拒绝跨模块冲突', async t => {
  const f = fixture(t, { config: { activation: '记事' } });
  assert.equal((await dispatch(f, 'om_custom', '记事 买牛奶')).status, 'collected');
  assert.equal((await dispatch(f, 'om_default', '小婕gtd 买苹果')).status, 'collected');
  assert.equal((await dispatch(f, 'om_okr_new', '小婕 okr 讨论')).status, 'okr_unavailable');
  assert.equal((await dispatch(f, 'om_review_new', '小婕 review')).status, 'review_unavailable');
  for (const activation of ['小婕 OKR', '小婕okr 讨论', '小婕 review 注册', '小婕']) {
    assert.throws(() => validateFeishuScope({ ...scope, activation }), /activation.*conflict/i, activation);
  }
  const same = fixture(t, { config: { activation: '小婕GTD' } });
  assert.equal((await dispatch(same, 'om_same', '小婕 GTD 买牛奶')).status, 'collected');
});

test('不可用入口原文冲突不能改路由，丢失回执跨重启停止重发', async t => {
  const f = fixture(t, { loseReply: true });
  const text = '小婕 review 注册周复盘';
  assert.equal((await dispatch(f, 'om_sameid', text)).delivery, 'pending');
  await f.restart();
  const conflict = await dispatch(f, 'om_sameid', '小婕 gtd 买牛奶');
  assert.equal(conflict.status, 'event_conflict');
  assert.equal(conflict.delivery, 'pending');
  assert.equal((await f.capture.recover()).at(-1).delivery, 'pending');
  assert.equal(f.sent.length, 2);
  assert.equal((await f.reminders.listItems()).length, 0);
});

test('三个命名空间边界、空入口和 OKR 否定/查询均不新增业务调用', async t => {
  const n = syntheticNotes();
  const f = fixture(t, { config: { okr: { account: 'iCloud', folder: 'Notes' } }, notesBridge: n.bridge });
  for (const [i, text] of ['小婕', '小婕 okrx 讨论', '小婕 reviewable 日复盘', '正文 小婕 okr 讨论',
    '“小婕 gtd 买牛奶”', '> 小婕 review 日复盘'].entries()) {
    assert.equal((await dispatch(f, 'om_boundary' + i, text)).status, 'not_handled');
  }
  for (const [i, text] of ['小婕 okr', '小婕 OKR：未知动作', '小婕 okr 不要记录这句话',
    '小婕 okr “记录：引用”', '小婕 okr 讨论并删除任务', '小婕 okr 好的'].entries()) {
    assert.equal((await dispatch(f, 'om_help' + i, text)).status, 'okr_help');
  }
  assert.equal((await dispatch(f, 'om_query_unbound', '小婕 okr 看看当前目标')).status, 'okr_query_needs_binding');
  assert.equal((await dispatch(f, 'om_empty', '小婕GTD')).status, 'needs_instruction');
  assert.equal(n.calls, 0);
  assert.equal(f.calls, 0);
  assert.equal((await f.reminders.listItems()).length, 0);
  await dispatch(f, 'om_start_guard', '小婕 okr 讨论');
  const parent = f.sent.at(-1).message_id;
  const before = n.calls;
  assert.equal((await dispatch(f, 'om_link_query', '查询当前目标', parent)).status, 'okr_query_needs_binding');
  assert.equal((await dispatch(f, 'om_link_neg', '不要记录这句话', parent)).status, 'okr_help');
  assert.equal(n.calls, before);
});

test('提醒明确等义表达仍更新同一事项并保留原文', async t => {
  const f = fixture(t);
  for (const [i, verb] of ['提醒我', '到时候叫我', '记得通知我'].entries()) {
    const text = '小婕GTD，' + verb + '明天下午三点交报价';
    const result = await dispatch(f, 'om_syn_remind' + i, text);
    assert.equal(result.status, 'reminder_set');
    assert.equal(result.remindAt, '2026-09-28T07:00:00Z');
    assert.match((await f.reminders.listItems()).at(-1).notes, new RegExp(verb));
  }
  assert.equal((await f.reminders.listItems()).length, 3);
});

test('空提醒同义指令只要求补充内容，不写入空任务', async t => {
  const f = fixture(t);
  for (const [i, body] of ['到时候叫我', '记得通知我', '帮我记一下：', '存一下'].entries()) {
    assert.equal((await dispatch(f, 'om_empty_syn' + i, '小婕 gtd ' + body)).status, 'needs_instruction');
  }
  assert.equal(f.calls, 0);
});

test('平级入口仍核对真实身份、更新标记及原消息正文，不信任上下文路由', async t => {
  const f = fixture(t);
  for (const [i, extra] of [{ sender: { id: 'ou_other', id_type: 'open_id', sender_type: 'user' } },
    { chat_id: 'oc_other' }, { updated: true }, { deleted: true }].entries()) {
    assert.equal((await dispatch(f, 'om_invalid_new' + i, '小婕 okr 讨论', undefined, extra)).status, 'invalid_source');
  }
  f.messages.set('om_truth', message('om_truth', '普通聊天'));
  assert.equal((await f.capture.handle(context('om_truth', '小婕 review 日复盘'))).status, 'not_handled');
  assert.equal(f.sent.length, 0);
  assert.equal(f.calls, 0);
});

test('旧 OKR 未知动作和记录查询仍留在 OKR，不落入默认收集', async t => {
  const f = fixture(t);
  for (const [i, body] of ['未知动作', '记录过什么', '查询当前目标'].entries()) {
    assert.equal((await dispatch(f, 'om_legacy_help' + i, '小婕 gtd okr ' + body)).status, 'okr_unavailable');
  }
  assert.equal(f.calls, 0);
  assert.equal((await f.reminders.listItems()).length, 0);
});

test('插件接管三个明确入口，Review 不可用也结束宿主派发且权限范围不扩大', async t => {
  const { createPlugin } = await import('../openclaw/index.js');
  const f = fixture(t);
  let hook;
  const processed = [], hostReplies = [];
  createPlugin({ openRuntime: async () => f.capture }).register({ pluginConfig: { ...scope, enabled: true }, config: {},
    logger: { info() {}, warn() {} }, registerService() {}, registerGatewayMethod() {}, on(name, fn) { assert.equal(name, 'reply_dispatch'); hook = fn; } });
  const host = { recordProcessed(...args) { processed.push(args); }, markIdle() {},
    dispatcher: { getQueuedCounts() { return {}; }, sendFinalReply(input) { hostReplies.push(input); return true; } } };
  for (const [i, text] of ['小婕 gtd 买牛奶', '小婕 okr 讨论', '小婕 review 日复盘'].entries()) {
    const id = 'om_plugin_entry' + i;
    f.messages.set(id, message(id, text));
    assert.equal((await hook({ ctx: context(id, text), sendPolicy: 'allow' }, host)).handled, true);
  }
  assert.equal(processed.length, 3);
  assert.equal(hostReplies.length, 0);
  assert.equal((await hook({ ctx: { ...context('om_bad', '小婕 review 日复盘'), SenderId: 'ou_other' }, sendPolicy: 'allow' }, host)), undefined);
  assert.equal((await f.reminders.listItems()).length, 1);
});

test('未启用入口也受原文容量限制，超限准确提示且不建立后续关联', async t => {
  const f = fixture(t, { config: { maxInputChars: 40 } });
  const text = '小婕 review ' + '合成'.repeat(30);
  assert.equal((await dispatch(f, 'om_huge_entry', text)).status, 'input_too_large');
  assert.equal(f.sent.length, 1);
  assert.equal((await dispatch(f, 'om_huge_reply', '好的', 'om_huge_entry')).status, 'not_handled');
});

test('OKR 显式复合请求不部分启动流程，明确收集中的引用保留', async t => {
  const n = syntheticNotes();
  const f = fixture(t, { config: { okr: { account: 'iCloud', folder: 'Notes' } }, notesBridge: n.bridge });
  assert.equal((await dispatch(f, 'om_compound_open', '小婕 okr 讨论 然后查询当前目标')).status, 'okr_help');
  assert.equal(n.calls, 0);
  assert.equal((await dispatch(f, 'om_quoted_content', '小婕 gtd 收集：他说“先讨论然后查询当前目标”')).status, 'collected');
});

test('旧 OKR 记录指令尾部空白保留，重投不改变历史事件指纹', async t => {
  const n = syntheticNotes();
  const f = fixture(t, { config: { okr: { account: 'iCloud', folder: 'Notes' } }, notesBridge: n.bridge });
  await dispatch(f, 'om_space_open', '小婕 gtd okr 讨论');
  await dispatch(f, 'om_space_record', '小婕 gtd okr 记录：合成原文  ');
  assert.ok(n.notes[0].body.includes('合成原文  </div>'));
  await f.restart();
  assert.equal((await dispatch(f, 'om_space_record', '小婕 gtd okr 记录：合成原文  ')).status, 'okr_saved');
});

test('不可用回执恢复也采用当前权限，不向已移出白名单的会话续发', async t => {
  const config = {};
  const f = fixture(t, { config, loseReply: true });
  await dispatch(f, 'om_scope_recovery', '小婕 review 日复盘');
  config.allowedConversationIds = ['oc_other'];
  await f.restart();
  assert.equal((await f.capture.recover()).at(-1).status, 'forbidden');
  assert.equal(f.sent.length, 1);
});

test('OKR 模型一次改动多项时说明原因和下一步，保留原回答而不推进草案', async t => {
  const { sampleDraft } = await import('../examples/okr-sample.js');
  const n = syntheticNotes();
  let guideCalls = 0;
  const f = fixture(t, { config: { okr: { account: 'iCloud', folder: 'Notes' } }, notesBridge: n.bridge,
    okrGuide: async () => { guideCalls++; return { stage: 'direction', summary: '合成用户提出多项运动候选。',
      advice: '合成建议。', questions: ['合成问题？'], draft: sampleDraft }; } });
  await dispatch(f, 'om_multi_open', '小婕 okr 讨论');
  const text = '合成回答：减重、游泳、每周运动和饮食控制';
  const parent = f.sent.at(-1).message_id;
  const result = await dispatch(f, 'om_multi_answer', text, parent);
  assert.equal(result.status, 'okr_guidance_failed');
  assert.equal(result.guidanceFailure, 'MULTIPLE_OKR_ITEMS');
  assert.match(result.receipt, /模型.*多项/);
  assert.match(result.receipt, /只.*一项/);
  assert.match(result.receipt, /未.*草案/);
  assert.match(n.notes[0].body, /合成回答：减重、游泳、每周运动和饮食控制/);
  assert.doesNotMatch(n.notes[0].body, /## #O1/);
  await dispatch(f, 'om_multi_answer', text, parent);
  assert.equal(guideCalls, 1);
});

test('关联单项KR回答只因Markdown空行变化也能正常推进，真实多项修改仍拒绝', async t => {
  const before = '# 2026 第四季度（2026-10-01 至 2026-12-31）\n## #O1 合成学习目标\n基线：未知，先核实。';
  const n = syntheticNotes();
  let turn = 0;
  const f = fixture(t, { config: { okr: { account: 'iCloud', folder: 'Notes' } }, notesBridge: n.bridge,
    okrGuide: async () => ({ stage: ++turn === 1 ? 'direction' : 'okr', summary: '合成用户每周有两小时。',
      advice: '建议先完善当前一项。', questions: ['当前这一项的衡量标准是什么？'],
      draft: turn === 1 ? before : turn === 2 ? before + '\n\n### #KR1 独立完成合成练习\n验收标准：待确认。'
        : before.replace('合成学习目标', '另一合成学习目标') + '\n\n### #KR1 修改合成练习结果\n验收标准：待确认。' }) });
  await dispatch(f, 'om_layout_open', '小婕 okr 讨论');
  await dispatch(f, 'om_layout_o', '合成目标回答', f.sent.at(-1).message_id);
  const result = await dispatch(f, 'om_layout_kr', '我想完善当前目标的第一个KR', f.sent.at(-1).message_id);
  assert.equal(result.status, 'okr_guided');
  assert.match(result.receipt, /#KR1 独立完成合成练习/);
  assert.doesNotMatch(result.receipt, /模型本轮试图同时改动多项/);
  const rejected = await dispatch(f, 'om_layout_multi', '合成多项更改', f.sent.at(-1).message_id);
  assert.equal(rejected.guidanceFailure, 'MULTIPLE_OKR_ITEMS');
});

test('真实模型适配器的单项输出经可信飞书入口推进KR，原O不由模型重写', async t => {
  const { openGeminiAnalyzer } = await import('../src/gemini.js');
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-step-http-'));
  const before = '# 2026 第四季度（2026-10-01 至 2026-12-31）\n## #O1 合成学习目标\n原O文字必须保持。';
  let requests = 0;
  const model = openGeminiAnalyzer({ statePath: join(dir, 'usage.sqlite'), apiKey: async () => 'synthetic', config: { maxBudgetUsd: 1 },
    fetchImpl: async (_url, options) => {
      const input = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
      requests++;
      const value = input.workingDraft ? { stage: 'okr', summary: '合成目标已明确。', advice: '建议只完善一个KR。', questions: ['该结果如何验收？'],
        change: { operation: 'upsert', id: '#KR1', parentId: '#O1', text: '### #KR1 合成可验收结果\n标准：待确认。' } }
        : { stage: 'direction', summary: '合成目标已明确。', advice: '先确定O。', questions: ['当前O是否准确？'], draft: before };
      return new Response(JSON.stringify({ modelVersion: 'gemini-3.8-flash', usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 80 },
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }));
    } });
  t.after(async () => { await model.close(); rmSync(dir, { recursive: true, force: true }); });
  const n = syntheticNotes();
  const f = fixture(t, { config: { okr: { account: 'iCloud', folder: 'Notes' } }, notesBridge: n.bridge, okrGuide: model.discussOkr });
  await dispatch(f, 'om_http_step_open', '小婕 okr 讨论');
  await dispatch(f, 'om_http_step_o', '合成O回答', f.sent.at(-1).message_id);
  const parent = f.sent.at(-1).message_id;
  const result = await dispatch(f, 'om_http_step_kr', '我想完善当前目标的KR', parent);
  assert.equal(result.status, 'okr_guided');
  assert.match(result.receipt, /原O文字必须保持。\n### #KR1 合成可验收结果/);
  assert.equal((await dispatch(f, 'om_http_step_kr', '我想完善当前目标的KR', parent)).status, 'okr_guided');
  assert.equal(requests, 2);
});

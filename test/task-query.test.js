import test from 'node:test';
import { createPlugin } from '../openclaw/index.js';
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
    if(options.loseReply || options.failReplyFor === input.replyTo) throw new Error('response lost');return result;
  }};
  const make=()=>openFeishuCapture({stateDir:dir,config:{...scope,...options.config},reminders,feishu,notesBridge:options.notesBridge,okrGuide:options.okrGuide,
    analyze:async args=>{calls++;return simulatedAnalysis(args);},now:options.defaultClock ? undefined : ()=> '2026-09-27T02:00:00Z'});
  let capture=make();
  t.after(async()=>{await capture.close();reminders.close();rmSync(dir,{recursive:true,force:true});});
  return {get capture(){return capture;},reminders,messages,sent,get reads(){return reads;},get calls(){return calls;},
    async restart(){await capture.close();capture=make();}};
}


async function dispatch(f, id, text) {
  f.messages.set(id, message(id, text));
  return f.capture.handle(context(id, text));
}
test('查询默认Inbox未完成任务，返回真实引用且不写入或调用模型', async t => {
  const f = fixture(t);
  await f.reminders.createList('Inbox', 'seed-list');
  const list = (await f.reminders.listLists())[0];
  await f.reminders.createItem({ listId: list.id, title: '合成人工任务', notes: '私人备注不返回' }, 'seed-item');
  const result = await dispatch(f, 'om_query', '小婕 gtd 查询任务');
  assert.equal(result.status, 'tasks_found');
  assert.equal(result.scope.listId, list.id);
  assert.equal(result.items[0].title, '合成人工任务');
  assert.ok(result.items[0].id);
  assert.equal(result.readAt, '2026-09-27T02:00:00Z');
  assert.match(result.receipt, /未完成/);
  assert.match(result.receipt, /1\. 合成人工任务/);
  assert.match(result.receipt, /2026-09-27 10:00（北京时间）/);
  assert.doesNotMatch(result.receipt, /sourceId|listId|itemId|sim-item-|sim-list-|T02:00:00Z|每页/);
  assert.doesNotMatch(JSON.stringify(result), /私人备注不返回/);
  assert.equal((await f.reminders.listItems()).length, 1);
  assert.equal(f.calls, 0);
});

test('查询同义与分页返回当前事实，重投重启复用旧快照且新消息重新读取', async t => {
  const f = fixture(t, { config: { queryPageSize: 1 } });
  const list = await f.reminders.createList('Inbox', 'seed-list');
  const one = await f.reminders.createItem({ listId: list.id, title: '同名合成任务' }, 'seed-one');
  await f.reminders.createItem({ listId: list.id, title: '同名合成任务' }, 'seed-two');
  await f.reminders.createItem({ listId: list.id, title: '已完成不展示', completed: true }, 'seed-done');
  let reads = 0;
  const query = f.reminders.queryTasks;
  f.reminders.queryTasks = async (...args) => { reads++; return query(...args); };
  const first = await dispatch(f, 'om_page1', '小婕 gtd 请帮我看看未完成任务');
  assert.equal(first.status, 'tasks_found');
  assert.equal(first.total, 2);
  assert.equal(first.items.length, 1);
  assert.equal(first.hasMore, true);
  const second = await dispatch(f, 'om_page2', '小婕 GTD 查看任务 第 2 页');
  assert.notEqual(second.items[0].id, first.items[0].id);
  assert.equal(second.hasMore, false);
  assert.equal((await dispatch(f, 'om_page3', '小婕 gtd 查询任务 第3页')).status, 'tasks_page_empty');
  await f.reminders.createItem({ listId: list.id, title: '新任务' }, 'seed-new');
  await f.restart();
  assert.equal((await dispatch(f, 'om_page1', '小婕 gtd 请帮我看看未完成任务')).total, 2);
  assert.equal(reads, 3);
  assert.equal(f.sent.length, 3);
  for (const [i, body] of ['查一下事项', '列出来待办', '找一下Inbox', '有哪些任务', '任务有哪些', '看看任务？', '看一下未完成事项'].entries()) {
    assert.equal((await dispatch(f, 'om_syn' + i, '小婕 gtd ' + body)).total, 3);
  }
  assert.ok(one.id);
  assert.equal(f.calls, 0);
});

test('查询缺配置同名候选、空结果、权限与读取异常分别表达', async t => {
  const f = fixture(t);
  const a = await f.reminders.createList('Inbox', 'a');
  const b = await f.reminders.createList('Inbox', 'b');
  const missing = await dispatch(f, 'om_missing', '小婕 gtd 查询任务');
  assert.equal(missing.status, 'query_needs_list');
  assert.deepEqual(missing.candidates.map(v => v.id), [a.id, b.id]);
  f.reminders.queryTasks = async () => ({ state: 'ok', list: { id: a.id, sourceId: 'sim-source', name: 'Inbox' }, items: [], total: 0, hasMore: false });
  assert.equal((await dispatch(f, 'om_empty', '小婕 gtd 查询任务')).status, 'tasks_empty');
  for (const [i, error] of [Object.assign(new Error('denied'), { reason: 'PERMISSION_DENIED' }), new Error('私人异常正文')].entries()) {
    f.reminders.queryTasks = async () => { throw error; };
    const result = await dispatch(f, 'om_error' + i, '小婕 gtd 查询任务');
    assert.equal(result.status, i === 0 ? 'query_forbidden' : 'query_failed');
    assert.doesNotMatch(JSON.stringify(result), /私人异常正文/);
  }
  assert.equal((await f.reminders.listItems()).length, 0);
  assert.equal(f.calls, 0);
});

test('查询超时有界，未知回执恢复不重读，拒绝额外筛选复合和非法页码', async t => {
  const f = fixture(t, { config: { queryTimeoutMs: 10 }, loseReply: true });
  let reads = 0;
  f.reminders.queryTasks = async () => { reads++; return new Promise(() => {}); };
  const text = '小婕 gtd 查询任务';
  const timed = await dispatch(f, 'om_timeout_query', text);
  assert.equal(timed.code, 'QUERY_TIMEOUT');
  assert.equal(timed.delivery, 'pending');
  await f.restart();
  await dispatch(f, 'om_timeout_query', text);
  await f.capture.recover();
  assert.equal(reads, 1);
  assert.equal(f.sent.length, 1);
  for (const [i, body] of ['查询任务 第0页', '查询任务 第101页', '查询任务 第99999999999999999999页'].entries()) {
    assert.equal((await dispatch(f, 'om_pagebad' + i, '小婕 gtd ' + body)).code, 'INVALID_PAGE');
  }
  for (const [i, body] of ['不要查询任务', '“查询任务”', '查询今天任务', '查询任务然后收集牛奶', '查询任务并完成任务', '查询任务 第-1页'].entries()) {
    const r = await dispatch(f, 'om_guardquery' + i, '小婕 gtd ' + body);
    assert.ok(['needs_instruction', 'gtd_unsupported'].includes(r.status));
  }
  assert.equal(reads, 1);
  assert.equal(f.calls, 0);
  assert.equal((await f.reminders.listItems()).length, 0);
  for (const bad of [{ queryPageSize: 0 }, { queryPageSize: 51 }, { queryTimeoutMs: 20001 }]) {
    assert.throws(() => validateFeishuScope({ ...scope, ...bad }), /query/);
  }
});

test('新增查询别名带额外参数不误收集，未经可信核验不读取', async t => {
  const f = fixture(t);
  let reads = 0;
  f.reminders.queryTasks = async () => { reads++; throw new Error('unexpected read'); };
  for (const [i, body] of ['任务有哪些 今天', '任务有哪些然后收集牛奶', '有哪些待办下周'].entries()) {
    const result = await dispatch(f, 'om_aliasguard' + i, '小婕 gtd ' + body);
    assert.ok(['gtd_unsupported', 'needs_instruction'].includes(result.status));
  }
  const text = '小婕 gtd 查询任务';
  f.messages.set('om_badquery', message('om_badquery', text, { sender: { id: 'ou_other', id_type: 'open_id', sender_type: 'user' } }));
  assert.equal((await f.capture.handle(context('om_badquery', text))).status, 'invalid_source');
  assert.equal((await f.capture.handle({ ...context('om_badquery', text), SenderId: 'ou_other' })).status, 'not_handled');
  assert.equal(reads, 0);
  assert.equal((await f.reminders.listItems()).length, 0);
  assert.equal(f.calls, 0);
});

test('礼貌前缀下的否定查询与别名额外筛选均保持只读保护', async t => {
  const f = fixture(t);
  for (const [i, body] of ['请帮我不要查询任务', '帮我别查询任务', '请帮我任务有哪些 今天'].entries()) {
    const r = await dispatch(f, 'om_politeguard' + i, '小婕 gtd ' + body);
    assert.ok(['needs_instruction', 'gtd_unsupported'].includes(r.status), body);
  }
  assert.equal((await f.reminders.listItems()).length, 0);
  assert.equal(f.calls, 0);
});

test('指定列表只读查询另一列表，默认查询和新收集保留原绑定', async t => {
  const f = fixture(t, { config: { queryPageSize: 1 } });
  const work = await f.reminders.createList('工作', 'list-work');
  await f.reminders.createItem({ listId: work.id, title: '合成工作一' }, 'work-1');
  await f.reminders.createItem({ listId: work.id, title: '合成工作二' }, 'work-2');
  await f.reminders.createItem({ listId: work.id, title: '完成工作', completed: true }, 'work-done');
  const inbox = await f.reminders.createList('Inbox', 'list-inbox');
  await f.reminders.createItem({ listId: inbox.id, title: '合成默认事项' }, 'inbox-1');
  const r = await dispatch(f, 'om_work', '小婕 gtd 查询工作列表的任务');
  assert.equal(r.status, 'tasks_found');
  assert.equal(r.scope.listId, work.id);
  assert.equal(r.total, 2);
  assert.match(r.receipt, /查询「工作」列表的任务 第 2 页/);
  await f.restart();
  assert.deepEqual(await dispatch(f, 'om_work', '小婕 gtd 查询工作列表的任务'), r);
  const next = await dispatch(f, 'om_work2', '小婕 gtd 查询「工作」列表的任务 第 2 页');
  assert.equal(next.scope.listId, work.id);
  assert.notEqual(next.items[0].id, r.items[0].id);
  assert.equal((await dispatch(f, 'om_default_after_work', '小婕 gtd 查询任务')).scope.listId, inbox.id);
  assert.equal(f.calls, 0);
  await dispatch(f, 'om_collect_after_work', '小婕 gtd 收集：合成默认新事项');
  assert.equal((await f.reminders.listItems()).at(-1).listId, inbox.id);
});

test('指定列表缺失、同名与未绑定分别说明，不创建列表或改变默认位置', async t => {
  const f = fixture(t);
  const empty = await f.reminders.createList('工作', 'empty-work');
  assert.equal((await dispatch(f, 'om_empty_work', '小婕 gtd 查看工作列表的任务')).status, 'tasks_empty');
  assert.equal((await dispatch(f, 'om_default_unbound', '小婕 gtd 查询任务')).status, 'query_needs_list');
  const missing = await dispatch(f, 'om_missing_work', '小婕 gtd 查询不存在列表的任务');
  assert.equal(missing.status, 'query_list_not_found');
  assert.match(missing.receipt, /没有找到「不存在」/);
  await f.reminders.createList('工作', 'duplicate-work');
  const duplicate = await dispatch(f, 'om_dup_work', '小婕 gtd 查一下工作列表的任务');
  assert.equal(duplicate.status, 'query_needs_list');
  assert.equal(duplicate.candidates.length, 2);
  assert.ok(duplicate.candidates.some(c => c.id === empty.id));
  assert.match(duplicate.receipt, /多个/);
  assert.doesNotMatch(duplicate.receipt, /listId|sim-list/);
  assert.equal((await f.reminders.listLists()).length, 2);
  assert.equal((await f.reminders.listItems()).length, 0);
  assert.equal(f.calls, 0);
});

test('指定列表同义、引号与大小写可用，全部列表和附加筛选不误收集', async t => {
  const f = fixture(t);
  await f.reminders.createList('Work', 'english-work');
  const special = await f.reminders.createList('研发，A 列表', 'special-work');
  for (const [i, text] of ['查询Work列表的任务', '请帮我查看work列表里的未完成事项', '查询列表 Work 的任务',
    '看看「Work」里的任务', '查一下“Work”中的待办', '查询"Work"列表的任务'].entries()) {
    assert.equal((await dispatch(f, 'om_name' + i, '小婕 gtd ' + text)).status, 'tasks_empty', text);
  }
  assert.equal((await dispatch(f, 'om_special_name', '小婕 gtd 查询「研发，A 列表」列表的任务')).scope.listId, special.id);
  for (const [i, text] of ['查询所有列表的任务', '查询全部列表的任务', '不要查询Work列表的任务', '“查询Work列表的任务”',
    '查询Work列表的任务并收集牛奶', '查询Work列表今天到期的任务', '查询关于金山的任务', '查询「Work」列表的任务 第0页'].entries()) {
    const r = await dispatch(f, 'om_name_guard' + i, '小婕 gtd ' + text);
    assert.ok(['gtd_unsupported', 'needs_instruction', 'query_failed'].includes(r.status), text);
  }
  assert.equal(f.calls, 0);
  assert.equal((await f.reminders.listItems()).length, 0);
});

test('指定列表读取跨账户响应被拒绝，长名称不传入读取边界', async t => {
  const f = fixture(t, { config: { sourceId: 'authorized-source' } });
  let reads = 0;
  f.reminders.queryTasks = async () => { reads++; return { state: 'ok', list: { id: 'other', sourceId: 'foreign-source', name: '工作' },
    items: [], total: 0, hasMore: false }; };
  assert.equal((await dispatch(f, 'om_foreign_list', '小婕 gtd 查询工作列表的任务')).status, 'query_failed');
  assert.equal((await dispatch(f, 'om_long_list', '小婕 gtd 查询' + '名'.repeat(201) + '列表的任务')).status, 'gtd_unsupported');
  assert.equal(reads, 1);
  assert.equal(f.calls, 0);
});

test('含引号符号的列表下一页命令仍能查询同一真实列表', async t => {
  const f = fixture(t, { config: { queryPageSize: 1 } });
  const list = await f.reminders.createList('A」B', 'quoted-symbol-list');
  await f.reminders.createItem({ listId: list.id, title: '合成一' }, 'quoted-symbol-one');
  await f.reminders.createItem({ listId: list.id, title: '合成二' }, 'quoted-symbol-two');
  const first = await dispatch(f, 'om_quote_page1', '小婕 gtd 查询"A」B"列表的任务');
  assert.equal(first.status, 'tasks_found');
  const command = first.receipt.split('还有更多，发送：')[1];
  const second = await dispatch(f, 'om_quote_page2', command);
  assert.equal(second.status, 'tasks_found');
  assert.equal(second.scope.listId, list.id);
  assert.notEqual(first.items[0].id, second.items[0].id);
});

test('自然表达查询 waiting 里面的任务，无引号且默认绑定不变', async t => {
  const f = fixture(t);
  const inbox = await f.reminders.createList('Inbox', 'natural-inbox');
  const waiting = await f.reminders.createList('waiting', 'natural-waiting');
  await f.reminders.createItem({listId:waiting.id,title:'等待合成任务'},'natural-item');
  await f.reminders.createItem({listId:inbox.id,title:'默认合成任务'},'natural-default');
  for (const [i, text] of ['查询 waiting 里面的任务','查看waiting里的未完成任务','看看 waiting 中的待办','查询waiting列表里面的任务'].entries()) {
    const r = await dispatch(f,'om_natural_'+i,'小婕 gtd '+text);
    assert.equal(r.status,'tasks_found',text);
    assert.equal(r.scope.listId,waiting.id);
    assert.equal(r.items[0].title,'等待合成任务');
  }
  assert.equal((await dispatch(f,'om_natural_default','小婕 gtd 查询任务')).scope.listId,inbox.id);
  assert.equal((await f.reminders.listItems()).length,2);
  assert.equal(f.calls,0);
});

test('可信回复查询回执按编号定位人工任务，完成移动能力缺失准确回执', async t => {
  const f = fixture(t);
  const list = await f.reminders.createList('Waiting','select-waiting');
  for (let i=0;i<5;i++) await f.reminders.createItem({listId:list.id,title:'合成等待事项'},'select-item-'+i);
  const query = await dispatch(f,'om_select_query','小婕 gtd 查询Waiting里面的任务');
  const replyId=f.sent.at(-1).message_id;
  const text='帮我确认第 1,2项都完成，第 5 项移动到 next 清单';
  f.messages.set('om_select_reply',message('om_select_reply',text,{parent_id:replyId}));
  const r=await f.capture.handle({...context('om_select_reply',text),ReplyToId:replyId});
  assert.equal(r.status,'task_selection_unavailable');
  assert.deepEqual(r.selected.map(x=>[x.number,x.id,x.action,x.targetListName]),[
    [1,query.items[0].id,'complete',undefined],[2,query.items[1].id,'complete',undefined],[5,query.items[4].id,'move','next']]);
  assert.match(r.receipt,/完成.*移动.*尚未实现/s);
  assert.match(r.receipt,/未执行/);
  assert.doesNotMatch(r.receipt,/sim-item-|sim-list-|确认后|无.*权限/);
  assert.equal((await f.reminders.listItems()).length,5);
  assert.equal(f.calls,0);
});

async function replySelection(f,id,text,replyId,extra={},ctxExtra={}) {
  f.messages.set(id,message(id,text,{parent_id:replyId,...extra}));
  return f.capture.handle({...context(id,text),ReplyToId:replyId,...ctxExtra});
}
test('翻页编号定位原回执，重启重投不重读，新查询不覆盖原范围', async t => {
  const f=fixture(t,{config:{queryPageSize:2}});
  const list=await f.reminders.createList('Inbox','page-select');
  for(let i=0;i<5;i++)await f.reminders.createItem({listId:list.id,title:'合成同名事项'},'page-select-'+i);
  const page=await dispatch(f,'om_select_page','小婕 gtd 查询任务 第2页'); const replyId=f.sent.at(-1).message_id;
  await dispatch(f,'om_select_new','小婕 gtd 查询任务');
  await f.restart();
  const r=await replySelection(f,'om_select_page_reply','选择第3项',replyId);
  assert.equal(r.status,'tasks_selected'); assert.equal(r.selected[0].id,page.items[0].id);assert.equal(r.selected[0].number,3);
  await f.reminders.setReminder(page.items[0].id,{notes:'外部合成编辑'},'page-edit');
  await f.restart();
  assert.deepEqual(await replySelection(f,'om_select_page_reply','选择第3项',replyId),r);
  assert.equal((await replySelection(f,'om_select_page_conflict','选择第3项',replyId)).status,'task_selection_conflict');
  assert.equal((await replySelection(f,'om_select_page_wrong','选择第1项',replyId)).status,'task_selection_needs_query');
  assert.equal(f.calls,0);assert.equal((await f.reminders.listItems()).length,5);
});
test('编号选择只接受机器人查询回执，不能沿用选择回执或用户原查询', async t=>{
  const f=fixture(t);const list=await f.reminders.createList('Inbox','reply-scope');
  await f.reminders.createItem({listId:list.id,title:'合成范围事项'},'scope-item');
  await dispatch(f,'om_scope_query','小婕 gtd 查询任务'); const queryReply=f.sent.at(-1).message_id;
  assert.equal((await replySelection(f,'om_scope_select','选择第1项',queryReply)).status,'tasks_selected');
  const selectReply=f.sent.at(-1).message_id;
  assert.equal((await replySelection(f,'om_scope_nested','选择第1项',selectReply)).status,'task_selection_needs_query');
  assert.equal((await replySelection(f,'om_scope_source','选择第1项','om_scope_query')).status,'task_selection_needs_query');
  assert.equal((await replySelection(f,'om_scope_unknown','选择第1项','om_no_query')).status,'task_selection_needs_query');
  const next=await replySelection(f,'om_scope_requery','小婕 gtd 查询任务',queryReply);
  assert.equal(next.status,'tasks_found');
  assert.equal(f.calls,0);assert.equal((await f.reminders.listItems()).length,1);
});

test('编号回复核验原消息身份和API引用，拒绝其他用户会话及错误上下文', async t=>{
  const f=fixture(t,{config:{allowedSenderIds:['ou_test','ou_other'],allowedConversationIds:['oc_test','oc_other']}});
  const list=await f.reminders.createList('Inbox','identity-list');await f.reminders.createItem({listId:list.id,title:'合成范围私密标题'},'identity-item');
  await dispatch(f,'om_identity_query','小婕 gtd 查询任务');const replyId=f.sent.at(-1).message_id;
  const other=await replySelection(f,'om_identity_other','选择第1项',replyId,{sender:{id:'ou_other',id_type:'open_id',sender_type:'user'}},{SenderId:'ou_other'});
  assert.equal(other.status,'task_selection_forbidden');assert.doesNotMatch(other.receipt,/合成范围私密标题/);
  const chat=await replySelection(f,'om_identity_chat','选择第1项',replyId,{chat_id:'oc_other'},{NativeChannelId:'oc_other'});
  assert.equal(chat.status,'task_selection_forbidden');
  assert.equal((await replySelection(f,'om_identity_spoof','选择第1项',replyId,{parent_id:undefined})).status,'task_selection_needs_query');
  assert.equal((await replySelection(f,'om_identity_unverified','选择第1项',replyId,{sender:{id:'ou_fake',id_type:'open_id',sender_type:'user'}})).status,'invalid_source');
  assert.equal((await replySelection(f,'om_identity_prefix','小婕 gtd 选择第1项',replyId)).status,'tasks_selected');
  assert.equal(f.calls,0);assert.equal((await f.reminders.listItems()).length,1);
});
test('编号选择拒绝否定、引用、重复编号、越界和额外动作，旧无基线要求重新查询', async t=>{
  const f=fixture(t);const list=await f.reminders.createList('Inbox','syntax-list');await f.reminders.createItem({listId:list.id,title:'合成语法事项'},'syntax-item');
  await dispatch(f,'om_syntax_query','小婕 gtd 查询任务');const replyId=f.sent.at(-1).message_id;
  for(const [i,text] of ['不要完成第1项','“选择第1项”','完成第1项并收集牛奶','第1项完成，第1项移动到Next清单','选择第0项','选择第1项，删除第2项','选择第1项，'].entries()){
    const r=await replySelection(f,'om_syntax_'+i,text,replyId);
    assert.ok(['task_selection_invalid','task_selection_needs_query'].includes(r.status),text);
  }
  assert.equal((await replySelection(f,'om_syntax_outside','选择第2项',replyId)).status,'task_selection_needs_query');
  const query=f.reminders.queryTasks.bind(f.reminders);
  f.reminders.queryTasks=async (...args)=>{const r=await query(...args);r.items=r.items.map(({revision,...item})=>item);return r;};
  await dispatch(f,'om_syntax_legacy','小婕 gtd 查询任务');const old=f.sent.at(-1).message_id;
  assert.equal((await replySelection(f,'om_syntax_old','选择第1项',old)).status,'task_selection_needs_query');
  assert.equal(f.calls,0);assert.equal((await f.reminders.listItems()).length,1);
});
test('编号定位当前核对失败、无权限和超时不冒充成功，选中跨账户响应被拒绝', async t=>{
  const f=fixture(t,{config:{queryTimeoutMs:10}});const list=await f.reminders.createList('Inbox','read-failure-list');await f.reminders.createItem({listId:list.id,title:'合成读取事项'},'read-failure-item');
  await dispatch(f,'om_read_query','小婕 gtd 查询任务');const replyId=f.sent.at(-1).message_id;
  const read=f.reminders.readTasks.bind(f.reminders);
  f.reminders.readTasks=async()=>{throw Object.assign(new Error('denied'),{reason:'PERMISSION_DENIED'});};
  assert.equal((await replySelection(f,'om_read_denied','选择第1项',replyId)).code,'PERMISSION_DENIED');
  f.reminders.readTasks=async()=>{throw new Error('unavailable');};
  assert.equal((await replySelection(f,'om_read_fail','选择第1项',replyId)).code,'READ_FAILED');
  f.reminders.readTasks=async()=>new Promise(()=>{});
  assert.equal((await replySelection(f,'om_read_timeout','选择第1项',replyId)).code,'QUERY_TIMEOUT');
  f.reminders.readTasks=async(...args)=>{const r=await read(...args);r.items[0].value.sourceId='foreign';return r;};
  assert.equal((await replySelection(f,'om_read_foreign','选择第1项',replyId)).code,'READ_FAILED');
  f.reminders.readTasks=async()=>({items:[{id:'another',state:'unavailable'}]});
  assert.equal((await replySelection(f,'om_read_wrongid','选择第1项',replyId)).code,'READ_FAILED');
  const itemId=(await f.reminders.listItems())[0].id;
  f.reminders.readTasks=async()=>({items:[{id:itemId,state:'unavailable'}]});
  assert.equal((await replySelection(f,'om_read_missing','选择第1项',replyId)).status,'task_selection_conflict');
  assert.equal(f.calls,0);assert.equal((await f.reminders.listItems()).length,1);
});

test('回复查询回执仍可显式重新收集，编号文字不拦截明确收集正文', async t=>{
  const f=fixture(t);const list=await f.reminders.createList('Inbox','explicit-collect');await f.reminders.createItem({listId:list.id,title:'原合成事项'},'explicit-original');
  await dispatch(f,'om_collect_query','小婕 gtd 查询任务');const replyId=f.sent.at(-1).message_id;
  assert.equal((await replySelection(f,'om_collect_reply','小婕 gtd 收集：明天检查第1项文档',replyId)).status,'collected');
  assert.equal((await f.reminders.listItems()).length,2);
});

test('缺回执关联的编号指令由PGTD提示重新查询，不落普通助手或默认收集', async t=>{
  const f=fixture(t);
  assert.equal((await dispatch(f,'om_without_reply','选择第1项')).status,'task_selection_needs_query');
  assert.equal((await dispatch(f,'om_without_reply2','小婕 gtd 完成第1项')).status,'task_selection_needs_query');
  assert.equal((await f.reminders.listItems()).length,0);assert.equal(f.calls,0);
});

test('真实插件公开hook接管无前缀编号回复，准确缺能力回执而无宿主最终回答', async t=>{
  const f=fixture(t);const list=await f.reminders.createList('Inbox','hook-list');await f.reminders.createItem({listId:list.id,title:'合成hook事项'},'hook-item');
  await dispatch(f,'om_hook_query','小婕 gtd 查询任务');const replyId=f.sent.at(-1).message_id;
  const text='第1项移动到Next清单';f.messages.set('om_hook_select',message('om_hook_select',text,{parent_id:replyId}));
  let hook;const hostReplies=[],processed=[];
  createPlugin({openRuntime:async()=>f.capture}).register({pluginConfig:{...scope,enabled:true},config:{},registerService(){},logger:{info(){},warn(){}},on(name,fn){assert.equal(name,'reply_dispatch');hook=fn;}});
  const result=await hook({ctx:{...context('om_hook_select',text),ReplyToId:replyId},sendPolicy:'allow'}, {
    recordProcessed(...args){processed.push(args);},markIdle(){},dispatcher:{getQueuedCounts(){return{};},sendFinalReply(reply){hostReplies.push(reply);return true;}}});
  assert.equal(result.handled,true);assert.equal(result.queuedFinal,false);
  assert.equal(hostReplies.length,0);assert.match(processed[0][1].reason,/task_selection_unavailable/);
  assert.match(f.sent.at(-1).text,/尚未实现.*未执行/s);assert.equal(f.calls,0);
});
test('定位结果回执发送未知后恢复不重读，预算限制超10项不读取或写入', async t=>{
  const f=fixture(t,{failReplyFor:'om_recover_select'});const list=await f.reminders.createList('Inbox','recover-select-list');
  for(let i=0;i<11;i++)await f.reminders.createItem({listId:list.id,title:'合成恢复任务'+i},'recover-item'+i);
  await dispatch(f,'om_recover_query','小婕 gtd 查询任务');const replyId=f.sent.at(-1).message_id;
  const read=f.reminders.readTasks.bind(f.reminders);let reads=0;
  f.reminders.readTasks=async(...args)=>{reads++;return read(...args);};
  const originalReplyCount=f.sent.length;
  // External reply boundary loses its response only for the selection event.
  f.messages.set('om_recover_select',message('om_recover_select','选择第1项',{parent_id:replyId}));
  const r=await f.capture.handle({...context('om_recover_select','选择第1项'),ReplyToId:replyId});
  assert.equal(r.status,'tasks_selected');assert.equal(r.delivery,'pending');assert.equal(reads,1);
  await f.restart();await f.capture.recover();assert.equal(reads,1);assert.equal(f.sent.length,originalReplyCount+1);
  const tooMany='选择第1,2,3,4,5,6,7,8,9,10,11项';
  assert.equal((await replySelection(f,'om_select_toomany',tooMany,replyId)).status,'task_selection_invalid');assert.equal(reads,1);
  const ten=await replySelection(f,'om_select_ten','选择第1,2,3,4,5,6,7,8,9,10项',replyId);
  assert.equal(ten.selected.length,10);assert.equal(reads,2);assert.equal((await f.reminders.listItems()).length,11);assert.equal(f.calls,0);
});

test('查询后人工完成或移动原事项不能沿用旧编号基线', async t=>{
  const f=fixture(t);const list=await f.reminders.createList('Inbox','changed-list');
  const other=await f.reminders.createList('Next','changed-target');
  const item=await f.reminders.createItem({listId:list.id,title:'合成外部状态事项'},'changed-item');
  await dispatch(f,'om_changed_query','小婕 gtd 查询任务');const replyId=f.sent.at(-1).message_id;
  await f.reminders.setReminder(item.id,{completed:true},'external-complete');
  assert.equal((await replySelection(f,'om_changed_complete','选择第1项',replyId)).status,'task_selection_conflict');
  await f.reminders.setReminder(item.id,{completed:false,listId:other.id},'external-move');
  assert.equal((await replySelection(f,'om_changed_move','选择第1项',replyId)).status,'task_selection_conflict');
  const current=await f.reminders.getItem(item.id);assert.equal(current.listId,other.id);assert.equal(current.completed,false);
  assert.equal((await f.reminders.listItems()).length,1);assert.equal(f.calls,0);
});

test('同消息ID改换引用目标不能借原查询根ID复用定位成功', async t=>{
  const f=fixture(t);const list=await f.reminders.createList('Inbox','parent-change-list');await f.reminders.createItem({listId:list.id,title:'合成引用事项'},'parent-change-item');
  await dispatch(f,'om_parent_query','小婕 gtd 查询任务');const replyId=f.sent.at(-1).message_id;
  assert.equal((await replySelection(f,'om_parent_select','选择第1项',replyId)).status,'tasks_selected');
  assert.equal((await replySelection(f,'om_parent_select','选择第1项','om_parent_query')).status,'event_conflict');
  assert.equal((await f.reminders.listItems()).length,1);assert.equal(f.calls,0);
});

test('可信单项完成原人工事项并读回，字段与绑定不变，重投不重复写入',async t=>{
  const f=fixture(t);const inbox=await f.reminders.createList('Inbox','complete-inbox');const waiting=await f.reminders.createList('Waiting','complete-waiting');
  const item=await f.reminders.createItem({listId:waiting.id,title:'合成完成任务',notes:'保留原备注'},'complete-item');
  await f.reminders.setReminder(item.id,{remindAt:'2026-10-04T02:00:00Z'},'seed-alarm');
  await f.reminders.createItem({listId:inbox.id,title:'默认事项'},'default-complete');
  await dispatch(f,'om_complete_query','小婕 gtd 查询Waiting里面的任务');const receipt=f.sent.at(-1).message_id;
  const result=await replySelection(f,'om_complete_one','第1项完成',receipt);
  assert.equal(result.status,'task_completed');assert.equal(result.item.id,item.id);
  assert.equal(result.item.completed,true);assert.match(result.receipt,/已完成/);
  const actual=await f.reminders.getItem(item.id);assert.equal(actual.completed,true);assert.equal(actual.notes,'保留原备注');assert.equal(actual.remindAt,'2026-10-04T02:00:00Z');assert.equal(actual.listId,waiting.id);
  await f.restart();assert.deepEqual(await replySelection(f,'om_complete_one','第1项完成',receipt),result);
  assert.equal((await replySelection(f,'om_complete_again','第1项完成',receipt)).status,'task_already_completed');
  assert.equal((await dispatch(f,'om_complete_default','小婕 gtd 查询任务')).scope.listId,inbox.id);
  assert.equal(f.calls,0);assert.equal((await f.reminders.listItems()).length,2);
});

test('完成写入响应丢失已读回则成功，核对失败重启后只读恢复不重复完成',async t=>{
  const f=fixture(t);const list=await f.reminders.createList('Inbox','unknown-complete-list');const item=await f.reminders.createItem({listId:list.id,title:'合成未知完成'},'unknown-complete-item');
  await dispatch(f,'om_unknown_query','小婕 gtd 查询任务');const receipt=f.sent.at(-1).message_id;
  const complete=f.reminders.completeTask.bind(f.reminders),read=f.reminders.readTasks.bind(f.reminders);let writes=0,failRead=false;
  f.reminders.completeTask=async(...args)=>{writes++;await complete(...args);failRead=true;throw new Error('Lost response');};
  f.reminders.readTasks=async(...args)=>{if(failRead)throw new Error('Read unavailable');return read(...args);};
  const first=await replySelection(f,'om_unknown_complete','第1项完成',receipt);assert.equal(first.status,'task_completion_unknown');assert.equal(writes,1);
  await f.restart();assert.equal((await replySelection(f,'om_unknown_complete','第1项完成',receipt)).status,'task_completion_unknown');assert.equal(writes,1);
  failRead=false;const recovered=await f.capture.recover();assert.ok(recovered.some(r=>r.status==='task_completed'));assert.equal(writes,1);
  assert.equal((await f.reminders.getItem(item.id)).completed,true);
  const replay=await replySelection(f,'om_unknown_complete','第1项完成',receipt);assert.equal(replay.status,'task_completed');assert.equal(writes,1);
});
test('未能证明完成的未知写入只核对，权限明确拒绝和外部冲突不写入',async t=>{
  const f=fixture(t);const list=await f.reminders.createList('Inbox','failed-complete-list');const item=await f.reminders.createItem({listId:list.id,title:'合成拒绝完成'},'failed-complete-item');
  await dispatch(f,'om_failed_query','小婕 gtd 查询任务');const receipt=f.sent.at(-1).message_id;
  let writes=0;f.reminders.completeTask=async()=>{writes++;throw new Error('Timeout before or after write unknown');};
  assert.equal((await replySelection(f,'om_failed_unknown','第1项完成',receipt)).status,'task_completion_unknown');
  await f.restart();await f.capture.recover();await replySelection(f,'om_failed_unknown','第1项完成',receipt);assert.equal(writes,1);
  const second=await f.reminders.createItem({listId:list.id,title:'合成权限拒绝'},'denied-second-item');
  const fresh=await dispatch(f,'om_denied_fresh_query','小婕 gtd 查询任务');const freshReceipt=f.sent.at(-1).message_id;
  const completeText='第'+(fresh.items.findIndex(i=>i.id===second.id)+1)+'项完成';
  f.reminders.completeTask=async()=>{writes++;throw Object.assign(new Error('Denied'),{code:'WRITE_REJECTED',reason:'PERMISSION_DENIED'});};
  const denied=await replySelection(f,'om_failed_denied',completeText,freshReceipt);assert.equal(denied.status,'task_completion_failed');assert.equal(denied.code,'PERMISSION_DENIED');assert.equal(writes,2);
  await f.reminders.setReminder(second.id,{notes:'外部编辑'},'external-complete-edit');
  assert.equal((await replySelection(f,'om_failed_conflict',completeText,freshReceipt)).status,'task_completion_conflict');assert.equal(writes,2);
  assert.equal(Boolean((await f.reminders.getItem(item.id)).completed),false);
});
test('多个完成及完成移动混合请求不部分执行，完成成功但回执未知不重写',async t=>{
  const f=fixture(t,{failReplyFor:'om_receipt_complete'});const list=await f.reminders.createList('Inbox','mixed-complete-list');
  for(let i=0;i<2;i++)await f.reminders.createItem({listId:list.id,title:'合成批量完成'+i},'mixed-complete'+i);
  await dispatch(f,'om_mixed_complete_query','小婕 gtd 查询任务');const receipt=f.sent.at(-1).message_id;
  const complete=f.reminders.completeTask.bind(f.reminders);let writes=0;f.reminders.completeTask=async(...args)=>{writes++;return complete(...args);};
  for(const [i,text]of['第1,2项完成','第1项完成，第2项移动到Next清单'].entries())assert.equal((await replySelection(f,'om_mixed_none'+i,text,receipt)).status,'task_selection_unavailable');
  assert.equal(writes,0);
  const result=await replySelection(f,'om_receipt_complete','完成第1项',receipt);assert.equal(result.status,'task_completed');assert.equal(result.delivery,'pending');assert.equal(writes,1);
  await f.restart();await f.capture.recover();assert.equal(writes,1);assert.equal((await f.reminders.listItems()).filter(i=>i.completed).length,1);assert.equal(f.calls,0);
});

test('完成结果未知恢复期间撤回用户授权，不能继续读取或写入',async t=>{
  const options={config:{allowedSenderIds:['ou_test']}};const f=fixture(t,options);const list=await f.reminders.createList('Inbox','revoke-complete-list');await f.reminders.createItem({listId:list.id,title:'合成撤权事项'},'revoke-complete-item');
  await dispatch(f,'om_revoke_query','小婕 gtd 查询任务');const receipt=f.sent.at(-1).message_id;
  let writes=0,reads=0;const read=f.reminders.readTasks.bind(f.reminders);f.reminders.readTasks=async(...a)=>{reads++;return read(...a);};f.reminders.completeTask=async()=>{writes++;throw new Error('Unknown');};
  assert.equal((await replySelection(f,'om_revoke_complete','第1项完成',receipt)).status,'task_completion_unknown');const prior=reads;
  options.config.allowedSenderIds=['ou_other'];await f.restart();await f.capture.recover();assert.equal(reads,prior);assert.equal(writes,1);
  assert.equal((await replySelection(f,'om_revoke_complete','第1项完成',receipt)).status,'not_handled');
});

test('同一事项有未知完成操作时，换新消息不能绕过核对重写',async t=>{
  const f=fixture(t);const list=await f.reminders.createList('Inbox','pending-item-list');await f.reminders.createItem({listId:list.id,title:'合成待核对完成'},'pending-item');
  await dispatch(f,'om_pending_query','小婕 gtd 查询任务');const receipt=f.sent.at(-1).message_id;
  let writes=0;f.reminders.completeTask=async()=>{writes++;throw new Error('Unknown write');};
  assert.equal((await replySelection(f,'om_pending_one','第1项完成',receipt)).status,'task_completion_unknown');
  assert.equal((await replySelection(f,'om_pending_two','第1项完成',receipt)).status,'task_completion_unknown');assert.equal(writes,1);
});

test('带激活前缀但未支持的完成措辞不被默认收集',async t=>{
  const f=fixture(t);const list=await f.reminders.createList('Inbox','unsupported-complete-list');await f.reminders.createItem({listId:list.id,title:'合成措辞任务'},'unsupported-complete-item');
  await dispatch(f,'om_unsupported_query','小婕 gtd 查询任务');const receipt=f.sent.at(-1).message_id;
  for(const [i,text]of['小婕 gtd 把第1项标记完成','小婕 gtd 将第1项移动到Next清单'].entries()){
    const result=await replySelection(f,'om_unsupported_text'+i,text,receipt);assert.equal(result.status,'task_selection_invalid');
  }
  assert.equal((await f.reminders.listItems()).length,1);assert.equal(f.calls,0);
});

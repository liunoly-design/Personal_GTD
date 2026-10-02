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
  assert.match(result.receipt, /合成人工任务/);
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

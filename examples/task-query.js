import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
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

const cleanups = [];
const started = performance.now();
const f = fixture({ after(fn) { cleanups.push(fn); } }, { config: { queryPageSize: 2 } });
try {
  const list = await f.reminders.createList('Inbox', 'demo-list');
  for (let i = 0; i < 5; i++) await f.reminders.createItem({ listId: list.id, title: '合成任务' + i, completed: i === 4 }, 'demo-item' + i);
  const first = await dispatch(f, 'om_query_demo', '小婕 gtd 查询任务');
  assert.equal(first.total, 4);
  assert.equal(first.items.length, 2);
  assert.equal(first.hasMore, true);
  await f.restart();
  const cached = await dispatch(f, 'om_query_demo', '小婕 gtd 查询任务');
  assert.deepEqual(cached, first);
  const second = await dispatch(f, 'om_query_page2', '小婕 gtd 看看任务 第2页');
  assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.items, ...second.items].map(v => v.id)).size, 4);
  assert.equal(f.sent.length, 2);
  assert.equal(f.calls, 0);
  assert.equal((await f.reminders.listItems()).length, 5);
  const work = await f.reminders.createList('工作', 'demo-work-list');
  await f.reminders.createItem({ listId: work.id, title: '合成工作任务' }, 'demo-work-item');
  const selected = await dispatch(f, 'om_demo_work', '小婕 gtd 查询工作列表的任务');
  assert.equal(selected.scope.listId, work.id);
  assert.equal(selected.total, 1);
  assert.equal((await dispatch(f, 'om_demo_missing', '小婕 gtd 查询不存在列表的任务')).status, 'query_list_not_found');
  console.log(JSON.stringify({ mode: 'simulation', seeded: 6, unfinished: 5, pages: 2, selectedListItems: selected.total, receipts: f.sent.length,
    modelCalls: f.calls, queryWrites: 0, realAppleReads: 0, realFeishuSends: 0, durationMs: Math.round(performance.now() - started) }));
} finally { for (const cleanup of cleanups) await cleanup(); }

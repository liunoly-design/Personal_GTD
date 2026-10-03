import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openFeishuCapture} from '../src/feishu-capture.js';
import {openPersistentSimulation} from '../src/persistent-simulation.js';
const dir=mkdtempSync(join(tmpdir(),'pgtd-complete-demo-')),started=performance.now();
const config={accountId:'default',entryAgentId:'xiaojie',allowedSenderIds:['ou_test'],allowedConversationIds:['oc_test']};
const reminders=openPersistentSimulation({path:join(dir,'external.sqlite')}),messages=new Map(),sent=[];
let calls=0,writes=0;const complete=reminders.completeTask.bind(reminders);reminders.completeTask=async(...args)=>{writes++;return complete(...args);};
const feishu={async getMessage(id){return messages.get(id);},async reply(input){const v={message_id:'om_bot_'+(sent.length+1),chat_id:input.conversationId};sent.push({...input,...v});return v;}};
const make=()=>openFeishuCapture({stateDir:dir,config,reminders,feishu,analyze:async()=>{calls++;throw new Error('Model not needed');}});let capture=make();
async function dispatch(id,text,parent){messages.set(id,{message_id:id,chat_id:'oc_test',sender:{id:'ou_test',id_type:'open_id',sender_type:'user'},msg_type:'text',create_time:'1790962800000',body:{content:JSON.stringify({text})},...(parent?{parent_id:parent}:{})});return capture.handle({Provider:'feishu',AccountId:'default',AgentId:'xiaojie',SenderId:'ou_test',NativeChannelId:'oc_test',MessageSid:id,rawText:text,...(parent?{ReplyToId:parent}:{})});}
try {
 const list=await reminders.createList('Inbox','demo-complete-list');const item=await reminders.createItem({listId:list.id,title:'PGTD合成完成测试',notes:'保留原文'},'demo-complete-item');
 await dispatch('om_demo_query','小婕 gtd 查询任务');const parent=sent.at(-1).message_id;
 const result=await dispatch('om_demo_complete','第1项完成',parent);assert.equal(result.status,'task_completed');assert.equal((await reminders.getItem(item.id)).completed,true);
 await capture.close();capture=make();assert.deepEqual(await dispatch('om_demo_complete','第1项完成',parent),result);assert.equal(writes,1);
 assert.equal((await dispatch('om_demo_already','第1项完成',parent)).status,'task_already_completed');assert.equal(writes,1);
 assert.equal((await dispatch('om_demo_after','小婕 gtd 查询任务')).status,'tasks_empty');assert.equal(calls,0);
 console.log(JSON.stringify({mode:'simulation',completed:1,businessWrites:writes,duplicateWrites:0,modelCalls:calls,realAppleWrites:0,realFeishuSends:0,receipts:sent.length,durationMs:Math.round(performance.now()-started)}));
}finally{await capture.close();reminders.close();rmSync(dir,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {callApple,openAppleReminders} from '../src/apple-reminders.js';
import {openFeishuCapture} from '../src/feishu-capture.js';
// Explicit authorization required; never reads private task bodies or sends real Feishu messages.
if(!process.argv.includes('--allow-synthetic-writes'))throw new Error('Requires authorization for creating, changing and cleaning dedicated synthetic fixtures');
const config=JSON.parse(readFileSync(resolve('runtime/feishu/runtime-config.json'),'utf8'));
const runId=randomUUID(),dir=resolve('runtime/feishu/maintenance-acceptance',runId);mkdirSync(dir,{recursive:true,mode:0o700});
const fixtureBridge=input=>callApple({...input,sourceId:config.sourceId,runId,allowSyntheticWrites:true},{helperPath:resolve('runtime/bin/pgtd-maintenance-fixture'),timeoutMs:20000});
writeFileSync(join(dir,'intent.json'),JSON.stringify({runId,sourceId:config.sourceId,state:'preparing',syntheticOnly:true}),{mode:0o600});
const fixture=await fixtureBridge({command:'prepare'});writeFileSync(join(dir,'fixture.json'),JSON.stringify({runId,...fixture}),{mode:0o600});
const reminders=openAppleReminders({statePath:join(dir,'apple.sqlite'),sourceId:config.sourceId,listId:fixture.sourceListId,helperPath:config.remindersHelperPath??resolve('runtime/bin/pgtd-reminders')});
const messages=new Map(),sent=[];let writes=0;
for(const name of ['completeTask','moveTask']){const action=reminders[name].bind(reminders);reminders[name]=async(...args)=>{writes++;return action(...args);};}
const capture=openFeishuCapture({stateDir:dir,config:{accountId:'test',entryAgentId:'test',sourceId:config.sourceId,allowedSenderIds:['ou_synthetic'],allowedConversationIds:['oc_synthetic']},reminders,
  feishu:{async getMessage(id){return messages.get(id);},async reply(input){const value={message_id:'om_bot_'+(sent.length+1),chat_id:input.conversationId};sent.push(value);return value;}},analyze:async()=>{throw new Error('No model');}});
async function dispatch(id,text,parent){if(!messages.has(id))messages.set(id,{message_id:id,chat_id:'oc_synthetic',sender:{id:'ou_synthetic',id_type:'open_id',sender_type:'user'},msg_type:'text',create_time:String(Date.now()),body:{content:JSON.stringify({text})},...(parent?{parent_id:parent}:{})});return capture.handle({Provider:'feishu',AccountId:'test',AgentId:'test',SenderId:'ou_synthetic',NativeChannelId:'oc_synthetic',MessageSid:id,rawText:text,...(parent?{ReplyToId:parent}:{})});}
const started=performance.now();let verified=false;
try {
  const query=await dispatch('om_verify_query','小婕 gtd 查询 '+fixture.sourceName+' 里面的任务');assert.equal(query.items.length,5);
  const plan=await dispatch('om_verify_plan','第一第二项完成，第五项移动到'+fixture.targetName+'清单',sent.at(-1).message_id);assert.equal(plan.status,'task_plan_ready');assert.equal(writes,0);
  const parent=sent.at(-1).message_id,result=await dispatch('om_verify_confirm','确认执行',parent);assert.equal(result.status,'task_plan_completed');assert.equal(writes,3);
  assert.deepEqual(await dispatch('om_verify_confirm','确认执行',parent),result);assert.equal(writes,3);
  const refs=query.items.map((item,i)=>({id:item.id,listId:i===4?fixture.targetListId:fixture.sourceListId}));
  const rows=(await reminders.readTasks({items:refs})).items;assert.equal(rows.filter(r=>r.value?.completed).length,2);
  assert.equal(rows[4].value.id,query.items[4].id);assert.equal(rows[4].value.contentRevision,query.items[4].contentRevision);
  assert.equal((await reminders.listLists())[0].id,fixture.sourceListId);verified=true;
  writeFileSync(join(dir,'result.json'),JSON.stringify({verified:true,completed:2,moved:1,idPreserved:true,contentPreserved:true,writes,durationMs:Math.round(performance.now()-started)}),{mode:0o600});
} finally {await capture.close();reminders.close();}
if(verified){await fixtureBridge({command:'cleanup',listIds:[fixture.sourceListId,fixture.targetListId]});console.log(JSON.stringify({verified:true,completed:2,moved:1,idPreserved:true,contentPreserved:true,duplicateWrites:0,realFeishuSends:0,syntheticFixtureCleaned:true,durationMs:Math.round(performance.now()-started)}));}

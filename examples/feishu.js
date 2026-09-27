import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFeishuCapture } from '../src/feishu-capture.js';
import { openPersistentSimulation } from '../src/persistent-simulation.js';
import { simulatedAnalysis } from '../src/simulation.js';
const dir=mkdtempSync(join(tmpdir(),'pgtd-feishu-demo-'));
const reminders=openPersistentSimulation({path:join(dir,'external.sqlite')});
const messages=new Map(), receipts=[], latencies=[], statuses={};
const config={accountId:'default',entryAgentId:'xiaojie',allowedSenderIds:['ou_demo'],allowedConversationIds:['oc_demo']};
const feishu={async getMessage(id){return messages.get(id);},async reply(input){
  const value={message_id:'om_bot_'+receipts.length,chat_id:input.conversationId};receipts.push(value);return value;
}};
const capture=openFeishuCapture({stateDir:dir,config,reminders,feishu,analyze:simulatedAnalysis,now:()=> '2026-09-27T02:00:00Z'});
async function send(text,parent_id) {
  const id='om_demo_'+messages.size;
  messages.set(id,{message_id:id,chat_id:'oc_demo',sender:{id:'ou_demo',id_type:'open_id',sender_type:'user'},
    msg_type:'text',body:{content:JSON.stringify({text})},create_time:'1790474400000',parent_id});
  const ctx={Provider:'feishu',AccountId:'default',AgentId:'xiaojie',NativeChannelId:'oc_demo',SenderId:'ou_demo',
    CommandAuthorized:true,MessageSid:id,rawText:text,ReplyToId:parent_id};
  const start=performance.now(), result=await capture.handle(ctx);
  latencies.push(performance.now()-start);statuses[result.status]=(statuses[result.status]??0)+1;
  return ctx;
}
try {
  let first;
  for(let i=0;i<10;i++){const ctx=await send('小婕 GTD，收集：合成想法 '+i);first??=ctx;}
  for(let i=0;i<5;i++){await send('小婕 GTD，https://example.org/article/'+i);await send('确认',receipts.at(-1).message_id);}
  for(let i=0;i<5;i++){await send('小婕 GTD，提醒我明天交报价');await send('15:00',receipts.at(-1).message_id);}
  await capture.handle(first);
  const sorted=latencies.toSorted((a,b)=>a-b);
  const count=(await reminders.listItems()).length;
  if(count!==20 || receipts.length!==30)throw new Error('Offline acceptance failed');
  console.log(JSON.stringify({mode:'simulation',events:30,replayed:1,items:count,receipts:receipts.length,statuses,
    localLatencyMs:{p50:sorted[14],p95:sorted[28]},paidCalls:0,liveAppleWrites:0,liveFeishuSends:0},null,2));
} finally {await capture.close();reminders.close();rmSync(dir,{recursive:true,force:true});}

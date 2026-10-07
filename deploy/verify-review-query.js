// Read-only probe against an isolated snapshot of the authorized Review state.
import {readFileSync,mkdirSync,chmodSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import {openOperationStore} from '../src/operation-store.js';
import {openReviewDopl} from '../src/review-dopl.js';
import {callNotes} from '../src/apple-notes.js';
const [runtimePath,stateDir,destination]=process.argv.slice(2);
if(!runtimePath||!stateDir||!destination)throw new Error('usage: node deploy/verify-review-query.js PRIVATE_RUNTIME PRIVATE_STATE NEW_PRIVATE_DESTINATION');
mkdirSync(destination,{mode:0o700});const statePath=join(resolve(destination),'review.sqlite');
const db=new DatabaseSync(join(stateDir,'review.sqlite'),{readOnly:true});await backup(db,statePath);db.close();chmodSync(statePath,0o600);
const store=openOperationStore(statePath);store.set('owner',null);store.close();
const config=JSON.parse(readFileSync(runtimePath,'utf8'));let reads=0;
const review=openReviewDopl({statePath,config:config.review,timeZone:config.timeZone,bridge:r=>{if(!['bind','read'].includes(r.command))throw new Error('READ_ONLY_PROBE');reads++;return callNotes(r);}});
const started=performance.now();try{
 const event={senderId:'probe-user',conversationId:'probe-chat',sentAt:new Date().toISOString()};
 const registration=await review.handle({...event,id:'probe-registration',text:'查询注册'});
 const result=await review.handle({...event,id:'probe-query',text:'查询近期心得'});
 if(registration.status!=='review_registration_status'||!registration.registration.registered||!['review_query','review_query_empty'].includes(result.status))throw new Error(result.code??'PROBE_FAILED');
 console.log(JSON.stringify({mode:'real-notes-read-only',registration:true,status:result.status,total:result.total,entries:result.entries.length,dates:result.entries.map(e=>e.date),timestamps:result.entries.map(e=>e.recordedAt),references:result.references.length,reads,notesWrites:0,feishuSends:0,modelCalls:0,latencyMs:Math.round(performance.now()-started)}));
}finally{await review.close();}

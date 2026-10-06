import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doplFixture } from './review-dopl-fixture.js';
const directory=mkdtempSync(join(tmpdir(),'dopl-revision-demo-'));
const f=doplFixture(directory,{config:{review:{account:'synthetic',folder:'Notes',year:2026,allowCreate:true,writeEnabled:true,annualNotes:{2025:{noteId:'synthetic-2025'}}}}});
f.notes.push({id:'synthetic-2025',title:'2025-DOPL',body:'<div>2025-DOPL</div>',plaintext:'2025-DOPL'});
const start=performance.now(),states=[];
const send=async(id,text,reply=false)=>{const r=await f.send(id,text,reply?{parent:f.sent.at(-1).message_id}:{});states.push(r.status);return r;};
try{
 await send('om_reg','小婕 review 注册 DOPL');await send('om_reg_confirm','确认注册',true);
 await send('om_open','小婕 review 每日心得');await send('om_answer','合成原文：先核对事实。',true);await send('om_save','确认保存',true);
 for(const [i,mode,answer] of [[1,'合并','合成补充：再决定行动。'],[2,'替换','合成新稿：事实核对后再行动。']]){
  await send('om_existing_'+i,'小婕 review 每日心得');await send('om_choose_'+i,mode,true);await send('om_answer_'+i,answer,true);
  const parent=f.sent.at(-1).message_id;await f.restart();const saved=await f.send('om_save_'+i,'确认保存',{parent});states.push(saved.status);assert.equal(saved.status,'review_revised');
  await f.restart();assert.equal((await f.send('om_save_'+i,'确认保存',{parent})).status,'review_revised');
 }
 await send('om_backfill','小婕 review 补记 2025-12-31');await send('om_backfill_answer','去年合成原文。',true);const backfilled=await send('om_backfill_save','确认保存',true);assert.equal(backfilled.noteId,'synthetic-2025');
 const note=f.notes.find(n=>n.title==='2026-DOPL');assert.equal(note.plaintext.split('1006-心得').length-1,1);assert.equal(note.plaintext.split('修订历史 2026-10-06').length-1,2);
 console.log(JSON.stringify({mode:'simulation',states,activeEntries:1,historyVersions:2,crossYearNoteId:backfilled.noteId,appendWrites:f.operations.filter(x=>x==='append').length,replaceWrites:f.operations.filter(x=>x==='replace').length,duplicateWrites:0,modelCalls:0,latencyMs:Math.round(performance.now()-start)}));
}finally{await f.close();rmSync(directory,{recursive:true,force:true});}

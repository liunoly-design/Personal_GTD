import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doplFixture } from './review-dopl-fixture.js';
const directory=mkdtempSync(join(tmpdir(),'dopl-demo-')),f=doplFixture(directory);
const started=performance.now();
try{
 const states=[];
 states.push((await f.send('om_register','小婕 review 注册 DOPL')).status);
 states.push((await f.send('om_reg_confirm','确认注册',{parent:f.sent.at(-1).message_id})).status);
 states.push((await f.send('om_open','小婕 review 每日心得')).status);
 states.push((await f.send('om_answer','合成演示：先核对事实，再决定行动。',{parent:f.sent.at(-1).message_id})).status);
 const parent=f.sent.at(-1).message_id;await f.restart();
 const result=await f.send('om_confirm','确认保存',{parent});states.push(result.status);await f.restart();
 await f.send('om_confirm','确认保存',{parent});states.push((await f.send('om_again','小婕 review 每日心得')).status);
 console.log(JSON.stringify({mode:'simulation',states,noteId:result.noteId,title:f.notes[0].title,plaintext:f.notes[0].plaintext,
   appendWrites:f.operations.filter(x=>x==='append').length,modelCalls:0,latencyMs:Math.round(performance.now()-started)}));
}finally{await f.close();rmSync(directory,{recursive:true,force:true});}

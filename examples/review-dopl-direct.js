import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {doplFixture} from './review-dopl-fixture.js';
const directory=mkdtempSync(join(tmpdir(),'dopl-direct-demo-')),f=doplFixture(directory);const start=performance.now();
try{
 await f.send('om_reg','小婕 review 注册 DOPL');await f.send('om_reg_ok','确认注册',{parent:f.sent.at(-1).message_id});
 const states=[];
 for(const [i,answer] of ['合成首次记录。','合成第二次补充。'].entries()){
  const q=await f.send('om_direct_q_'+i,'小婕 review 记录心得');states.push(q.status);assert.ok(!q.receipt.includes('合成首次记录。'));
  const parent=f.sent.at(-1).message_id;await f.restart();const r=await f.send('om_direct_a_'+i,answer,{parent});states.push(r.status);assert.equal(r.status,'review_recorded');assert.ok(!r.receipt.includes('确认保存'));if(i)assert.ok(!r.receipt.includes('合成首次记录。'));
  await f.restart();assert.equal((await f.send('om_direct_a_'+i,answer,{parent})).status,'review_recorded');
 }
 assert.equal(f.notes[0].plaintext.split('心得日期：2026-10-06').length-1,2);assert.equal(f.notes[0].plaintext.split('记录时间：2026-10-06 10:00:00 +08:00').length-1,2);assert.equal(f.operations.filter(c=>c==='append').length,2);assert.ok(!f.operations.includes('replace'));
 console.log(JSON.stringify({mode:'simulation',states,records:2,historyVersions:0,appendWrites:f.operations.filter(c=>c==='append').length,replaceWrites:f.operations.filter(c=>c==='replace').length,duplicateWrites:0,modelCalls:0,latencyMs:Math.round(performance.now()-start)}));
}finally{await f.close();rmSync(directory,{recursive:true,force:true});}

import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {doplFixture} from './review-dopl-fixture.js';
const dir=mkdtempSync(join(tmpdir(),'pgtd-daily-demo-'));let time='2026-10-06T20:59:00+08:00';const started=performance.now();
const f=doplFixture(dir,{now:()=>time,config:{review:{account:'synthetic',folder:'Notes',year:2026,allowCreate:true,writeEnabled:true,daily:{enabled:true,time:'21:00',senderId:'ou_test',conversationId:'oc_test'}}}});
try{
 await f.send('om_reg','小婕 review 注册 DOPL');await f.send('om_ok','确认注册',{parent:f.sent.at(-1).message_id});const before=await f.tick();time='2026-10-06T21:00:00+08:00';const due=await f.tick(),parent=f.sent.at(-1).message_id;const duplicate=await f.tick();await f.restart();const restart=await f.tick();const saved=await f.send('om_answer','合成自动提问回复',{parent,sentAt:'2026-10-06T21:03:00+08:00'});
 console.log(JSON.stringify({mode:'simulation',before:before.status,due:due.status,duplicate:duplicate.status,restart:restart.status,saved:saved.status,questionCount:f.sent.filter(m=>m.text.includes('询问编号：PGTD-REVIEW-')).length,append:f.operations.filter(c=>c==='append').length,replace:f.operations.filter(c=>c==='replace').length,modelCalls:0,latencyMs:Math.round(performance.now()-started)},null,2));
}finally{await f.close();rmSync(dir,{recursive:true,force:true});}

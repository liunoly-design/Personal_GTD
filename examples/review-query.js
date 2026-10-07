import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {doplFixture} from './review-dopl-fixture.js';
const dir=mkdtempSync(join(tmpdir(),'pgtd-query-demo-')),f=doplFixture(dir),started=performance.now();
try{
 await f.send('om_reg','小婕 review 注册 DOPL');await f.send('om_ok','确认注册',{parent:f.sent.at(-1).message_id});
 await f.send('om_open','小婕 review 记录心得');await f.send('om_answer','合成演示：先观察，再行动。',{parent:f.sent.at(-1).message_id});
 const count=f.operations.length;
 const registration=await f.send('om_registration','小婕 review 查询注册'),query=await f.send('om_query','小婕 review 查询近期心得');
 console.log(JSON.stringify({mode:'simulation',registration:registration.receipt,query:query.receipt,notesWrites:f.operations.slice(count).filter(op=>op!=='read').length,modelCalls:query.modelCalls,latencyMs:Math.round(performance.now()-started)},null,2));
}finally{await f.close();rmSync(dir,{recursive:true,force:true});}

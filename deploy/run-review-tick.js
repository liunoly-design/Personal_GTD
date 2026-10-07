// Host command job. The Gateway owns the state; no second process opens its DBs.
import {execFileSync} from 'node:child_process';
try{
 const value=JSON.parse(execFileSync(process.env.PGTD_OPENCLAW_BIN??'openclaw',['gateway','call','personal-gtd.review.tick','--params','{}','--json','--timeout','170000'],{encoding:'utf8',timeout:175000,maxBuffer:131072,stdio:['ignore','pipe','pipe']}));
 console.log(JSON.stringify({status:value.status,...(value.date?{date:value.date}:{}),...(value.code?{code:value.code}:{}),modelCalls:0}));
 if(['review_schedule_unknown','review_schedule_blocked','review_schedule_capacity','busy'].includes(value.status))process.exitCode=1;
}catch{console.log(JSON.stringify({status:'review_schedule_unconfirmed',modelCalls:0}));process.exitCode=1;}

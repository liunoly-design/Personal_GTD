// Private runtime must already contain the narrowly authorized target/time.
// --disabled prepares a job without enabling the real cycle.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const args=process.argv.slice(2),disabled=args.includes('--disabled'),path=args.find(a=>!a.startsWith('--'));
if(!path||args.some(a=>a.startsWith('--')&&a!=='--disabled'))throw new Error('usage: node deploy/install-review-daily.js HOST_CONFIG [--disabled]');
const host=JSON.parse(readFileSync(path,'utf8')),plugin=host.plugins?.entries?.['personal-gtd']?.config;
const runtime=JSON.parse(readFileSync(plugin.runtimeConfigPath,'utf8')),daily=runtime.review?.daily;
if(!daily||!plugin.allowedSenderIds.includes(daily.senderId)||!plugin.allowedConversationIds.includes(daily.conversationId)
 ||(!disabled&&(!daily.enabled||!/^([01]\d|2[0-3]):[0-5]\d$/u.test(daily.time??''))))throw new Error('CONFIRMED_REVIEW_SCHEDULE_REQUIRED');
const call=args=>JSON.parse(execFileSync(process.env.PGTD_OPENCLAW_BIN??'openclaw',args,{encoding:'utf8',timeout:35000,maxBuffer:262144,stdio:['ignore','pipe','pipe']}));
const key='personal-gtd-dopl-daily-v1',root=resolve(import.meta.dirname,'..'),argv=[process.execPath,join(root,'deploy/run-review-tick.js')];
const list=call(['cron','list','--all','--json']),matches=(list.jobs??[]).filter(j=>j.declarationKey===key||j.name===key);
if(matches.length>1)throw new Error('AMBIGUOUS_HOST_REVIEW_JOB');
const common=['--cron','* * * * *','--tz','Asia/Shanghai','--command-argv',JSON.stringify(argv),'--command-cwd',root,'--timeout-seconds','180','--output-max-bytes','2048','--no-deliver','--json'];
const value=matches.length?call(['cron','edit',matches[0].id,...common,disabled?'--disable':'--enable']):call(['cron','add','--name',key,'--declaration-key',key,'--exact',...common,...(disabled?['--disabled']:[])]);
const job=value.job??value,id=job.id??matches[0]?.id;if(!id)throw new Error('HOST_JOB_RESULT_UNKNOWN');
const readback=call(['cron','get',id,'--json']),after=readback.job??readback;
if(after.enabled!==!disabled||after.payload?.kind!=='command')throw new Error('HOST_JOB_READBACK_FAILED');
console.log(JSON.stringify({status:'host-review-job-verified',jobId:id,enabled:after.enabled,payload:after.payload.kind,time:daily.time??null,timeZone:'Asia/Shanghai',modelCalls:0}));

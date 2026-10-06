import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdirSync,writeFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { Temporal } from '@js-temporal/polyfill';
import { callNotes } from '../src/apple-notes.js';
import { doplFixture } from '../examples/review-dopl-fixture.js';
// Explicit real Notes writes; only an unused date is probed. No real Feishu sends.
let f;
const canonical=text=>text.replaceAll('\r\n','\n').trim();
try{
 const {values}=parseArgs({options:{'write-synthetic':{type:'boolean'},account:{type:'string'},folder:{type:'string'},'note-id':{type:'string'},date:{type:'string'},'state-dir':{type:'string'}}});
 if(!values['write-synthetic'])throw new Error('WRITE_OPT_IN_REQUIRED');
 if(!values.account||!values.folder||!values['note-id']||!values['state-dir'])throw new Error('EXPLICIT_SCOPE_REQUIRED');
 const today=Temporal.Now.zonedDateTimeISO('Asia/Shanghai').toPlainDate().toString();
 if(!/^\d{4}-\d{2}-\d{2}$/u.test(values.date??'')||Temporal.PlainDate.from(values.date).toString()!==values.date||values.date>=today)throw new Error('UNUSED_PAST_DATE_REQUIRED');
 const year=Number(values.date.slice(0,4)),heading=values.date.slice(5).replace('-','')+'-心得';
 const directory=resolve(values['state-dir']);mkdirSync(directory,{recursive:true,mode:0o700});
 const ids=await callNotes({command:'bind',account:values.account,folder:values.folder});
 const scope={...ids,noteId:values['note-id']},before=await callNotes({...scope,command:'read'});
 if(before.id!==scope.noteId||before.plaintext.split(/\r?\n/u).find(l=>l.trim())?.trim()!==`${year}-DOPL`)throw new Error('LOCATION_NOT_UNIQUE');
 if(before.plaintext.split(/\r?\n/u).some(line=>line.trim()===heading))throw new Error('DAY_ALREADY_RECORDED');
 const suffix=randomUUID().replaceAll('-',''),sentAt=new Date().toISOString();
 writeFileSync(join(directory,'before-'+suffix+'.json'),JSON.stringify(before),{mode:0o600});
 let writes=0,bridgeCalls=0,verifiedRead;
 const bridge=async(r,options)=>{bridgeCalls++;if(['create','append','replace'].includes(r.command))writes++;const value=await callNotes(r,options);if(r.command==='read')verifiedRead=value;return value;};
 f=doplFixture(directory,{config:{review:{account:values.account,folder:values.folder,year,noteId:scope.noteId,allowCreate:false,writeEnabled:true}},bridge});
 const send=(name,text,extra={})=>f.send('om_revision_probe_'+suffix+'_'+name,text,{sentAt,...extra});
 const requireStatus=(r,status)=>{if(r.status!==status)throw new Error(r.code??'UNEXPECTED_STATUS');return r;};
 const resume=await send('resume','小婕 review 续接');if(['review_error','review_recovery_required'].includes(resume.status))throw new Error(resume.code??'RECOVERY_REQUIRED');
 requireStatus(await send('register','小婕 review 注册 DOPL'),'review_registration_draft');requireStatus(await send('register_confirm','确认注册',{parent:f.sent.at(-1).message_id}),'review_registered');
 requireStatus(await send('open','小婕 review 补记 '+values.date),'review_question');requireStatus(await send('answer','合成验收原文：先核对事实。',{parent:f.sent.at(-1).message_id}),'review_draft');requireStatus(await send('save','确认保存',{parent:f.sent.at(-1).message_id}),'review_saved');
 for(const [i,mode,answer] of [[1,'合并','合成验收补充：再决定行动。'],[2,'替换','合成验收新稿：核对事实后行动。']]){
  requireStatus(await send('existing_'+i,'小婕 review 补记 '+values.date),'review_existing');requireStatus(await send('choose_'+i,mode,{parent:f.sent.at(-1).message_id}),'review_question');requireStatus(await send('answer_'+i,answer,{parent:f.sent.at(-1).message_id}),'review_draft');
  const parent=f.sent.at(-1).message_id;await f.restart();requireStatus(await send('save_'+i,'确认保存',{parent}),'review_revised');const count=writes;await f.restart();requireStatus(await send('save_'+i,'确认保存',{parent}),'review_revised');if(writes!==count)throw new Error('DUPLICATE_WRITE');
 }
 const after=await callNotes({...scope,command:'read'});
 if(after.body!==verifiedRead?.body)throw new Error('CONFLICT');
 if(after.plaintext.split(/\r?\n/u).filter(l=>l.trim()===heading).length!==1||after.plaintext.split(`修订历史 ${values.date}`).length-1!==2)throw new Error('READBACK_FAILED');
 writeFileSync(join(directory,'after-'+suffix+'.json'),JSON.stringify(after),{mode:0o600});
 // Restore only if the complete current note is still our known result. Unknown
 // failures stop above and leave state/backups for read-only reconciliation.
 await callNotes({...scope,command:'replace',expectedBody:after.body,body:before.body});writes++;
 const restored=await callNotes({...scope,command:'read'});
 if(canonical(restored.plaintext)!==canonical(before.plaintext)||JSON.stringify([...restored.nativeTags].sort())!==JSON.stringify([...before.nativeTags].sort()))throw new Error('CLEANUP_READBACK_FAILED');
 console.log(JSON.stringify({mode:'real-apple-notes',status:'passed',date:values.date,noteId:scope.noteId,activeEntries:1,historyVersions:2,duplicateWrites:0,writes,bridgeCalls,cleanup:'original-plaintext-and-tags-restored',modelCalls:0,realFeishuSends:0,realFeishuAcceptance:false}));
}catch(error){const code=/^[A-Z_]+$/.test(error.message)?error.message:'PROBE_FAILED';console.error(JSON.stringify({status:'stopped',code,savedState:f?'retained':'not_initialized',nextAction:'核对原ID及私有快照；未知写入先续接只读核对，不自动重写或清理。'}));process.exitCode=1;}
finally{await f?.close();}

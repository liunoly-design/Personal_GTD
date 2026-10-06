import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { callNotes } from '../src/apple-notes.js';
import { doplFixture } from '../examples/review-dopl-fixture.js';
// A real Notes probe with synthetic Feishu events. Never sends a real Feishu message.
let f;
try{
 const {values}=parseArgs({options:{'write-synthetic':{type:'boolean'},account:{type:'string'},folder:{type:'string'},
   'note-id':{type:'string'},'allow-create':{type:'boolean'},date:{type:'string',default:'2026-10-06'},
   'state-dir':{type:'string',default:'runtime/review-dopl-probe'}}});
 if(!values['write-synthetic'])throw new Error('WRITE_OPT_IN_REQUIRED');
 if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(values.date))throw new Error('INVALID_DATE');
 const year=Number(values.date.slice(0,4)),suffix=randomUUID().replaceAll('-',''),sentAt=values.date+'T12:00:00+08:00';
 let bridgeCalls=0,writes=0;
 const bridge=async(request,options)=>{bridgeCalls++;if(['create','append'].includes(request.command))writes++;return callNotes(request,options);};
 f=doplFixture(resolve(values['state-dir']),{config:{review:{account:values.account,folder:values.folder,year,
   allowCreate:values['allow-create']===true,writeEnabled:true,...(values['note-id']?{noteId:values['note-id']}:{})}},bridge});
 const send=(name,text,extra={})=>f.send('om_probe_'+suffix+'_'+name,text,{sentAt,...extra});
 const requireStatus=(r,status)=>{if(r.status!==status)throw new Error(r.code??'UNEXPECTED_STATUS');return r;};
 // Resume an uncertain previous probe before creating any new registration/draft.
 const resume=await send('resume','小婕 review 续接');
 if(['review_error','review_recovery_required'].includes(resume.status))throw new Error(resume.code??'RECOVERY_REQUIRED');
 requireStatus(await send('register','小婕 review 注册 DOPL'),'review_registration_draft');
 const registered=requireStatus(await send('register_confirm','确认注册',{parent:f.sent.at(-1).message_id}),'review_registered');
 const opened=await send('open','小婕 review 每日心得');
 if(opened.status==='review_existing')throw new Error('DAY_ALREADY_RECORDED');
 requireStatus(opened,'review_question');
 const answer='合成验收：每日心得先由用户提供原文，确认后保存。';
 requireStatus(await send('answer',answer,{parent:f.sent.at(-1).message_id}),'review_draft');
 const parent=f.sent.at(-1).message_id;await f.restart();
 const result=requireStatus(await send('confirm','确认保存',{parent}),'review_saved');
 const confirmedWrites=writes;await f.restart();
 const repeated=requireStatus(await send('confirm','确认保存',{parent}),'review_saved');
 requireStatus(await send('again','小婕 review 每日心得'),'review_existing');
 if(writes!==confirmedWrites||repeated.noteId!==result.noteId||registered.noteId!==result.noteId)throw new Error('READBACK_FAILED');
 console.log(JSON.stringify({mode:'real-apple-notes',status:'passed',date:result.date,noteId:result.noteId,
   modelCalls:0,realFeishuSends:0,bridgeCalls,writes,duplicateWrites:0,realFeishuAcceptance:false}));
}catch(error){const code=/^[A-Z_]+$/.test(error.message)?error.message:'PROBE_FAILED';console.error(JSON.stringify({status:'stopped',code,savedState:f?'retained':'not_initialized',nextAction:code==='WRITE_OPT_IN_REQUIRED'?'先明确Notes位置与合成写入授权，再显式传入--write-synthetic。':'核对原笔记与私有状态；未知写入先续接，不自动重写。'}));process.exitCode=1;}
finally{await f?.close();}

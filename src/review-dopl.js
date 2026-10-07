import { createHash,randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { openOperationStore } from './operation-store.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const html=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll('\n','<br>');
const canonical=text=>text.replaceAll('\r\n','\n').trim();
const method={id:'dopl-original',version:1};
const help=()=>({status:'review_help',receipt:'记录心得：发送“小婕 review 记录心得”，回复引导问题直接追加原文。手动每日心得：先发送“小婕 review 注册 DOPL”并回复“确认注册”；之后发送“小婕 review 每日心得”，回复问题提供原文，再回复当前草案“确认保存”。“续接”核对进度，“取消”结束本次。同日已有记录可关联选择合并或替换，补记请显式指定日期；查询、专题及定时复盘尚未交付。',modelCalls:0});
export function openReviewDopl({statePath,config,bridge,timeZone='Asia/Shanghai'}) {
 config=structuredClone(config);
 if(![config.account,config.folder].every(v=>typeof v==='string'&&v.trim()&&v.length<=200)
   || !Number.isSafeInteger(config.year)||config.year<1970||config.year>9999
   ||(config.noteId!==undefined&&(typeof config.noteId!=='string'||!config.noteId)))throw new Error('INVALID_REVIEW_CONFIG');
 const annualNotes=config.annualNotes??{};
 if(typeof annualNotes!=='object'||Array.isArray(annualNotes)||Object.keys(annualNotes).length>20
   ||Object.entries(annualNotes).some(([year,v])=>!/^\d{4}$/u.test(year)||Number(year)<1970||Number(year)>9999||Number(year)===config.year||!v||typeof v.noteId!=='string'||!v.noteId.trim()))throw new Error('INVALID_REVIEW_CONFIG');
 Temporal.Now.zonedDateTimeISO(timeZone);
 const location={account:config.account,folder:config.folder,year:config.year,noteId:config.noteId??null,timeZone};
 const store=openOperationStore(statePath),token=randomUUID();
 try {store.transaction(()=>{
   const owner=store.get('owner');
   if(owner?.pid){let alive=true;try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}if(alive)throw new Error('STATE_IN_USE');}
   if(store.get('location')&&hash(store.get('location'))!==hash(location))throw new Error('BINDING_CHANGED');
   store.set('location',location);store.set('owner',{pid:process.pid,token});
 });}catch(e){store.close();throw e;}
 let queue=Promise.resolve(),closed=false;
 async function processEvent(event){
  if(![event.id,event.senderId,event.conversationId].every(v=>typeof v==='string'&&v.trim()&&v.length<=256)
    ||typeof event.text!=='string'||Array.from(event.text).length>4000||!Number.isFinite(Date.parse(event.sentAt)))return {status:'review_invalid',receipt:'请提供不超过4000字的非空心得原文；未写入。',modelCalls:0};
  const key='event:'+hash([event.senderId,event.conversationId,event.id]),fingerprint=hash(event);
  const old=store.get(key);
  if(old&&old.fingerprint!==fingerprint)return {status:'event_conflict',receipt:'同一消息内容不一致，未操作。',modelCalls:0};
  if(old?.result)return old.result;
  if(!old&&store.entries('event:').length>=1000)return {status:'review_capacity',receipt:'Review事件容量已满，未新增操作。',modelCalls:0};
  const sessionKey='session:'+hash([event.senderId,event.conversationId]);
  const finish=result=>{const value={...result,method,modelCalls:0};store.set(key,{fingerprint,result:value});return value;};
  store.set(key,{fingerprint});
  let calls=0;const deadline=Date.now()+120000;
  const call=async request=>{
    if(config.readEnabled===false)throw new Error('PERMISSION_DENIED');
    if(++calls>8||Date.now()>=deadline)throw new Error('BUDGET_EXHAUSTED');
    const timeoutMs=Math.min(60000,deadline-Date.now());let timer;
    try{return await Promise.race([bridge(request,{timeoutMs}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('APPLE_TIMEOUT')),timeoutMs);})]);}
    finally{clearTimeout(timer);}
  };
  const text=event.text.trim(),date=Temporal.Instant.from(event.sentAt).toZonedDateTimeISO(timeZone).toPlainDate().toString();
  const session=store.get(sessionKey);
  const matching=kind=>event.link?.kind===kind&&event.link.version===session?.version;
  const noteKey=year=>year===config.year?'note':'note:'+year;
  const scope=(year=config.year)=>({accountId:store.get(noteKey(year))?.accountId,folderId:store.get(noteKey(year))?.folderId});
  const read=async(year=config.year)=>{
    let binding=store.get(noteKey(year));
    if(year!==config.year){
      const target=annualNotes[year];if(!target)throw new Error('YEAR_NOT_BOUND');
      if(binding&&binding.noteId!==target.noteId)throw new Error('BINDING_CHANGED');
      if(!binding){const ids=await call({command:'bind',account:config.account,folder:config.folder});
        if(!ids?.accountId||!ids?.folderId)throw new Error('READBACK_FAILED');
        binding={...ids,title:`${year}-DOPL`,noteId:target.noteId};store.set(noteKey(year),binding);}
    }
    if(!binding?.noteId)throw new Error('RECOVERY_REQUIRED');
    const n=await call({...scope(year),command:'read',noteId:binding.noteId});
    if(n?.id!==binding.noteId||typeof n.body!=='string'||typeof n.plaintext!=='string'||n.tagsComplete===false||n.headingsComplete===false)throw new Error('READBACK_FAILED');
    if(n.plaintext.split(/\r?\n/u).find(line=>line.trim())?.trim()!==binding.title)throw new Error('LOCATION_NOT_UNIQUE');
    if(n.body.length>131072||Array.from(n.plaintext).length>65536)throw new Error('CAPACITY_EXCEEDED');
    return n;
  };
  const sessionYear=()=>Number((session?.date??date).slice(0,4));
  const existing=(n,d)=>{
    const heading=d.slice(5).replace('-','')+'-心得';
    const lines=n.plaintext.split(/\r?\n/u),indices=lines.flatMap((line,i)=>line.trim()===heading?[i]:[]);
    if(indices.length>1)throw new Error('LOCATION_NOT_UNIQUE');
    if(!indices.length)return null;
    const start=indices[0];
    let end=lines.findIndex((line,j)=>j>start&&(/^[0-9]{4}-心得$/u.test(line.trim())||/^PGTD-DOPL-(?:ENTRY|HISTORY)-/u.test(line.trim())));
    if(end<0)end=lines.length;
    return {heading,text:lines.slice(start+1,end).join('\n'),start,end,managed:/^PGTD-DOPL-ENTRY-[0-9a-f-]{36}$/u.test(lines[end]?.trim()??'')};
  };
  const duplicate=(n,d)=>{
    const e=existing(n,d);if(!e)return null;
    const version=randomUUID(),result={status:'review_existing',date:d,noteId:n.id,reviewLink:{kind:'choice',version},receipt:`${d}已有${e.heading}：\n${e.text}\n请选择合并或替换，回复本回执“合并”或“替换”。合并保留旧原文并追加补充；替换使用你提供的完整新稿。两者均先展示草案、确认后保存，并保留旧原文历史。`};
    store.set(sessionKey,{phase:'choice',version,date:d,noteBody:n.body,result});return result;
  };
  async function saveEntry(draft,n){
      const year=Number(draft.date.slice(0,4));
      const marker='PGTD-DOPL-ENTRY-'+draft.version;
      const addition=`<div>${draft.heading}</div><div>${html(draft.answer)}</div><div>${marker}</div>`;
      let expectedPlaintext=canonical(n.plaintext)+'\n'+draft.heading+'\n'+draft.answer+'\n'+marker,body;
      if(draft.mode){
        const previous=existing(n,draft.date);if(!previous?.managed)throw new Error('UNSUPPORTED_ENTRY');
        const lines=n.plaintext.split(/\r?\n/u);
        lines.splice(previous.start,previous.end-previous.start+1,draft.heading,draft.answer,marker);
        lines.push('PGTD-DOPL-HISTORY-'+draft.version,`修订历史 ${draft.date}（${draft.mode}）`,'旧心得原文',previous.text,'PGTD-DOPL-HISTORY-END-'+draft.version);
        expectedPlaintext=canonical(lines.join('\n'));body=`<div>${html(expectedPlaintext)}</div>`;
      }else {const dup=duplicate(n,draft.date);if(dup)return finish(dup);}
      if((body??(n.body+addition)).length>131072||Array.from(expectedPlaintext).length>65536)throw new Error('CAPACITY_EXCEEDED');
      const result={status:draft.quick?'review_recorded':draft.mode?'review_revised':'review_saved',date:draft.date,noteId:n.id,method,modelCalls:0,receipt:draft.quick?`已记录${draft.date}心得：${config.account}/${config.folder}/${year}-DOPL\n本次新增：\n${draft.submittedAnswer}\n${draft.mode?'已追加到当天心得，旧原文与历史保留。':'已新增当天心得。'}\n笔记ID：${n.id}；已读回核验。`:`已${draft.mode?'修订':'保存'}${draft.date}每日心得：${config.account}/${config.folder}/${year}-DOPL\n${draft.heading}\n${draft.answer}\n笔记ID：${n.id}；原文方法v1，已读回核验，零模型调用。${draft.mode?'旧原文已保留在年度笔记修订历史。':''}`};
      store.set('pending',{key,fingerprint,sessionKey,year:year,result,expectedPlaintext});
      await call({...scope(year),noteId:n.id,expectedBody:n.body,...(draft.mode?{command:'replace',body}:{command:'append',addition})});
      const after=await read(year);if(canonical(after.plaintext)!==canonical(expectedPlaintext))throw new Error('READBACK_FAILED');
      store.transaction(()=>{store.set('pending',null);store.set(sessionKey,null);});return finish(result);
  }
  async function bindNote(){
    let binding=store.get('note');
    if(!binding){const ids=await call({command:'bind',account:config.account,folder:config.folder});if(!ids?.accountId||!ids?.folderId)throw new Error('READBACK_FAILED');
      binding={...ids,title:`${config.year}-DOPL`,marker:'PGTD-DOPL-'+randomUUID(),noteId:config.noteId};store.set('note',binding);}
    if(binding.noteId)return read();
    const matches=await call({...scope(),command:'find',title:binding.title,marker:binding.creating?binding.marker:''});
    if(!Array.isArray(matches)||matches.length>1)throw new Error('LOCATION_NOT_UNIQUE');
    if(matches.length===1){binding.noteId=matches[0].id;store.set('note',binding);return read();}
    if(binding.creating)throw new Error('CREATE_RESULT_UNKNOWN');
    if(!config.allowCreate)throw new Error('NOTE_NOT_BOUND');
    binding.creating=true;store.set('note',binding);
    const created=await call({...scope(),command:'create',title:binding.title,body:`<div>${binding.title}</div><div>${binding.marker}</div>`});
    if(typeof created?.id!=='string'||!created.id)throw new Error('CREATE_RESULT_UNKNOWN');
    binding.noteId=created.id;store.set('note',binding);const n=await read();
    if(!n.plaintext.includes(binding.marker))throw new Error('READBACK_FAILED');return n;
  }
  try{
    const pending=store.get('pending');
    if(pending){
      if(pending.sessionKey!==sessionKey)return finish({status:'review_recovery_required',receipt:'另一个会话有待核对写入，请原用户在原会话发送“小婕 review 续接”；本次未写入。'});
      if(text!=='续接')return finish({status:'review_recovery_required',receipt:'上次保存结果待核对，请发送“小婕 review 续接”；不要重复提交心得。'});
      const n=await read(pending.year??config.year);
      if(canonical(n.plaintext)!==canonical(pending.expectedPlaintext))throw new Error('WRITE_RESULT_UNKNOWN');
      store.transaction(()=>{store.set(pending.key,{fingerprint:pending.fingerprint,result:pending.result});store.set(sessionKey,null);store.set('pending',null);});
      return finish(pending.result);
    }
    if(text==='注册 DOPL'||text==='注册DOPL'){
      const version=randomUUID();store.set(sessionKey,{phase:'registration',version});
      return finish({status:'review_registration_draft',reviewLink:{kind:'registration',version},receipt:`注册每日心得，方法dopl-original/v1（原文、零模型），时区${timeZone}，年度${config.year}。\n位置：${config.account}/${config.folder}/${config.year}-DOPL${config.noteId?'（已有绑定ID）':''}。允许新建：${config.allowCreate===true?'是':'否'}。\n回复本回执“确认注册”，仅注册手动方法，不启用调度。`});
    }
    if(text==='确认注册'){
      if(!matching('registration')||session.phase!=='registration')return finish({status:'review_needs_confirmation',receipt:'请回复当前注册草案“确认注册”，未读取或写入笔记。'});
      if(config.writeEnabled!==true)throw new Error('PERMISSION_DENIED');
      const n=await bindNote();store.transaction(()=>{store.set('registration',{method,location,version:session.version});store.set(sessionKey,null);});
      return finish({status:'review_registered',noteId:n.id,receipt:`每日心得已注册：${config.account}/${config.folder}/${config.year}-DOPL\n笔记ID：${n.id}\n发送“小婕 review 每日心得”开始，先问再确认保存。`});
    }
    if(!store.get('registration'))return finish({status:'review_needs_registration',receipt:'每日心得尚未注册，请发送“小婕 review 注册 DOPL”，核对位置后回复确认。'});
    if(text==='取消'){store.set(sessionKey,null);return finish({status:'review_cancelled',receipt:'本次心得草案已取消，未保存心得。'});}
    let targetDate=date;const backfill=/^补记(?:\s|$)/u.test(text);
    if(backfill){
      const match=/^补记\s+(\d{4}-\d{2}-\d{2})$/u.exec(text);
      let valid=false;if(match){try{valid=Temporal.PlainDate.from(match[1]).toString()===match[1]&&match[1]<=date;}catch{}}
      if(!valid)return finish({status:'review_needs_date',receipt:'补记请明确指定有效日期：小婕 review 补记 YYYY-MM-DD（不能晚于消息当天）。相对日期或缺失日期不猜测；未写入。'});
      targetDate=match[1];
    }
    if(['每日心得','记录心得','DOPL','dopl','续接'].includes(text)||backfill){
      if(text==='续接'&&['draft','question','choice','quick-answer'].includes(session?.phase)){
        if(session.result)return finish(session.result);
        // T01 persisted questions before storing their receipt in the session.
        return finish({status:'review_question',date:session.date,reviewLink:{kind:'question',version:session.version},receipt:`${session.date}的每日一点心得是什么？请回复这条消息提供原文；我会先展示草案，确认后保存。`});
      }
      const year=Number(targetDate.slice(0,4));
      if(year!==config.year&&!annualNotes[year])return finish({status:'review_year_unbound',receipt:`${targetDate}年度${year}-DOPL未绑定；请维护者明确配置该年度现有笔记的真实ID，未新建或写入。`});
      const n=await read(year);if(text==='记录心得'){
        const version=randomUUID(),result={status:'review_question',date:targetDate,reviewLink:{kind:'question',version},receipt:`${targetDate}记录心得，任选一个问题回答即可：\n1. 今天哪件事最值得记住？\n2. 你从中学到了什么，或有什么新的感受？\n3. 这对接下来的行动有什么启发？\n回复这条消息直接保存原文；当天已有心得时追加这次内容，保留旧原文。回复“取消”结束。`};
        store.set(sessionKey,{phase:'question',quick:true,version,date:targetDate,noteBody:n.body,result});return finish(result);
      }
      const dup=duplicate(n,targetDate);if(dup)return finish(dup);
      const version=randomUUID();store.set(sessionKey,{phase:'question',version,date:targetDate,noteBody:n.body,result:{status:'review_question',date:targetDate,reviewLink:{kind:'question',version},receipt:`${targetDate}的每日一点心得是什么？请回复这条消息提供原文；我会先展示草案，确认后保存。`}});
      return finish(store.get(sessionKey).result);
    }
    if(text==='确认保存'){
      if(!matching('draft')||session?.phase!=='draft')return finish({status:'review_needs_confirmation',receipt:'请回复当前心得草案“确认保存”；未写入。'});
      if(config.writeEnabled!==true)throw new Error('PERMISSION_DENIED');
      const n=await read(sessionYear());
      if(n.body!==session.noteBody)throw new Error('CONFLICT');
      return await saveEntry(session,n);
    }
    if(['合并','替换'].includes(text)){
      if(!matching('choice')||session?.phase!=='choice')return finish({status:'review_needs_confirmation',receipt:'请回复当前已有条目回执选择“合并”或“替换”；未写入。'});
      const n=await read(sessionYear());if(n.body!==session.noteBody)throw new Error('CONFLICT');
      const previous=existing(n,session.date);if(!previous?.managed)throw new Error('UNSUPPORTED_ENTRY');
      const version=randomUUID(),result={status:'review_question',date:session.date,reviewLink:{kind:'question',version},receipt:`${session.date}选择${text}。${text==='合并'?'请回复本问题提供补充原文，完整草案将保留旧原文并换行追加补充。':'请回复本问题提供完整替换新稿。'}确认前不写入，保存后保留旧原文历史。`};
      store.set(sessionKey,{phase:'question',version,date:session.date,mode:text,oldAnswer:previous.text,noteBody:n.body,result});return finish(result);
    }
    if(event.link?.kind==='question'&&matching('question')&&session?.phase==='question'){
      if(/(?:^|\n)\s*[0-9]{4}-心得\s*(?:$|\n)|PGTD-DOPL-/u.test(event.text))return finish({status:'review_invalid',receipt:'原文包含年度记录保留标题或核对标记，请改写该行后再回复提问；未写入。'});
      if(!text)return finish({status:'review_invalid',receipt:'心得为空，未保存。请回复提问提供非空原文。'});
      if(session.quick){
        const progress={status:'review_unsaved',date:session.date,receipt:`${session.date}本次原文已保留，尚未确认记录完成：\n${event.text}\n请处理失败原因后重新发起“小婕 review 记录心得”；未知写入先续接核对。`};
        store.set(sessionKey,{...session,phase:'quick-answer',submittedAnswer:event.text,result:progress});
        if(config.writeEnabled!==true)throw new Error('PERMISSION_DENIED');
        const n=await read(sessionYear());if(n.body!==session.noteBody)throw new Error('CONFLICT');
        const previous=existing(n,session.date);if(previous&&!previous.managed)throw new Error('UNSUPPORTED_ENTRY');
        const answer=previous?previous.text+'\n'+event.text:event.text;
        if(Array.from(answer).length>4000)throw new Error('CAPACITY_EXCEEDED');
        return await saveEntry({date:session.date,heading:session.date.slice(5).replace('-','')+'-心得',answer,submittedAnswer:event.text,version:randomUUID(),mode:previous?'合并':undefined,quick:true},n);
      }
      const n=await read(sessionYear());if(n.body!==session.noteBody)throw new Error('CONFLICT');
      if(!session.mode){const dup=duplicate(n,session.date);if(dup)return finish(dup);}
      const answer=session.mode==='合并'?session.oldAnswer+'\n'+event.text:event.text;
      if(Array.from(answer).length>4000)return finish({status:'review_invalid',receipt:'完整心得超过4000字，请精简补充或重新选择替换提供精简完整新稿；未写入。'});
      const version=randomUUID(),heading=session.date.slice(5).replace('-','')+'-心得';
      const result={status:'review_draft',date:session.date,reviewLink:{kind:'draft',version},receipt:`每日心得草案（未保存）\n${session.date} · ${heading}\n${answer}\n${session.mode?'操作：'+session.mode+'；旧原文将保留在修订历史。\n':''}来源：用户原文；方法dopl-original/v1。\n回复本草案“确认保存”或“取消”。`};
      store.set(sessionKey,{phase:'draft',version,date:session.date,heading,answer,mode:session.mode,noteBody:n.body,result});return finish(result);
    }
    return finish(help());
  }catch(error){
    const codes=['CONFLICT','INVALID_INPUT','AX_SELECTION_FAILED','HEADING_FORMAT_FAILED','TAG_READ_FAILED','TAG_WRITE_FAILED','TAG_WRITE_INCOMPLETE','TAG_DELIMITER_REQUIRED','BINDING_CHANGED','YEAR_NOT_BOUND','PERMISSION_DENIED','ACCESSIBILITY_DENIED','LOCATION_NOT_UNIQUE','UNSUPPORTED_NOTE','UNSUPPORTED_ENTRY','UNSUPPORTED_FOLDER','CAPACITY_EXCEEDED','BUDGET_EXHAUSTED','NOTE_NOT_BOUND','RECOVERY_REQUIRED','CREATE_RESULT_UNKNOWN','READBACK_FAILED','WRITE_RESULT_UNKNOWN','APPLE_TIMEOUT','NOTES_UI_BUSY','EDITOR_UNAVAILABLE','UI_FOCUS_CHANGED','APPLE_RESULT_UNKNOWN','BRIDGE_UNAVAILABLE'];
    const code=codes.includes(error.message)?error.message:'NOTES_UNAVAILABLE';
    return finish({status:'review_error',code,receipt:`每日心得未确认完成。原因：${code}。${store.get('pending')?'已保留原文与待核对写入，请保持备忘录可见，发送“小婕 review 续接”只读核对；不自动重写。':code==='CONFLICT'?`备忘录已被修改，原文草案保留；请重新发送“小婕 review ${session?.quick?'记录心得':session?.date?'补记 '+session.date:'每日心得'}”读取最新内容后确认。`:code==='UNSUPPORTED_ENTRY'?'已有条目缺少可信结束标记，无法确认替换范围；原文保留，请维护者核对该日期条目边界后重新发起。':'配置/问答进度保留，未宣称保存成功。请处理权限或位置问题后重新发起；未知创建不得新建替代笔记。'}`});
  }
 }
 return {handle(event){if(closed)throw new Error('Review closed');const task=queue.then(()=>processEvent(event));queue=task.catch(()=>{});return task;},async close(){if(closed)return;closed=true;await queue;if(store.get('owner')?.token===token)store.set('owner',null);store.close();}};
}

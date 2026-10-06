import { createHash,randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { openOperationStore } from './operation-store.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const html=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll('\n','<br>');
const canonical=text=>text.replaceAll('\r\n','\n').trim();
const method={id:'dopl-original',version:1};
const help=()=>({status:'review_help',receipt:'手动每日心得：先发送“小婕 review 注册 DOPL”并回复“确认注册”；之后发送“小婕 review 每日心得”，回复问题提供原文，再回复当前草案“确认保存”。“续接”核对进度，“取消”结束本次。查询、补记、修订、专题及定时复盘尚未交付。',modelCalls:0});
export function openReviewDopl({statePath,config,bridge,timeZone='Asia/Shanghai'}) {
 config=structuredClone(config);
 if(![config.account,config.folder].every(v=>typeof v==='string'&&v.trim()&&v.length<=200)
   || !Number.isSafeInteger(config.year)||config.year<1970||config.year>9999
   ||(config.noteId!==undefined&&(typeof config.noteId!=='string'||!config.noteId)))throw new Error('INVALID_REVIEW_CONFIG');
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
  const scope=()=>({accountId:store.get('note')?.accountId,folderId:store.get('note')?.folderId});
  const read=async()=>{
    const binding=store.get('note');if(!binding?.noteId)throw new Error('RECOVERY_REQUIRED');
    const n=await call({...scope(),command:'read',noteId:binding.noteId});
    if(n?.id!==binding.noteId||typeof n.body!=='string'||typeof n.plaintext!=='string'||n.tagsComplete===false||n.headingsComplete===false)throw new Error('READBACK_FAILED');
    if(n.plaintext.split(/\r?\n/u).find(line=>line.trim())?.trim()!==binding.title)throw new Error('LOCATION_NOT_UNIQUE');
    if(n.body.length>131072||Array.from(n.plaintext).length>65536)throw new Error('CAPACITY_EXCEEDED');
    return n;
  };
  const existing=(n,d)=>{
    const heading=d.slice(5).replace('-','')+'-心得';
    const lines=n.plaintext.split(/\r?\n/u),i=lines.findIndex(line=>line.trim()===heading);
    if(i<0)return null;
    let end=lines.findIndex((line,j)=>j>i&&(/^[0-9]{4}-心得$/u.test(line.trim())||/^PGTD-DOPL-ENTRY-/u.test(line.trim())));
    if(end<0)end=lines.length;
    return {heading,text:lines.slice(i+1,end).join('\n').trim()};
  };
  const duplicate=(n,d)=>{const e=existing(n,d);return e?{status:'review_existing',date:d,noteId:n.id,receipt:`${d}已有${e.heading}：\n${e.text}\n请选择合并或替换；同日修订属于F614/T02，本版保留原文且不新增第二条。`}:null;};
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
      const n=await read();
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
    if(['每日心得','DOPL','dopl','续接'].includes(text)){
      if(text==='续接'&&session?.phase==='draft')return finish({...session.result});
      if(!date.startsWith(String(config.year)+'-'))return finish({status:'review_year_unbound',receipt:`当前仅绑定${config.year}-DOPL；消息日期${date}属于其他年度，未新建或写入。`});
      const n=await read(),dup=duplicate(n,date);if(dup){store.set(sessionKey,null);return finish(dup);}
      const version=randomUUID();store.set(sessionKey,{phase:'question',version,date,noteBody:n.body});
      return finish({status:'review_question',date,reviewLink:{kind:'question',version},receipt:`${date}的每日一点心得是什么？请回复这条消息提供原文；我会先展示草案，确认后保存。`});
    }
    if(text==='确认保存'){
      if(!matching('draft')||session?.phase!=='draft')return finish({status:'review_needs_confirmation',receipt:'请回复当前心得草案“确认保存”；未写入。'});
      if(config.writeEnabled!==true)throw new Error('PERMISSION_DENIED');
      const n=await read(),dup=duplicate(n,session.date);if(dup){store.set(sessionKey,null);return finish(dup);}
      if(n.body!==session.noteBody)throw new Error('CONFLICT');
      const marker='PGTD-DOPL-ENTRY-'+session.version;
      const addition=`<div>${session.heading}</div><div>${html(session.answer)}</div><div>${marker}</div>`;
      if((n.body+addition).length>131072)throw new Error('CAPACITY_EXCEEDED');
      const expectedPlaintext=canonical(n.plaintext)+'\n'+session.heading+'\n'+session.answer+'\n'+marker;
      if(Array.from(expectedPlaintext).length>65536)throw new Error('CAPACITY_EXCEEDED');
      const result={status:'review_saved',date:session.date,noteId:n.id,method,modelCalls:0,receipt:`已保存${session.date}每日心得：${config.account}/${config.folder}/${config.year}-DOPL\n${session.heading}\n${session.answer}\n笔记ID：${n.id}；原文方法v1，已读回核验，零模型调用。`};
      store.set('pending',{key,fingerprint,sessionKey,result,expectedPlaintext});
      await call({...scope(),command:'append',noteId:n.id,expectedBody:n.body,addition});
      const after=await read();if(canonical(after.plaintext)!==canonical(expectedPlaintext))throw new Error('READBACK_FAILED');
      store.transaction(()=>{store.set('pending',null);store.set(sessionKey,null);});return finish(result);
    }
    if(event.link?.kind==='question'&&matching('question')&&session?.phase==='question'){
      if(/(?:^|\n)\s*[0-9]{4}-心得\s*(?:$|\n)|PGTD-DOPL-/u.test(event.text))return finish({status:'review_invalid',receipt:'原文包含年度记录保留标题或核对标记，请改写该行后再回复提问；未写入。'});
      if(!text)return finish({status:'review_invalid',receipt:'心得为空，未保存。请回复提问提供非空原文。'});
      const n=await read(),dup=duplicate(n,session.date);if(dup)return finish(dup);
      const version=randomUUID(),heading=session.date.slice(5).replace('-','')+'-心得';
      const result={status:'review_draft',date:session.date,reviewLink:{kind:'draft',version},receipt:`每日心得草案（未保存）\n${session.date} · ${heading}\n${event.text}\n来源：用户原文；方法dopl-original/v1。\n回复本草案“确认保存”或“取消”。`};
      store.set(sessionKey,{phase:'draft',version,date:session.date,heading,answer:event.text,noteBody:n.body,result});return finish(result);
    }
    return finish(help());
  }catch(error){
    const codes=['CONFLICT','PERMISSION_DENIED','ACCESSIBILITY_DENIED','LOCATION_NOT_UNIQUE','UNSUPPORTED_NOTE','UNSUPPORTED_FOLDER','CAPACITY_EXCEEDED','BUDGET_EXHAUSTED','NOTE_NOT_BOUND','RECOVERY_REQUIRED','CREATE_RESULT_UNKNOWN','READBACK_FAILED','WRITE_RESULT_UNKNOWN','APPLE_TIMEOUT','NOTES_UI_BUSY','EDITOR_UNAVAILABLE','UI_FOCUS_CHANGED','APPLE_RESULT_UNKNOWN','BRIDGE_UNAVAILABLE'];
    const code=codes.includes(error.message)?error.message:'NOTES_UNAVAILABLE';
    return finish({status:'review_error',code,receipt:`每日心得未确认完成。原因：${code}。${store.get('pending')?'已保留原文与待核对写入，请保持备忘录可见，发送“小婕 review 续接”只读核对；不自动重写。':code==='CONFLICT'?'备忘录已被修改，原文草案保留；请重新发送“小婕 review 每日心得”读取最新内容后确认。':'配置/问答进度保留，未宣称保存成功。请处理权限或位置问题后重新发起；未知创建不得新建替代笔记。'}`});
  }
 }
 return {handle(event){if(closed)throw new Error('Review closed');const task=queue.then(()=>processEvent(event));queue=task.catch(()=>{});return task;},async close(){if(closed)return;closed=true;await queue;if(store.get('owner')?.token===token)store.set('owner',null);store.close();}};
}

import { createHash } from 'node:crypto';

export async function bounded(call, timeoutMs, signal) {
  const controller=new AbortController(), combined=AbortSignal.any([controller.signal,...(signal?[signal]:[])]);
  let timer,onAbort;
  try {
    return await Promise.race([
      Promise.resolve().then(()=>{combined.throwIfAborted();return call({signal:combined,timeoutMs});}),
      new Promise((_,reject)=>{onAbort=()=>reject(combined.reason);combined.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>controller.abort(new Error('Completion timeout')),timeoutMs);}),
    ]);
  } finally {clearTimeout(timer);if(onAbort)combined.removeEventListener('abort',onAbort);}
}
export async function completeTask({event,snapshot,selection,reminders,config,store,signal}) {
  const key='completion:'+event.id;
  let record=store.get(key);
  const reference=record?.reference ?? snapshot?.items[selection?.[0]?.number-(snapshot.page-1)*snapshot.pageSize-1];
  if (!reference || !['revision','fieldsRevision'].every(k=>/^[a-f0-9]{64}$/u.test(reference[k]??''))) return {
    status:'task_selection_needs_query',receipt:'旧回执缺少完成核对信息，或编号不在该页中。请重新查询后回复对应回执；未修改事项。',
  };
  if (reference.sourceId!==config.sourceId && config.sourceId) return {status:'task_completion_failed',code:'SCOPE_CHANGED',receipt:'任务账户与当前配置不符，未新增修改。'};
  const timeoutMs=config.queryTimeoutMs??15000;
  const read=async()=>{
    const response=await bounded(options=>reminders.readTasks({items:[{id:reference.id,listId:reference.listId}]},options),timeoutMs,signal);
    const row=response?.items?.[0], item=row?.value;
    if(response?.items?.length!==1||row?.id!==reference.id||row.state!=='ok'||item?.id!==reference.id||item.listId!==reference.listId||item.sourceId!==reference.sourceId)throw new Error('Task unavailable');
    return item;
  };
  const success=(item,already=false)=>({status:already?'task_already_completed':'task_completed',item,
    receipt:`${already?'当前已完成':'已完成并核验'}：${reference.title}`});
  const unknown=()=>({status:'task_completion_unknown',code:'RESULT_UNKNOWN',receipt:'完成操作的结果尚未核实。请保留原消息，先核对 Apple 提醒事项；系统只核对，不重复写入。'});
  const reconcile=async()=>{
    try {
      const item=await read();
      if(item.completed===true&&item.fieldsRevision===reference.fieldsRevision){const result=success(item);store.set(key,{...record,state:'done',result});return result;}
    } catch { /* Never reinterpret an unknown write as absent or blindly repeat it. */ }
    return unknown();
  };
  if(!record && store.entries('completion:').some(([,r])=>r.state==='write_started'&&r.reference.id===reference.id&&r.reference.sourceId===reference.sourceId))return unknown();
  if(!record && store.entries('maintenance:').some(([,p])=>p.actions.some(a=>a.state==='write_started'&&a.reference.id===reference.id&&a.reference.sourceId===reference.sourceId)))return unknown();
  if(record?.state==='done')return record.result??unknown();
  if(record?.state==='write_started')return reconcile();
  let current;
  try {current=await read();}catch(error){return {status:'task_completion_failed',code:error?.reason==='PERMISSION_DENIED'?'PERMISSION_DENIED':'READ_FAILED',receipt:'完成前读取核对失败，请检查事项及读取权限；未修改事项。'};}
  if(current.completed===true&&current.fieldsRevision===reference.fieldsRevision)return success(current,true);
  if(current.completed!==false||current.revision!==reference.revision||current.fieldsRevision!==reference.fieldsRevision)return {
    status:'task_completion_conflict',receipt:'该事项在查询后发生变化，请重新查询后操作；未修改事项。',
  };
  const operationId=createHash('sha256').update(JSON.stringify([config.accountId,event.id,'complete',reference.sourceId,reference.listId,reference.id])).digest('hex');
  record={event,reference,operationId,state:'write_started'};
  // This durable intent precedes every external write; all subsequent attempts are reconciliation only.
  store.set(key,record);
  try {
    await bounded(options=>reminders.completeTask({id:reference.id,listId:reference.listId,expectedRevision:reference.revision,fieldsRevision:reference.fieldsRevision},operationId,options),timeoutMs,signal);
  } catch(error) {
    if(error?.code==='WRITE_REJECTED') {
      const result={status:error.reason==='ITEM_CHANGED'?'task_completion_conflict':'task_completion_failed',code:error.reason??'WRITE_REJECTED',receipt:'完成操作被明确拒绝，请检查事项状态、列表可写性及权限；未修改事项。'};
      store.set(key,{...record,state:'done',result});return result;
    }
  }
  return reconcile();
}

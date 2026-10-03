import {createHash} from 'node:crypto';
import {bounded} from './complete-task.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fingerprint=value=>/^[a-f0-9]{64}$/u.test(value??'');
export function maintenanceControl(text) {
  const value=text.trim().replace(/[。！!]$/u,'');
  return /^(?:确认|确认执行|确认操作|确认完成)$/u.test(value)?'confirm':/^(?:取消|取消操作|取消执行)$/u.test(value)?'cancel':undefined;
}
function pendingItem(store,item) {
  return store.entries('completion:').some(([,r])=>r.state==='write_started'&&r.reference.id===item.id&&r.reference.sourceId===item.sourceId)
    || store.entries('maintenance:').some(([,p])=>p.actions.some(a=>a.state==='write_started'&&a.reference.id===item.id&&a.reference.sourceId===item.sourceId));
}
async function readItem(reminders,reference,listId,call) {
  const response=await call(options=>reminders.readTasks({items:[{id:reference.id,listId}]},options));
  const row=response?.items?.[0],item=row?.value;
  if(response?.items?.length!==1||row?.id!==reference.id||row.state!=='ok'||item?.id!==reference.id||item.sourceId!==reference.sourceId||item.listId!==listId)throw new Error('Task unavailable');
  return item;
}
async function targetFor(reminders,action,call) {
  // Also checks source writability for completion, using the original list name.
  const response=await call(options=>reminders.resolveTaskTarget({name:action.targetListName,sourceListId:action.reference.listId,sourceOnly:action.action==='complete'},options));
  if(response?.state!=='ok'||!response.list?.id||response.list.sourceId!==action.reference.sourceId||response.list.writable!==true
    ||(action.action==='complete'&&response.list.id!==action.reference.listId))throw new Error(response?.state??'TARGET_UNAVAILABLE');
  return response.list;
}
export async function proposeTaskPlan({event,queryEventId,snapshot,selection,reminders,config,store,signal}) {
  const failure=receipt=>({status:'task_plan_blocked',receipt:receipt+'；未修改事项。'});
  if(selection.some(x=>!['complete','move'].includes(x.action)))return failure('请分别发送定位和维护请求');
  const offset=(snapshot.page-1)*snapshot.pageSize;
  const actions=selection.map(choice=>({...choice,reference:snapshot.items[choice.number-offset-1],state:'pending'}));
  if(actions.some(a=>!a.reference?.id||!fingerprint(a.reference.revision)||!fingerprint(a.reference.fieldsRevision)||!fingerprint(a.reference.contentRevision)))return failure('编号不在原页中或旧回执缺少维护核对信息，请重新查询');
  if(actions.some(a=>config.sourceId&&a.reference.sourceId!==config.sourceId))return failure('账户与配置不符');
  const budgetSignal=AbortSignal.any([AbortSignal.timeout(180000),...(signal?[signal]:[])]);
  const call=fn=>bounded(fn,config.queryTimeoutMs??15000,budgetSignal);
  try {
    const targets=new Map();
    for(const action of actions) {
      const item=await readItem(reminders,action.reference,action.reference.listId,call);
      if(item.revision!==action.reference.revision||pendingItem(store,action.reference))return failure('所选事项已变化或有结果未核实的操作，请先核对并重新查询');
      if(action.action==='complete')action.targetListName=undefined;
      const key=JSON.stringify([action.reference.listId,action.targetListName]);
      if(!targets.has(key))targets.set(key,await targetFor(reminders,action,call));
      action.target=targets.get(key);
      if(action.action==='move'&&action.target.id!==action.reference.listId&&item.moveSupported===false)return failure('该事项含暂无法核验保留的复发或位置提醒字段，暂不能移动');
    }
  } catch {return failure('无法核对源事项或目标清单，请检查清单存在、名称唯一以及源和目标的读写权限');}
  // A newer proposal replaces only pending plans for this exact original query and owner.
  for(const [key,old]of store.entries('maintenance:'))if(old.state==='pending'&&old.queryEventId===queryEventId&&old.event.senderId===event.senderId&&old.event.conversationId===event.conversationId)store.set(key,{...old,state:'superseded'});
  const planId=hash([config.accountId,event.id,queryEventId,actions]);
  const receipt='待确认操作：\n'+actions.map(a=>`${a.number}. ${a.reference.title} — ${a.action==='complete'?'标记完成':'移动到 '+a.target.name}`).join('\n')+'\n\n请回复这条计划“确认执行”或“取消”。确认前未修改事项。';
  const plan={planId,event,queryEventId,actions,state:'pending'};store.set('maintenance:'+planId,plan);
  return {status:'task_plan_ready',planId,selected:actions.map(a=>({...a.reference,number:a.number,action:a.action,targetListName:a.targetListName})),receipt};
}
export async function executeTaskPlan({planId,event,control,reminders,config,store,signal}) {
  const key='maintenance:'+planId;let plan=store.get(key);
  const blocked=receipt=>({status:'task_plan_blocked',receipt});
  if(!plan||plan.event.senderId!==event.senderId||plan.event.conversationId!==event.conversationId||!config.allowedSenderIds.includes(event.senderId)||!config.allowedConversationIds.includes(event.conversationId))return blocked('这条计划不属于当前用户或会话，未新增修改。');
  if(plan.state==='done')return plan.result;
  if(['cancelled','superseded'].includes(plan.state))return blocked('该计划已取消或已被新计划替代，未新增修改。');
  if(control==='cancel') {
    if(plan.state!=='pending')return blocked('计划已开始执行，不能将已发生的操作当作取消。请核对逐项结果。');
    store.set(key,{...plan,state:'cancelled'});return {status:'task_plan_cancelled',planId,receipt:'已取消计划，未修改事项。'};
  }
  const budgetSignal=AbortSignal.any([AbortSignal.timeout(180000),...(signal?[signal]:[])]);
  const call=fn=>bounded(fn,config.queryTimeoutMs??15000,budgetSignal);
  if(plan.state==='pending') {
    // Preflight the whole plan again before the first business write.
    try {
      for(const action of plan.actions) {
        const item=await readItem(reminders,action.reference,action.reference.listId,call);
        const target=await targetFor(reminders,action,call);
        if(target.id!==action.target.id||item.revision!==action.reference.revision||pendingItem(store,action.reference)
          ||(action.action==='move'&&target.id!==action.reference.listId&&item.moveSupported===false))throw new Error('Plan changed');
      }
    } catch {return blocked('确认前核对失败，事项或清单已变化、无权限或有未决操作。请重新查询并生成计划；未修改事项。');}
    plan={...plan,state:'running',executionEvent:event};store.set(key,plan);
  }
  const save=()=>store.set(key,plan);
  for(const action of plan.actions) {
    if(['success','failed'].includes(action.state))continue;
    const ref=action.reference,targetId=action.action==='move'?action.target.id:ref.listId;
    const applied=item=>action.action==='complete'?item.completed===true&&item.fieldsRevision===ref.fieldsRevision:item.completed===ref.completed&&item.contentRevision===ref.contentRevision;
    const reconcile=async()=>{
      try {const item=await readItem(reminders,ref,targetId,call);if(applied(item)){action.state='success';action.result='已'+(action.action==='complete'?'完成':'移动到 '+action.target.name)+'并核验';save();return true;}}catch{}
      action.result='结果未知，系统只核对，不重复写入';save();return false;
    };
    if(action.state==='write_started'){await reconcile();continue;}
    try {
      const item=await readItem(reminders,ref,ref.listId,call);
      if(action.action==='move'&&targetId===ref.listId&&applied(item)){action.state='success';action.result='已在目标清单，未重复移动';save();continue;}
      if(item.revision!==ref.revision||pendingItem(store,ref))throw new Error('Item changed or pending');
      // Revalidate target permission/identity immediately before mutation as well.
      if((await targetFor(reminders,action,call)).id!==action.target.id)throw new Error('Target changed');
    } catch {action.state='failed';action.result='执行前核对失败，未执行';save();continue;}
    action.operationId=hash([planId,action.number,action.action,ref.id,action.target.id]);action.state='write_started';save();
    try {
      if(action.action==='complete')await call(options=>reminders.completeTask({id:ref.id,listId:ref.listId,expectedRevision:ref.revision,fieldsRevision:ref.fieldsRevision},action.operationId,options));
      else await call(options=>reminders.moveTask({id:ref.id,listId:ref.listId,targetListId:targetId,expectedRevision:ref.revision,contentRevision:ref.contentRevision},action.operationId,options));
    } catch(error) {
      if(error?.code==='WRITE_REJECTED'){action.state='failed';action.result='操作被明确拒绝，未执行';save();continue;}
    }
    await reconcile();
  }
  const all=plan.actions.every(a=>a.state==='success'),unknown=plan.actions.some(a=>a.state==='write_started');
  const result={status:all?'task_plan_completed':unknown?'task_plan_unknown':'task_plan_partial',planId,receipt:'操作结果：\n'+plan.actions.map(a=>`${a.number}. ${a.reference.title} — ${a.result}`).join('\n')+(unknown?'\n\n有结果尚未核实的事项，请保留原消息并核对Apple；不要另发请求重试。':'')};
  plan.result=result;if(!unknown)plan.state='done';save();return result;
}

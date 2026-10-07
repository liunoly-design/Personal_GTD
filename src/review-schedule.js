import {createHash,randomUUID} from 'node:crypto';
import {Temporal} from '@js-temporal/polyfill';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const validTime=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value);
export function openReviewSchedule({store,config,review,feishu,now=()=>new Date(),installLink}){
 const seed=config.review?.daily,timeZone=config.timeZone??'Asia/Shanghai';
 if(seed&&(timeZone!=='Asia/Shanghai'||!seed.senderId||!seed.conversationId||!config.allowedSenderIds.includes(seed.senderId)||!config.allowedConversationIds.includes(seed.conversationId)
   ||typeof seed.enabled!=='boolean'||(seed.time!==undefined&&!validTime(seed.time))||(seed.enabled&&!validTime(seed.time))
   ||(seed.enabledAt!==undefined&&!Number.isFinite(Date.parse(seed.enabledAt)))))throw new Error('INVALID_REVIEW_SCHEDULE');
 if(seed&&store.get('review-schedule')?.seed!==hash(seed))store.set('review-schedule',{...seed,seed:hash(seed),version:randomUUID()});
 const clock=()=>Temporal.Instant.from(new Date(now()).toISOString()).toZonedDateTimeISO(timeZone);
 const settings=()=>store.get('review-schedule');
 const authorized=()=>config.enabledModules?.includes('review')&&config.review?.readEnabled!==false&&config.review?.writeEnabled===true
   &&config.allowedSenderIds.includes(settings()?.senderId)&&config.allowedConversationIds.includes(settings()?.conversationId);
 const result=(status,extra={})=>({status,modelCalls:0,...extra});
 const unknowns=()=>store.entries('review-run:').map(([,r])=>r).filter(r=>r.state==='unknown');
 const write=run=>store.set('review-run:'+run.date,run);
 async function verify(run,message){
  let text;try{text=JSON.parse(message?.body?.content??'').text;}catch{}
  if(message?.chat_id!==run.conversationId||message?.msg_type!=='text'||message?.sender?.sender_type!=='app'
    ||message.deleted||message.updated||text!==run.text||!/^om_[\w-]+$/u.test(message?.message_id??''))throw new Error('SEND_RESULT_UNKNOWN');
  installLink(message.message_id,run);run.state='sent';run.messageId=message.message_id;write(run);return result('review_schedule_sent',{date:run.date,messageId:run.messageId});
 }
 async function reconcile(run){
  run.reconciliations=(run.reconciliations??0)+1;write(run);let pageToken;const matches=[];
  try{
   for(let page=0;page<2;page++){
    const value=await feishu.listMessages({conversationId:run.conversationId,startTime:Math.floor(Date.parse(run.startedAt)/1000)-60,endTime:Math.floor(Date.parse(run.startedAt)/1000)+3600,pageToken},{signal:AbortSignal.timeout(10000)});
    if(!Array.isArray(value?.items)||value.items.length>50)throw new Error('READBACK_FAILED');
    for(const m of value.items){let text;try{text=JSON.parse(m.body?.content??'').text;}catch{}if(text===run.text)matches.push(m);}
    if(!value.has_more){if(matches.length===1)return await verify(run,matches[0]);break;}pageToken=value.page_token;if(!pageToken)break;
   }
  }catch{/* Unknown stays unknown; no replay. */}
  return result('review_schedule_unknown',{date:run.date,receipt:'自动询问发送结果未知；保留问题和发送意图，仅核对既有会话，不重复发送。请发送“小婕 review 核对自动询问”或由维护者核对。'});
 }
 async function tick(){
  const s=settings();if(!seed||!s||!s.enabled)return result('review_schedule_disabled');
  if(!authorized())return result('review_schedule_forbidden');
  const uncertain=unknowns();if(uncertain.length){const run=uncertain[0];return run.reconciliations?result('review_schedule_unknown',{date:run.date}):reconcile(run);}
  const z=clock(),date=z.toPlainDate().toString(),due=Temporal.ZonedDateTime.from(`${date}T${s.time}:00[${timeZone}]`);
  if(Temporal.ZonedDateTime.compare(z,due)<0)return result('review_schedule_not_due');
  const previous=store.get('review-run:'+date);if(previous)return result('review_schedule_duplicate',{date,state:previous.state});
  if(s.enabledAt&&Temporal.Instant.compare(Temporal.Instant.from(s.enabledAt),due.toInstant())>0)return result('review_schedule_not_due');
  if(z.epochMilliseconds-due.epochMilliseconds>30*60000)return result('review_schedule_missed',{date});
  if(store.entries('review-run:').length>=1000)return result('review_schedule_capacity');
  const state=review?.scheduleState(s.senderId,s.conversationId);if(!state?.registered)return result('review_schedule_unregistered');
  if(state.pending||state.active||state.lastAsked===date)return result('review_schedule_waiting',{date});
  const id='om_auto_'+hash([config.accountId,s.senderId,s.conversationId,date]).slice(0,32);
  const question=await review.handle({id,senderId:s.senderId,conversationId:s.conversationId,sentAt:z.toInstant().toString(),text:'记录心得'});
  if(question.status!=='review_question'){write({date,state:'blocked',code:question.code??question.status,version:s.version});return result('review_schedule_blocked',{code:question.code??question.status});}
  const run={date,id,senderId:s.senderId,conversationId:s.conversationId,version:s.version,startedAt:z.toInstant().toString(),reviewLink:question.reviewLink,
    text:question.receipt+'\n询问编号：PGTD-REVIEW-'+id.slice(8),state:'unknown',reconciliations:0};write(run);
  try{const sent=await feishu.send({conversationId:s.conversationId,text:run.text,uuid:hash([config.accountId,id]).slice(0,32)},{signal:AbortSignal.timeout(10000)});
    if(sent?.chat_id!==run.conversationId||!/^om_[\w-]+$/u.test(sent?.message_id??''))throw new Error('SEND_RESULT_UNKNOWN');
    run.messageId=sent.message_id;write(run);return await verify(run,await feishu.getMessage(sent.message_id,{signal:AbortSignal.timeout(10000)}));
  }catch{return result('review_schedule_unknown',{date,receipt:'自动询问发送结果未知，未重发；下次仅只读核对。'});}
 }
 async function control(event,text){
  if(!['查询自动询问','暂停自动询问','恢复自动询问','核对自动询问'].includes(text)&&!/^设置自动询问(?:\s|$)/u.test(text))return null;
  const s=settings();if(!seed||!s)return result('review_schedule_unconfigured',{receipt:'尚未配置日度自动询问的本人会话，请维护者绑定授权目标；未启用周期。'});
  if(event.senderId!==s.senderId||event.conversationId!==s.conversationId)return result('review_schedule_forbidden',{receipt:'本自动询问仅配置本人会话可管理；未修改。'});
  if(text==='核对自动询问'){
   if(!authorized())return result('review_schedule_forbidden',{receipt:'Review读取/写入或身份授权已撤销；未核对或重发。'});
   const pending=unknowns();return pending.length?reconcile(pending[0]):result('review_schedule_status',{receipt:'没有待核对的自动询问；未发送。'});
  }
  if(text==='暂停自动询问'){s.enabled=false;s.version=randomUUID();store.set('review-schedule',s);}
  if(text==='恢复自动询问'||text.startsWith('设置自动询问')){
   const time=text==='恢复自动询问'?s.time:text.slice('设置自动询问'.length).trim();
   if(!validTime(time))return result('review_schedule_needs_time',{receipt:'请提供北京时间24小时制HH:mm：小婕 review 设置自动询问 HH:mm；未启用。'});
   if(!authorized())return result('review_schedule_forbidden',{receipt:'Review权限已撤销，未启用自动询问。'});
   s.enabled=true;s.time=time;s.enabledAt=clock().toInstant().toString();s.version=randomUUID();store.set('review-schedule',s);
  }
  return result('review_schedule_status',{schedule:{enabled:s.enabled,time:s.time??null,timeZone,version:s.version,unknown:unknowns().length},
    receipt:`日度DOPL自动询问：${s.enabled?'启用':'暂停'}\n北京时间：${s.time??'未确定'}（${timeZone}）\n配置版本：${s.version}\n待核对发送：${unknowns().length}\n只发三个引导问题，关联回复直接追加；未答复不催促/堆积；同日30分钟内有界补跑，暂停错过不补跑。\n修改：设置自动询问 HH:mm；暂停自动询问；恢复自动询问。`});
 }
 return {tick,control,state(){const s=settings();return seed&&s?{enabled:s.enabled,time:s.time??null,timeZone,version:s.version,unknown:unknowns().length}:null;}};
}

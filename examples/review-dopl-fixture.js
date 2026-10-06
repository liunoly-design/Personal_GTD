import { openFeishuCapture } from '../src/feishu-capture.js';
// Only external Feishu and Notes are substitutes. Persistence and routing are real.
export function doplFixture(directory, { bridgeFailure, beforeBridge, config: overrides = {}, bridge: providedBridge } = {}) {
  const config = {accountId:'default',entryAgentId:'xiaojie',allowedSenderIds:['ou_test','ou_other'],allowedConversationIds:['oc_test','oc_other'],
    enabledModules:['review'],timeZone:'Asia/Shanghai',review:{account:'synthetic',folder:'Notes',year:2026,allowCreate:true,writeEnabled:true},...overrides};
  const notes=[], messages=new Map(), sent=[], operations=[];
  const plain=body=>body.replaceAll('<br>','\n').replace(/<\/div>\s*<div>/gu,'\n').replace(/<[^>]+>/gu,'').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&amp;','&');
  const bridge=providedBridge ?? (async r=>{
    operations.push(r.command);
    beforeBridge?.(r);
    let value;
    if(r.command==='bind') value={accountId:'A',folderId:'F'};
    else if(r.command==='find') value=notes.filter(n=>n.title===r.title&&n.plaintext.includes(r.marker)).map(n=>({...n}));
    else if(r.command==='create') {const n={id:'synthetic-dopl-'+(notes.length+1),title:r.title,body:r.body,plaintext:plain(r.body),tagsComplete:true,headingsComplete:true};notes.push(n);value={...n};}
    else {const n=notes.find(n=>n.id===r.noteId);if(!n)throw new Error('LOCATION_NOT_UNIQUE');
      if(r.command==='replace'){if(n.body!==r.expectedBody)throw new Error('CONFLICT');n.body=r.body;n.plaintext=plain(n.body);}
      if(r.command==='append'){if(n.body!==r.expectedBody)throw new Error('CONFLICT');n.body+=r.addition;n.plaintext=plain(n.body);}
      value={...n};}
    bridgeFailure?.(r,value);return value;
  });
  const feishu={getMessage:async id=>messages.get(id),reply:async input=>{const r={message_id:'om_review_bot_'+(sent.length+1),chat_id:input.conversationId};sent.push({...input,...r});return r;}};
  let capture;
  const make=()=>openFeishuCapture({stateDir:directory,config,feishu,notesBridge:bridge,analyze:()=>{throw new Error('MODEL_MUST_NOT_RUN');}});
  capture=make();
  return {config,notes,operations,sent,messages,bridge,
    async send(id,text,{parent,sender='ou_test',chat='oc_test',sentAt='2026-10-06T10:00:00+08:00'}={}){
      messages.set(id,{message_id:id,chat_id:chat,sender:{id:sender,id_type:'open_id',sender_type:'user'},msg_type:'text',create_time:String(Date.parse(sentAt)),body:{content:JSON.stringify({text})},...(parent?{parent_id:parent}:{})});
      return capture.handle({Provider:'feishu',AccountId:'default',AgentId:'xiaojie',SenderId:sender,NativeChannelId:chat,MessageSid:id,rawText:text,...(parent?{ReplyToId:parent}:{})});},
    async restart(){await capture.close();capture=make();},recover:()=>capture.recover(),close:()=>capture.close()};
}

// External-system substitutes only; all routing, persistence and publication are real PGTD code.
import { openFeishuCapture } from '../src/feishu-capture.js';
import { sampleGuide } from './okr-sample.js';
import { join } from 'node:path';
export function standaloneFixture(directory, { bridgeFailure, guide = sampleGuide() } = {}) {
  const config={accountId:'default',entryAgentId:'xiaojie',allowedSenderIds:['ou_test','ou_other'],allowedConversationIds:['oc_test','oc_other'],enabledModules:['okr'],okr:{account:'synthetic',folder:'Notes',journalDir:join(directory,'journal')}};
  const notes=[], messages=new Map(), sent=[], operations=[];
  let guideCalls=0, capture;
  const plain=body=>body.replaceAll('<br>','\n').replace(/<[^>]+>/gu,'\n').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&amp;','&');
  const bridge=async r=>{
    operations.push(r.command);
    let value;
    if(r.command==='bind') value={accountId:'A',folderId:'F'};
    else if(r.command==='find') value=notes.filter(n=>n.title===r.title&&n.body.includes(r.marker)).map(n=>({...n}));
    else if(r.command==='create') {const n={id:'synthetic-note-'+(notes.length+1),title:r.title,body:r.body,plaintext:plain(r.body),nativeTags:[...new Set(plain(r.body).match(/#(?:O|KR)\d+/gu)??[])],tagsComplete:true,headingsComplete:true};notes.push(n);value={...n};}
    else {
      const n=notes.find(n=>n.id===r.noteId);
      if(!n) throw new Error('LOCATION_NOT_UNIQUE');
      if(['append','replace'].includes(r.command)) {
        if(n.body!==r.expectedBody) throw new Error('CONFLICT');
        n.body=r.command==='append'?n.body+r.addition:r.body;n.plaintext=plain(n.body);
        n.nativeTags=[...new Set(n.plaintext.match(/#(?:O|KR)\d+/gu)??[])];
      }
      value={...n};
    }
    bridgeFailure?.(r,value);
    return value;
  };
  const feishu={getMessage:async id=>messages.get(id),reply:async input=>{const reply={message_id:'om_bot_'+(sent.length+1),chat_id:input.conversationId};sent.push({...input,...reply});return reply;}};
  const make=()=>openFeishuCapture({stateDir:directory,config,feishu,notesBridge:bridge,okrGuide:async input=>{guideCalls++;return guide(input);}});
  capture=make();
  return {notes,operations,sent,config,bridge,get guideCalls(){return guideCalls;},
    async send(id,text,{parent,sender='ou_test',chat='oc_test'}={}) {
      messages.set(id,{message_id:id,chat_id:chat,sender:{id:sender,id_type:'open_id',sender_type:'user'},msg_type:'text',create_time:'1790474400000',body:{content:JSON.stringify({text})},...(parent?{parent_id:parent}:{})});
      return capture.handle({Provider:'feishu',AccountId:'default',AgentId:'xiaojie',SenderId:sender,NativeChannelId:chat,MessageSid:id,rawText:text,...(parent?{ReplyToId:parent}:{})});
    },
    async restart(){await capture.close();capture=make();},close:()=>capture.close(),
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeishuClient } from '../src/feishu-http.js';

test('复用飞书应用凭据获取原消息并回复，使用固定 API 且不访问正文链接',async()=>{
  const requests=[];
  const fetchImpl=async(url,options)=>{
    requests.push({url,options});
    const value=url.includes('/auth/')?{tenant_access_token:'test-token',expire:7200}:
      url.includes('/reply')?{data:{message_id:'om_bot',chat_id:'oc_test'}}:{data:{items:[{message_id:'om_test'}]}};
    return new Response(JSON.stringify({code:0,...value}));
  };
  const api=createFeishuClient({credentials:()=>({appId:'test-app',appSecret:'test-secret'}),fetchImpl});
  assert.equal((await api.getMessage('om_test')).message_id,'om_test');
  assert.equal((await api.reply({replyTo:'om_test',text:'链接 https://example.org',uuid:'a'.repeat(32)})).message_id,'om_bot');
  assert.equal(requests.length,3);
  assert.equal(requests[1].url,'https://open.feishu.cn/open-apis/im/v1/messages/om_test?user_id_type=open_id');
  assert.equal(requests[2].options.headers.Authorization,'Bearer test-token');
  assert.deepEqual(JSON.parse(requests[2].options.body),{msg_type:'text',content:JSON.stringify({text:'链接 https://example.org'}),uuid:'a'.repeat(32)});
});

test('HTTP 失败不重试，不暴露服务返回的凭据正文，拒绝大响应和无效消息 ID',async()=>{
  let calls=0;
  const api=createFeishuClient({credentials:()=>({appId:'test',appSecret:'secret'}),fetchImpl:async()=>{
    calls++;return new Response(JSON.stringify({code:123,msg:'secret private text'}));
  }});
  await assert.rejects(api.getMessage('om_test'),error=>!error.message.includes('secret'));
  assert.equal(calls,1);
  await assert.rejects(api.getMessage('../../outside'));
  assert.equal(calls,1);
  const huge=createFeishuClient({credentials:()=>({appId:'test',appSecret:'secret'}),fetchImpl:async()=>new Response('x'.repeat(131073))});
  await assert.rejects(huge.getMessage('om_test'),/Feishu request failed/);
});
test('自动询问只发送到明确会话；未知结果核对仅有界读取该会话',async()=>{
 const requests=[];const api=createFeishuClient({credentials:()=>({appId:'test',appSecret:'test'}),fetchImpl:async(url,options)=>{
  requests.push({url,options});return new Response(JSON.stringify({code:0,...(url.includes('/auth/')?{tenant_access_token:'test',expire:3600}:{data:url.includes('container_id')?{items:[],has_more:false}:{message_id:'om_auto',chat_id:'oc_test'}})}));
 }});
 assert.equal((await api.send({conversationId:'oc_test',text:'问题',uuid:'a'.repeat(32)})).message_id,'om_auto');await api.listMessages({conversationId:'oc_test',startTime:100,endTime:200});assert.equal(requests.length,3);assert.equal(requests[1].url,'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id');assert.equal(JSON.parse(requests[1].options.body).receive_id,'oc_test');assert.match(requests[2].url,/page_size=50/);await assert.rejects(api.send({conversationId:'../../outside',text:'问题'}));assert.equal(requests.length,3);
});

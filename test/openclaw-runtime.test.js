import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntime } from '../openclaw/runtime.js';

test('凭据冷启动在收集运行时就绪前完成，不占用任务分析时限', async t => {
  const dir=mkdtempSync(join(tmpdir(),'pgtd-runtime-'));
  let runtime, reads=0;
  t.after(async()=>{await runtime?.close();rmSync(dir,{recursive:true,force:true});});
  const runtimeConfigPath=join(dir,'config.json');
  writeFileSync(runtimeConfigPath,JSON.stringify({sourceId:'synthetic-source',listId:'synthetic-inbox',remindersHelperPath:join(dir,'synthetic-helper'),
    usagePath:join(dir,'usage.sqlite'),model:{maxBudgetUsd:.1,maxCalls:2,timeoutMs:1}}));
  const config={accountId:'default',entryAgentId:'xiaojie',allowedSenderIds:['ou_test'],allowedConversationIds:['oc_test'],
    stateDir:join(dir,'state'),runtimeConfigPath};
  let release;
  const ready=new Promise(resolve=>{release=resolve;});
  let opened=false;
  const opening=openRuntime({config,hostConfig:{channels:{feishu:{appId:'synthetic',appSecret:'synthetic'}}},
    googleKey:()=>async()=>{reads++;await ready;return 'synthetic-key';}}).then(value=>{runtime=value;opened=true;});
  await new Promise(resolve=>setTimeout(resolve,20));
  try {assert.equal(reads,1);assert.equal(opened,false);} finally {release();await opening;}
  assert.equal(opened,true);
});

test('插件运行时缺少绝对helper配置在凭据准备和服务调用前拒绝启动', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-runtime-helper-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const runtimeConfigPath = join(dir, 'config.json');
  let reads = 0;
  for (const remindersHelperPath of [undefined, 'relative/helper']) {
    writeFileSync(runtimeConfigPath, JSON.stringify({ sourceId: 'S', remindersHelperPath,
      usagePath: join(dir, 'usage.sqlite'), model: { maxBudgetUsd: .1, maxCalls: 2 } }));
    await assert.rejects(openRuntime({ config: { runtimeConfigPath, stateDir: join(dir, 'state') }, hostConfig: {},
      googleKey: () => async () => { reads++; return 'synthetic'; } }), /Absolute Reminders helper path required/);
  }
  assert.equal(reads, 0);
});

test('运行时可信查询使用配置的helper，飞书与模型全部为合成边界', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-runtime-query-'));
  let runtime;
  const originalFetch = globalThis.fetch;
  t.after(async () => { globalThis.fetch = originalFetch; await runtime?.close(); rmSync(dir, { recursive: true, force: true }); });
  const remindersHelperPath = join(dir, 'synthetic-helper');
  const value = { state: 'ok', list: { id: 'L', sourceId: 'S', name: 'Inbox' }, total: 1, hasMore: false,
    items: [{ id: 'manual-1', listId: 'L', title: '合成运行时任务', completed: false }] };
  writeFileSync(remindersHelperPath, '#!' + process.execPath + '\nprocess.stdin.resume();process.stdin.on("end",()=>console.log(' + JSON.stringify(JSON.stringify({ ok: true, value })) + '));\n', { mode: 0o700 });
  const runtimeConfigPath = join(dir, 'config.json');
  writeFileSync(runtimeConfigPath, JSON.stringify({ sourceId: 'S', listId: 'L', remindersHelperPath,
    usagePath: join(dir, 'usage.sqlite'), model: { maxBudgetUsd: .1, maxCalls: 2 } }));
  let replies = 0;
  globalThis.fetch = async url => {
    assert.ok(String(url).startsWith('https://open.feishu.cn/'), 'No paid model calls');
    let response;
    if (url.includes('tenant_access_token')) response = { code: 0, tenant_access_token: 'synthetic', expire: 3600 };
    else if (url.includes('/reply')) { replies++; response = { code: 0, data: { message_id: 'om_synth_reply', chat_id: 'oc_test' } }; }
    else response = { code: 0, data: { items: [{ message_id: 'om_synth_query', chat_id: 'oc_test', sender: { id: 'ou_test', id_type: 'open_id', sender_type: 'user' },
      msg_type: 'text', create_time: String(Date.now()), body: { content: JSON.stringify({ text: '小婕 gtd 查询任务' }) } }] } };
    return new Response(JSON.stringify(response));
  };
  runtime = await openRuntime({ config: { accountId: 'default', entryAgentId: 'xiaojie', allowedSenderIds: ['ou_test'], allowedConversationIds: ['oc_test'],
    stateDir: join(dir, 'state'), runtimeConfigPath }, hostConfig: { channels: { feishu: { appId: 'synthetic', appSecret: 'synthetic' } } }, googleKey: () => async () => 'synthetic' });
  const result = await runtime.handle({ Provider: 'feishu', AccountId: 'default', AgentId: 'xiaojie', SenderId: 'ou_test', NativeChannelId: 'oc_test',
    MessageSid: 'om_synth_query', rawText: '小婕 gtd 查询任务' });
  assert.equal(result.status, 'tasks_found');
  assert.equal(result.items[0].id, 'manual-1');
  assert.equal(result.delivery, 'sent');
  assert.equal(replies, 1);
});

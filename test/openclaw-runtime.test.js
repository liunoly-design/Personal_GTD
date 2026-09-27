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
  writeFileSync(runtimeConfigPath,JSON.stringify({sourceId:'synthetic-source',listId:'synthetic-inbox',
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

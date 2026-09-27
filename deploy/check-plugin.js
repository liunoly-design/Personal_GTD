import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const isolated=mkdtempSync(join(tmpdir(),'pgtd-plugin-check-'));
try {
  const configPath=join(isolated,'openclaw.json');
  writeFileSync(configPath,JSON.stringify({gateway:{mode:'local'},plugins:{allow:['personal-gtd'],load:{paths:[root]},
    entries:{'personal-gtd':{enabled:true,config:{enabled:true,accountId:'default',entryAgentId:'xiaojie',
      allowedSenderIds:['ou_test'],allowedConversationIds:['oc_test'],stateDir:join(isolated,'unused'),runtimeConfigPath:join(isolated,'unused.json')}}}}}));
  const output=execFileSync('openclaw',['plugins','doctor','--json'],{encoding:'utf8',maxBuffer:4*1024*1024,
    env:{...process.env,OPENCLAW_STATE_DIR:isolated,OPENCLAW_CONFIG_PATH:configPath}});
  const value=JSON.parse(output);
  if (!value.ok) throw new Error('Isolated plugin doctor failed');
  const inspected=JSON.parse(execFileSync('openclaw',['plugins','inspect','personal-gtd','--runtime','--json'],{encoding:'utf8',maxBuffer:4*1024*1024,
    env:{...process.env,OPENCLAW_STATE_DIR:isolated,OPENCLAW_CONFIG_PATH:configPath}}));
  if(inspected.plugin?.status!=='loaded' || !inspected.typedHooks?.some(h=>h.name==='reply_dispatch')) throw new Error('Plugin hook not loaded');
  console.log(JSON.stringify({isolated:true,doctorOk:value.ok,status:inspected.plugin.status,typedHooks:inspected.typedHooks,services:inspected.services},null,2));
} finally {rmSync(isolated,{recursive:true,force:true});}

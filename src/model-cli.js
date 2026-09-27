import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';
import { openDurableCapture } from './durable-capture.js';
import { openPersistentSimulation } from './persistent-simulation.js';
import { openAppleReminders } from './apple-reminders.js';
import { openGeminiAnalyzer } from './gemini.js';
import { openClawGoogleKey } from './openclaw-auth.js';

async function main() {
  const args=process.argv.slice(2);
  let configPath, stateDir, recover=false, appleMode=false;
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--recover'){recover=true;continue;}
    if(args[i]==='--apple'){appleMode=true;continue;}
    if(!['--config','--state-dir'].includes(args[i]) || !args[i+1]) throw new Error('Invalid arguments');
    if(args[i]==='--config') configPath=args[++i]; else stateDir=args[++i];
  }
  if(!configPath || !stateDir) throw new Error('Config and state directory required');
  const {model:modelConfig={},usagePath,authAgent='gtd',openclawPackageDir,...captureConfig}=JSON.parse(await readFile(configPath,'utf8'));
  if(!usagePath) throw new Error('Shared monetary budget ledger required');
  const state=resolve(stateDir);
  const model=openGeminiAnalyzer({statePath:resolve(usagePath),config:modelConfig,
    apiKey:openClawGoogleKey({agentId:authAgent,...(openclawPackageDir?{packageDir:openclawPackageDir}:{})})});
  let external, capture;
  const print=result=>console.log(JSON.stringify({mode:appleMode?'apple':'simulation',
    analysisMode:result.analysis?.mode ?? 'none',result:{...result,
    receipt:result.receipt?.replace('【模拟】',appleMode?'【Apple】':'【模拟 Apple】')??null}}));
  try {
    external=appleMode?openAppleReminders({...captureConfig,statePath:join(state,'adapter.sqlite')})
      :openPersistentSimulation({path:join(state,'external.sqlite')});
    capture=openDurableCapture({journalPath:join(state,'capture.sqlite'),reminders:external,
      analyze:model.analyze,config:{...captureConfig,modelIntents:true}});
    if(recover){for(const result of await capture.recover())print(result);return;}
    let count=0;
    for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})) {
      if(!line.trim())continue;
      if(++count>1000)throw new Error('Input capacity reached');
      let event;try{event=JSON.parse(line);}catch{print({status:'invalid_event'});continue;}
      print(await capture.handle(event));
    }
  } finally {await capture?.close();external?.close();await model.close();}
}
main().catch(()=>{console.error('模型收集未完成，请检查授权、预算、配置和恢复状态；不会输出凭据或服务错误正文。');process.exitCode=1;});

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const args=process.argv.slice(2), index=args.indexOf('--agent');
const agentId=index<0?'gtd':args[index+1];
const config=JSON.parse(readFileSync(join(homedir(),'.openclaw/openclaw.json'),'utf8'));
const agent=config.agents?.entries?.[agentId];
if(!agent)throw new Error('Requested agent not configured');
console.log(JSON.stringify({agentId,openclaw:execFileSync('openclaw',['--version'],{encoding:'utf8'}).trim(),
  model:agent.model??config.agents?.defaults?.model,appleBridgeBuilt:existsSync('runtime/bin/pgtd-reminders'),
  appleConfigured:existsSync('runtime/apple/config.json'),
  entryInstalled:false,reason:'任务 06 的可信飞书事件入口和回执接入尚未实施；已有 agent 不等于已安装收集业务。'},null,2));

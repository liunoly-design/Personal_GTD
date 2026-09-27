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
  entryConfigured:config.plugins?.entries?.['personal-gtd']?.enabled===true,
  captureEnabled:config.plugins?.entries?.['personal-gtd']?.config?.enabled===true,
  liveIntegrationVerified:false,reason:'这里只检查本地配置；请用 plugins inspect --runtime 核对加载，并执行安装交接文档中的真实验收。'},null,2));

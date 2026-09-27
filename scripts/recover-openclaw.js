import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { openRuntime } from '../openclaw/runtime.js';
async function main() {
  const args=process.argv.slice(2);
  if(args.length!==5 || args[0]!=='--config' || args[2]!=='--host-config' || args[4]!=='--run'
    || !isAbsolute(args[1]) || !isAbsolute(args[3])) throw new Error('Explicit config paths and --run required');
  const config=JSON.parse(await readFile(args[1],'utf8'));
  const hostConfig=JSON.parse(await readFile(args[3],'utf8'));
  const runtime=await openRuntime({config,hostConfig});
  try {
    const results=await runtime.recover();
    console.log(JSON.stringify({results:results.map(({status,delivery,recovery})=>({status,delivery,recovery}))}));
  } finally {await runtime.close();}
}
main().catch(()=>{console.error('恢复未完成：请停止使用同一状态目录的网关插件，核对配置、已解析凭据及剩余预算；不要删除日志或重发新消息。');process.exitCode=1;});

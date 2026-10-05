// Deterministic reads of the accepted document. Never discover a note by title.
export function okrQueryInstruction(instruction) {
  const match=instruction.trim().match(/^(?:(?:请)?(?:帮我)?(?:查询|查一下|查|查看|看看|看一下|看|找一下|找|列出)\s*(?:当前|现在|我的)?(?:已确认)?(?:目标|OKR)|(?:当前|现在的)(?:已确认)?目标(?:是什么|有哪些)?)(?:\s+第([1-9]\d?)页)?[？?。]?$/iu);
  return match ? { action:'query', text:'', page:Number(match[1] ?? 1) } : null;
}
export async function queryCurrentOkr({ latest, binding, location = {}, pending, bridge, page=1, now=()=>new Date().toISOString() }) {
  const fail=(status,receipt)=>({status,receipt,contentGenerationCalls:0});
  if(pending) return fail('okr_query_recovery_required','最新稿更新结果尚未核实，请先核对并恢复原定稿消息，再查询当前目标。');
  if(!latest?.id || !binding?.accountId || !binding?.folderId) return fail('okr_query_needs_binding','尚未绑定当前已确认目标文档，请明确要绑定的现有笔记；未按标题选择或新建。');
  if(!Number.isSafeInteger(page)||page<1||page>64) return fail('okr_query_invalid_page','页码须为1至64，请重新查询当前目标。');
  let note,timer;
  try {
    note=await Promise.race([Promise.resolve().then(()=>bridge({command:'read',accountId:binding.accountId,folderId:binding.folderId,noteId:latest.id})),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('APPLE_TIMEOUT')),60000);})]);
  } catch(error) {
    if(['PERMISSION_DENIED','ACCESSIBILITY_DENIED'].includes(error.message)) return fail('okr_query_forbidden','没有读取当前目标的权限，请检查Notes自动化或辅助功能权限。');
    if(error.message==='LOCATION_NOT_UNIQUE') return fail('okr_query_missing','绑定文档不存在或已离开绑定位置，请核对原笔记；未按同名标题替换。');
    if(['RESPONSE_TOO_LARGE','CAPACITY_EXCEEDED'].includes(error.message)) return fail('okr_query_too_large','目标文档超出读取容量，本次未返回截断稿。');
    return fail('okr_query_failed','当前目标读取失败'+(error.message==='APPLE_TIMEOUT'?'（超时）':'')+'，请稍后用新消息查询；不能据此判断为空。');
  } finally {clearTimeout(timer);}
  if(note?.id!==latest.id || typeof note.plaintext!=='string') return fail('okr_query_failed','当前目标读回身份或正文不完整，请核对绑定文档。');
  const readAt=now();
  const source={noteId:note.id,title:typeof note.title==='string'?note.title.slice(0,200):'当前已确认目标',accountId:binding.accountId,folderId:binding.folderId,account:location.account ?? binding.accountId,folder:location.folder ?? binding.folderId};
  const scope={kind:'confirmed-current-goals',accountId:binding.accountId,folderId:binding.folderId};
  const meta={source,scope,readAt,contentGenerationCalls:0};
  const label=`来源：${source.title}；账户/文件夹：${source.account}/${source.folder}；笔记ID：${note.id}\n范围：绑定的当前已确认目标；读取时间：${readAt}`;
  if(note.plaintext.length>65536) return {...meta,...fail('okr_query_too_large',label+'\n目标正文超过65536字符，本次未返回截断稿。')};
  if(!note.plaintext.trim()) return {...meta,...fail('okr_query_empty',label+'\n当前目标文档为空。')};
  const markers=note.plaintext.match(/PGTD-FINAL-[0-9a-f-]{36}/gu)??[];
  if(!markers.length || (latest.marker && !markers.includes(latest.marker))) return {...meta,...fail('okr_query_unconfirmed',label+'\n未核实这是已确认最新稿，不能把讨论稿或未确认草案作为当前目标。')};
  const content=note.plaintext.replace(/^\s*PGTD OKR 最新稿\s*\n/u,'').replace(/PGTD-FINAL-[0-9a-f-]{36}/gu,'').trim();
  if(!content) return {...meta,...fail('okr_query_empty',label+'\n当前目标正文为空。')};
  const characters=Array.from(content);
  const pages=Math.ceil(characters.length/2000);
  if(page>pages) return {...meta,...fail('okr_query_invalid_page',label+`\n当前共${pages}页，请选择有效页码。`)};
  const start=(page-1)*2000;
  return {...meta,status:'okr_query',page,pages,content:characters.slice(start,start+2000).join(''),receipt:label+`\n第${page}/${pages}页（正文字符${start+1}–${Math.min(start+2000,characters.length)}）\n`+characters.slice(start,start+2000).join('')+(page<pages?`\n继续读取：小婕 okr 查询当前目标 第${page+1}页（实时重新读取）`:'')};
}

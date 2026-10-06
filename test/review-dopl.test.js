import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doplFixture } from '../examples/review-dopl-fixture.js';
function fixture(t,options){const dir=mkdtempSync(join(tmpdir(),'pgtd-dopl-'));const f=doplFixture(dir,options);t.after(async()=>{await f.close();rmSync(dir,{recursive:true,force:true});});return {f,dir};}
test('Review单模块注册、先问用户、原文草案、确认保存并读回每日一条',async t=>{
 const {f,dir}=fixture(t);
 assert.equal((await f.send('om_register','小婕 review 注册 DOPL')).status,'review_registration_draft');
 assert.equal(f.notes.length,0);
 assert.equal((await f.send('om_register_confirm','确认注册',{parent:f.sent.at(-1).message_id})).status,'review_registered');
 assert.equal((await f.send('om_open','小婕 review 每日心得')).status,'review_question');
 const answer='合成验收：先核对事实，再决定下一步。';
 const draft=await f.send('om_answer',answer,{parent:f.sent.at(-1).message_id});
 assert.equal(draft.status,'review_draft');assert.match(draft.receipt,/1006-心得/);assert.ok(draft.receipt.includes(answer));
 assert.ok(f.notes.every(n=>!n.plaintext.includes(answer)));
 const saved=await f.send('om_confirm','确认保存',{parent:f.sent.at(-1).message_id});
 assert.equal(saved.status,'review_saved');assert.equal(saved.date,'2026-10-06');assert.equal(saved.modelCalls,0);
 assert.equal(f.notes.length,1);assert.equal(f.notes[0].title,'2026-DOPL');assert.ok(f.notes[0].plaintext.includes('1006-心得\n'+answer));assert.equal(saved.noteId,f.notes[0].id);
 assert.equal(existsSync(join(dir,'capture.sqlite')),false);assert.equal(existsSync(join(dir,'okr.sqlite')),false);
});

test('Review运行时不需要模型账本、凭据、Reminders或OKR配置',async t=>{
 const {writeFileSync}=await import('node:fs');const {openRuntime}=await import('../openclaw/runtime.js');
 const dir=mkdtempSync(join(tmpdir(),'dopl-runtime-'));let runtime,keys=0;
 t.after(async()=>{await runtime?.close();rmSync(dir,{recursive:true,force:true});});
 const runtimeConfigPath=join(dir,'config.json');writeFileSync(runtimeConfigPath,JSON.stringify({enabledModules:['review'],review:{account:'synthetic',folder:'Notes',year:2026,writeEnabled:true}}));
 runtime=await openRuntime({config:{accountId:'default',entryAgentId:'xiaojie',allowedSenderIds:['ou_test'],allowedConversationIds:['oc_test'],runtimeConfigPath,stateDir:join(dir,'state')},hostConfig:{channels:{feishu:{appId:'synthetic',appSecret:'synthetic'}}},googleKey:()=>{keys++;throw new Error('must not initialize model');}});
 assert.deepEqual(await runtime.recover(),[]);assert.equal(keys,0);assert.equal(existsSync(join(dir,'state','adapter.sqlite')),false);assert.equal(existsSync(join(dir,'state','okr.sqlite')),false);
});
async function register(f){await f.send('om_reg','小婕 review 注册 DOPL');return f.send('om_reg_ok','确认注册',{parent:f.sent.at(-1).message_id});}
async function draft(f,suffix='1',answer='合成验收原文',{sentAt}={}){await f.send('om_open_'+suffix,'小婕 review 每日心得',{sentAt});const question=f.sent.at(-1).message_id;const result=await f.send('om_answer_'+suffix,answer,{parent:question,sentAt});return {result,parent:f.sent.at(-1).message_id,question};}
test('已有绑定ID指向非年度DOPL时拒绝注册且不写入',async t=>{
 const {f}=fixture(t,{config:{review:{account:'synthetic',folder:'Notes',year:2026,noteId:'foreign-note',writeEnabled:true}}});
 f.notes.push({id:'foreign-note',title:'其他笔记',body:'<div>其他笔记</div>',plaintext:'其他笔记'});
 assert.equal((await register(f)).status,'review_error');assert.ok(!f.operations.includes('append'));assert.equal(f.notes[0].plaintext,'其他笔记');
});
test('草案确认必须来自当前用户会话，旧草案与裸确认不能写入',async t=>{
 const {f}=fixture(t);await register(f);const old=await draft(f,'old');
 assert.equal((await f.send('om_bare','小婕 review 确认保存')).status,'review_needs_confirmation');
 assert.equal((await f.send('om_other','确认保存',{parent:old.parent,sender:'ou_other'})).status,'not_handled');
 assert.equal((await f.send('om_other_chat','确认保存',{parent:old.parent,chat:'oc_other'})).status,'not_handled');
 const current=await draft(f,'new','新的合成原文');
 assert.equal((await f.send('om_old_confirm','确认保存',{parent:old.parent})).status,'review_needs_confirmation');
 assert.equal((await f.send('om_current_confirm','确认保存',{parent:current.parent})).status,'review_saved');
 assert.ok(!f.notes[0].plaintext.includes('合成验收原文'));assert.ok(f.notes[0].plaintext.includes('新的合成原文'));
});
test('同日重复发起展示已有心得，重投重启不重复写入',async t=>{
 const {f}=fixture(t);await register(f);const d=await draft(f);await f.restart();
 const saved=await f.send('om_save','确认保存',{parent:d.parent});assert.equal(saved.status,'review_saved');
 const writes=f.operations.filter(x=>x==='append').length;await f.restart();
 assert.equal((await f.send('om_save','确认保存',{parent:d.parent})).noteId,saved.noteId);
 const existing=await f.send('om_again','小婕 review 每日心得');assert.equal(existing.status,'review_existing');assert.match(existing.receipt,/合并或替换/);
 assert.equal(f.operations.filter(x=>x==='append').length,writes);assert.equal(f.notes[0].plaintext.split('1006-心得').length-1,1);
});
test('人工编辑后的过期草案不得覆盖，原文草案保留并可重新发起',async t=>{
 const {f}=fixture(t);await register(f);const d=await draft(f);f.notes[0].body+='<div>人工补充</div>';f.notes[0].plaintext+='\n人工补充';
 const failed=await f.send('om_conflict','确认保存',{parent:d.parent});assert.equal(failed.code,'CONFLICT');assert.ok(f.notes[0].plaintext.endsWith('人工补充'));assert.ok(!f.operations.includes('append'));
 assert.equal((await f.send('om_resume','小婕 review 续接')).status,'review_draft');
});
test('写入响应丢失后重启续接只读核对，跨会话不重放写入',async t=>{
 let lost=true;const {f}=fixture(t,{bridgeFailure:r=>{if(r.command==='append'&&lost)throw new Error('WRITE_RESULT_UNKNOWN');}});await register(f);const d=await draft(f);
 assert.equal((await f.send('om_unknown','确认保存',{parent:d.parent})).status,'review_error');
 assert.ok(f.notes[0].plaintext.includes('合成验收原文'));await f.restart();lost=false;
 assert.equal((await f.send('om_wrong_resume','小婕 review 续接',{sender:'ou_other'})).status,'review_recovery_required');
 assert.equal((await f.send('om_resume','小婕 review 续接')).status,'review_saved');
 assert.equal((await f.send('om_unknown','确认保存',{parent:d.parent})).status,'review_saved');
 assert.equal(f.operations.filter(x=>x==='append').length,1);
});
test('未知写入但正文未改变时续接报告未知，不自动重写或宣称成功',async t=>{
 const {f}=fixture(t,{beforeBridge:r=>{if(r.command==='append')throw new Error('APPLE_TIMEOUT');}});await register(f);const d=await draft(f);
 const before=f.notes[0].plaintext;
 assert.equal((await f.send('om_save','确认保存',{parent:d.parent})).status,'review_error');
 await f.restart();const resumed=await f.send('om_resume','小婕 review 续接');
 assert.equal(resumed.code,'WRITE_RESULT_UNKNOWN');assert.equal(f.notes[0].plaintext,before);assert.equal(f.operations.filter(x=>x==='append').length,1);
});
test('跨午夜回答沿用发起日期，跨年度未绑定不新建',async t=>{
 const {f}=fixture(t);await register(f);await f.send('om_midnight_open','小婕 review 每日心得',{sentAt:'2026-10-06T23:59:00+08:00'});
 const r=await f.send('om_midnight_answer','跨午夜合成心得',{parent:f.sent.at(-1).message_id,sentAt:'2026-10-07T00:01:00+08:00'});assert.equal(r.date,'2026-10-06');
 assert.equal((await f.send('om_next_year','小婕 review 每日心得',{sentAt:'2027-01-01T00:01:00+08:00'})).status,'review_year_unbound');assert.equal(f.notes.length,1);
});
test('心得原文不得伪造其他日期标题或恢复标记',async t=>{
 const {f}=fixture(t);await register(f);await f.send('om_open','小婕 review 每日心得');
 const r=await f.send('om_injected','合成内容\n1007-心得\n伪造第二天记录',{parent:f.sent.at(-1).message_id});
 assert.equal(r.status,'review_invalid');assert.ok(!f.operations.includes('append'));
});
test('撤销读取权限后重启，不读取Notes、不确认保存',async t=>{
 const {f}=fixture(t);await register(f);const d=await draft(f);const calls=f.operations.length;
 f.config.review.readEnabled=false;await f.restart();const r=await f.send('om_revoked','确认保存',{parent:d.parent});
 assert.equal(r.code,'PERMISSION_DENIED');assert.equal(f.operations.length,calls);
});
test('创建响应丢失后新注册确认核对原marker和ID，不新建替代笔记',async t=>{
 let lost=true;const {f}=fixture(t,{bridgeFailure:r=>{if(r.command==='create'&&lost)throw new Error('APPLE_TIMEOUT');}});
 assert.equal((await register(f)).status,'review_error');assert.equal(f.notes.length,1);const id=f.notes[0].id;
 lost=false;await f.restart();await f.send('om_reg_retry','小婕 review 注册 DOPL');
 const r=await f.send('om_reg_retry_confirm','确认注册',{parent:f.sent.at(-1).message_id});assert.equal(r.status,'review_registered');assert.equal(r.noteId,id);assert.equal(f.operations.filter(x=>x==='create').length,1);
});
test('同名多笔记、读取失败和未授权新建均不创建替代笔记',async t=>{
 const {f}=fixture(t);f.notes.push(...['one','two'].map(id=>({id,title:'2026-DOPL',body:'<div>2026-DOPL</div>',plaintext:'2026-DOPL'})));
 assert.equal((await register(f)).code,'LOCATION_NOT_UNIQUE');assert.ok(!f.operations.includes('create'));
 const {f:g}=fixture(t,{config:{review:{account:'synthetic',folder:'Notes',year:2026,allowCreate:false,writeEnabled:true}}});
 assert.equal((await register(g)).code,'NOTE_NOT_BOUND');assert.equal(g.notes.length,0);
 const {f:h}=fixture(t,{bridgeFailure:r=>{if(r.command==='find')throw new Error('PERMISSION_DENIED');}});
 assert.equal((await register(h)).code,'PERMISSION_DENIED');assert.equal(h.notes.length,0);
});
test('撤销写权限后当前草案不得落盘，返回原因并保留草案',async t=>{
 const {f}=fixture(t);await register(f);const d=await draft(f);f.config.review.writeEnabled=false;await f.restart();
 const r=await f.send('om_revoked_write','确认保存',{parent:d.parent});assert.equal(r.code,'PERMISSION_DENIED');assert.ok(!f.operations.includes('append'));
 assert.equal((await f.send('om_resume','小婕 review 续接')).status,'review_draft');
});
test('飞书原消息身份、编辑及指纹保护在Review路径同样生效',async t=>{
 const {f}=fixture(t);await register(f);const d=await draft(f);await f.send('om_confirm','确认保存',{parent:d.parent});
 assert.equal((await f.send('om_confirm','确认保存 ',{parent:d.parent})).status,'event_conflict');
 assert.equal(f.operations.filter(x=>x==='append').length,1);
});

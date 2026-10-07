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

async function saveOriginal(f){await register(f);const d=await draft(f,'initial','原心得：先核对事实。');await f.send('om_initial_save','确认保存',{parent:d.parent});}
async function revise(f,mode,suffix,answer){
 const existing=await f.send('om_existing_'+suffix,'小婕 review 每日心得');
 const choiceParent=f.sent.at(-1).message_id;
 const question=await f.send('om_choose_'+suffix,mode,{parent:choiceParent});
 const draft=await f.send('om_revision_'+suffix,answer,{parent:f.sent.at(-1).message_id});
 return {existing,question,draft,parent:f.sent.at(-1).message_id};
}
test('同日合并必须先选择、询问补充、展示完整草案，确认保留一条与旧原文历史',async t=>{
 const {f}=fixture(t);await saveOriginal(f);const before=f.notes[0].plaintext;
 const r=await revise(f,'合并','merge','补充：再决定行动。');
 assert.equal(r.existing.status,'review_existing');assert.equal(r.question.status,'review_question');
 assert.equal(r.draft.status,'review_draft');assert.match(r.draft.receipt,/原心得：先核对事实。\n补充：再决定行动。/);
 assert.equal(f.notes[0].plaintext,before);
 const saved=await f.send('om_merge_save','确认保存',{parent:r.parent});assert.equal(saved.status,'review_revised');
 const note=f.notes[0].plaintext;assert.equal(note.split('1006-心得').length-1,1);
 assert.match(note,/1006-心得\n原心得：先核对事实。\n补充：再决定行动。\nPGTD-DOPL-ENTRY-/);
 assert.match(note,/修订历史 2026-10-06（合并）\n旧心得原文\n原心得：先核对事实。\nPGTD-DOPL-HISTORY-END-/);
 assert.equal(f.operations.filter(x=>x==='replace').length,1);assert.equal(saved.modelCalls,0);
});

test('显式日期补记沿用原日期，缺失/相对/非法/未来日期不猜测不写入',async t=>{
 const {f}=fixture(t);await register(f);
 for(const [i,text] of ['补记','补记 昨天','补记 2026-02-30','补记 2026-10-07','补记 2026-10-01 额外文字'].entries()){
  const r=await f.send('om_bad_date_'+i,'小婕 review '+text);assert.equal(r.status,'review_needs_date');
 }
 assert.ok(!f.operations.includes('append'));
 const q=await f.send('om_backfill','小婕 review 补记 2026-10-01');assert.equal(q.status,'review_question');assert.equal(q.date,'2026-10-01');
 const d=await f.send('om_backfill_answer','显式补记合成原文',{parent:f.sent.at(-1).message_id,sentAt:'2026-10-07T01:00:00+08:00'});
 assert.equal(d.date,'2026-10-01');
 const saved=await f.send('om_backfill_save','确认保存',{parent:f.sent.at(-1).message_id});assert.equal(saved.status,'review_saved');
 assert.match(f.notes[0].plaintext,/1001-心得\n显式补记合成原文/);assert.ok(!f.notes[0].plaintext.includes('1006-心得'));
});

test('跨年补记只写显式年度ID，重启/响应丢失核对同一历史年度',async t=>{
 let lost=true;const {f}=fixture(t,{config:{review:{account:'synthetic',folder:'Notes',year:2026,allowCreate:true,writeEnabled:true,annualNotes:{2025:{noteId:'history-2025'}}}},bridgeFailure:r=>{if(r.command==='append'&&r.noteId==='history-2025'&&lost)throw new Error('APPLE_RESULT_UNKNOWN');}});
 f.notes.push({id:'history-2025',title:'2025-DOPL',body:'<div>2025-DOPL</div>',plaintext:'2025-DOPL'});
 await register(f);const current=f.notes.find(n=>n.title==='2026-DOPL');const before=current.plaintext;
 const q=await f.send('om_previous','小婕 review 补记 2025-12-31');assert.equal(q.status,'review_question');assert.equal(q.date,'2025-12-31');
 await f.send('om_previous_answer','去年合成心得',{parent:f.sent.at(-1).message_id});const parent=f.sent.at(-1).message_id;
 const failed=await f.send('om_previous_save','确认保存',{parent});assert.equal(failed.code,'APPLE_RESULT_UNKNOWN');
 await f.restart();lost=false;
 const resumed=await f.send('om_previous_resume','小婕 review 续接');assert.equal(resumed.status,'review_saved');assert.equal(resumed.noteId,'history-2025');assert.match(resumed.receipt,/2025-DOPL/);
 assert.equal((await f.send('om_previous_save','确认保存',{parent})).status,'review_saved');
 assert.match(f.notes.find(n=>n.id==='history-2025').plaintext,/1231-心得\n去年合成心得/);assert.equal(current.plaintext,before);assert.equal(f.operations.filter(x=>x==='append').length,1);assert.equal(f.operations.filter(x=>x==='create').length,1);
});

test('多次替换保留每版旧原文及其他日期正文，空白/HTML字符不丢失、不增第二标题',async t=>{
 const {f}=fixture(t);await register(f);const old='  原文 <>&"\n第二行  \n';const d=await draft(f,'raw',old);await f.send('om_raw_save','确认保存',{parent:d.parent});
 await f.send('om_other_date','小婕 review 补记 2026-10-01');await f.send('om_other_answer','其他日期原文',{parent:f.sent.at(-1).message_id});await f.send('om_other_save','确认保存',{parent:f.sent.at(-1).message_id});
 for(const [i,answer] of ['第一版新稿','第二版新稿'].entries()){
  const r=await revise(f,'替换','replace_'+i,answer);assert.ok(!r.draft.receipt.includes(old));
  const saved=await f.send('om_replace_save_'+i,'确认保存',{parent:r.parent});assert.equal(saved.status,'review_revised');
 }
 const note=f.notes[0].plaintext;assert.equal(note.split('1006-心得').length-1,1);
 assert.match(note,/1006-心得\n第二版新稿\nPGTD-DOPL-ENTRY-/);assert.ok(note.includes('旧心得原文\n'+old+'\nPGTD-DOPL-HISTORY-END-'));
 assert.match(note,/旧心得原文\n第一版新稿\nPGTD-DOPL-HISTORY-END-/);assert.match(note,/1001-心得\n其他日期原文\nPGTD-DOPL-ENTRY-/);
 assert.equal(note.split('修订历史 2026-10-06（替换）').length-1,2);
});

test('修订选择、问题和草案可重启续接；旧选择/旧确认/取消均不得写入',async t=>{
 const {f}=fixture(t);await saveOriginal(f);const before=f.notes[0].plaintext;
 await f.send('om_old_choice','小婕 review 每日心得');const oldChoice=f.sent.at(-1).message_id;
 await f.send('om_new_choice','小婕 review 每日心得');const choice=f.sent.at(-1).message_id;await f.restart();
 const resumed=await f.send('om_choice_resume','小婕 review 续接');assert.equal(resumed.status,'review_existing');
 assert.equal((await f.send('om_stale_choice','替换',{parent:oldChoice})).status,'review_needs_confirmation');
 const question=await f.send('om_choice_select','替换',{parent:choice});assert.equal(question.status,'review_question');const parent=f.sent.at(-1).message_id;
 await f.restart();assert.equal((await f.send('om_question_resume','小婕 review 续接')).status,'review_question');
 await f.send('om_revision_draft','拟替换原文',{parent});const staleDraft=f.sent.at(-1).message_id;await f.restart();
 assert.equal((await f.send('om_draft_resume','小婕 review 续接')).status,'review_draft');
 assert.equal((await f.send('om_revision_bare','小婕 review 确认保存')).status,'review_needs_confirmation');
 assert.equal((await f.send('om_revision_wrong','确认保存',{parent:staleDraft,sender:'ou_other'})).status,'not_handled');
 assert.equal((await f.send('om_revision_cancel','小婕 review 取消')).status,'review_cancelled');
 assert.equal((await f.send('om_revision_after_cancel','确认保存',{parent:staleDraft})).status,'review_needs_confirmation');
 assert.equal(f.notes[0].plaintext,before);assert.ok(!f.operations.includes('replace'));
});

test('修订保存响应丢失后跨会话阻塞，重启只读核对一次历史且原确认可重投',async t=>{
 let lost=false;const {f}=fixture(t,{bridgeFailure:r=>{if(r.command==='replace'&&lost)throw new Error('APPLE_TIMEOUT');}});await saveOriginal(f);
 const r=await revise(f,'替换','unknown','响应丢失的合成新稿');lost=true;
 assert.equal((await f.send('om_revision_unknown_confirm','确认保存',{parent:r.parent})).code,'APPLE_TIMEOUT');assert.ok(f.notes[0].plaintext.includes('响应丢失的合成新稿'));
 await f.restart();lost=false;assert.equal((await f.send('om_revision_other_resume','小婕 review 续接',{sender:'ou_other'})).status,'review_recovery_required');
 assert.equal((await f.send('om_revision_repeat','确认保存',{parent:r.parent})).status,'review_recovery_required');
 const recovered=await f.send('om_revision_resume','小婕 review 续接');assert.equal(recovered.status,'review_revised');
 assert.equal((await f.send('om_revision_unknown_confirm','确认保存',{parent:r.parent})).status,'review_revised');
 assert.equal(f.operations.filter(x=>x==='replace').length,1);assert.equal(f.notes[0].plaintext.split('修订历史 2026-10-06（替换）').length-1,1);
});

test('修订写前超时或写后人工改变无法核对时，不盲重写或宣称成功',async t=>{
 let block=false;const {f}=fixture(t,{beforeBridge:r=>{if(r.command==='replace'&&block)throw new Error('APPLE_TIMEOUT');}});await saveOriginal(f);
 const before=f.notes[0].plaintext,r=await revise(f,'合并','no-write','未写补充');block=true;
 assert.equal((await f.send('om_revision_no_write','确认保存',{parent:r.parent})).code,'APPLE_TIMEOUT');await f.restart();
 assert.equal((await f.send('om_revision_no_write_resume','小婕 review 续接')).code,'WRITE_RESULT_UNKNOWN');assert.equal(f.notes[0].plaintext,before);assert.equal(f.operations.filter(x=>x==='replace').length,1);
 const {f:g}=fixture(t,{bridgeFailure:r=>{if(r.command==='replace')throw new Error('APPLE_RESULT_UNKNOWN');}});await saveOriginal(g);const d=await revise(g,'替换','edited-after','合成新稿');
 await g.send('om_write_unknown','确认保存',{parent:d.parent});g.notes[0].body+='<div>写后人工补充</div>';g.notes[0].plaintext+='\n写后人工补充';await g.restart();
 assert.equal((await g.send('om_write_changed_resume','小婕 review 续接')).code,'WRITE_RESULT_UNKNOWN');assert.equal(g.operations.filter(x=>x==='replace').length,1);assert.ok(g.notes[0].plaintext.endsWith('写后人工补充'));
});

test('补记修订人工编辑冲突保留草案并提示重新发起原明确日期',async t=>{
 const {f}=fixture(t);await register(f);await f.send('om_back_date','小婕 review 补记 2026-10-01');await f.send('om_back_date_answer','原补记',{parent:f.sent.at(-1).message_id});await f.send('om_back_date_save','确认保存',{parent:f.sent.at(-1).message_id});
 await f.send('om_back_date_choice','小婕 review 补记 2026-10-01');await f.send('om_back_date_replace','替换',{parent:f.sent.at(-1).message_id});await f.send('om_back_date_draft','新补记',{parent:f.sent.at(-1).message_id});const parent=f.sent.at(-1).message_id;
 f.notes[0].body+='<div>人工编辑</div>';f.notes[0].plaintext+='\n人工编辑';
 const result=await f.send('om_back_date_conflict','确认保存',{parent});assert.equal(result.code,'CONFLICT');assert.match(result.receipt,/小婕 review 补记 2026-10-01/);
 assert.equal((await f.send('om_back_date_resume','小婕 review 续接')).date,'2026-10-01');assert.ok(!f.operations.includes('replace'));assert.ok(f.notes[0].plaintext.endsWith('人工编辑'));
});

test('多人同日修订较旧草案不得覆盖已保存的新版本，旧问题和选择也检查快照',async t=>{
 const {f}=fixture(t);await saveOriginal(f);const old=await revise(f,'替换','older','较旧新稿');
 await f.send('om_other_choose','小婕 review 每日心得',{sender:'ou_other'});await f.send('om_other_replace','替换',{sender:'ou_other',parent:f.sent.at(-1).message_id});await f.send('om_other_draft','其他用户最新稿',{sender:'ou_other',parent:f.sent.at(-1).message_id});
 assert.equal((await f.send('om_other_saved','确认保存',{sender:'ou_other',parent:f.sent.at(-1).message_id})).status,'review_revised');
 assert.equal((await f.send('om_older_confirm','确认保存',{parent:old.parent})).code,'CONFLICT');assert.ok(f.notes[0].plaintext.includes('其他用户最新稿'));assert.ok(!f.notes[0].plaintext.includes('较旧新稿'));
 await f.send('om_new_choice','小婕 review 每日心得');const choice=f.sent.at(-1).message_id;
 f.notes[0].body+='<div>选择后人工编辑</div>';f.notes[0].plaintext+='\n选择后人工编辑';
 assert.equal((await f.send('om_choice_conflict','合并',{parent:choice})).code,'CONFLICT');assert.equal(f.operations.filter(x=>x==='replace').length,1);
 await f.send('om_latest_choice','小婕 review 每日心得');await f.send('om_latest_merge','合并',{parent:f.sent.at(-1).message_id});const question=f.sent.at(-1).message_id;
 f.notes[0].body+='<div>提问后人工编辑</div>';f.notes[0].plaintext+='\n提问后人工编辑';
 assert.equal((await f.send('om_question_conflict','补充',{parent:question})).code,'CONFLICT');assert.equal(f.operations.filter(x=>x==='replace').length,1);
});

test('历史年度缺绑定、错误标题、改变ID或撤销绑定均不误写当前年度',async t=>{
 const {f}=fixture(t);await register(f);assert.equal((await f.send('om_unbound_previous','小婕 review 补记 2025-12-31')).status,'review_year_unbound');assert.ok(!f.operations.includes('append'));
 f.config.review.annualNotes={2025:{noteId:'wrong-title'}};f.notes.push({id:'wrong-title',title:'其他笔记',body:'<div>其他笔记</div>',plaintext:'其他笔记'});await f.restart();
 assert.equal((await f.send('om_wrong_year_title','小婕 review 补记 2025-12-31')).code,'LOCATION_NOT_UNIQUE');assert.ok(!f.operations.includes('append'));
 f.config.review.annualNotes={2025:{noteId:'changed-id'}};await f.restart();const calls=f.operations.length;
 assert.equal((await f.send('om_changed_binding','小婕 review 补记 2025-12-31')).code,'BINDING_CHANGED');assert.equal(f.operations.length,calls);
 const {f:g}=fixture(t,{config:{review:{account:'synthetic',folder:'Notes',year:2026,allowCreate:true,writeEnabled:true,annualNotes:{2025:{noteId:'valid-year'}}}}});g.notes.push({id:'valid-year',title:'2025-DOPL',body:'<div>2025-DOPL</div>',plaintext:'2025-DOPL'});await register(g);
 await g.send('om_valid_year','小婕 review 补记 2025-12-31');await g.send('om_valid_year_answer','历史原文',{parent:g.sent.at(-1).message_id});const parent=g.sent.at(-1).message_id;
 delete g.config.review.annualNotes;await g.restart();assert.equal((await g.send('om_removed_year','确认保存',{parent})).code,'YEAR_NOT_BOUND');assert.ok(!g.operations.includes('append'));assert.equal(g.notes.find(n=>n.id==='valid-year').plaintext,'2025-DOPL');
});

test('合并超限/未提供补充、损坏边界/重复标题、撤销写权限均不修改旧心得',async t=>{
 const {f}=fixture(t);await saveOriginal(f);const before=f.notes[0].plaintext;
 await f.send('om_merge_choose','小婕 review 每日心得');await f.send('om_merge_question','合并',{parent:f.sent.at(-1).message_id});const question=f.sent.at(-1).message_id;
 assert.equal((await f.send('om_merge_empty','  ',{parent:question})).status,'review_invalid');assert.equal((await f.send('om_merge_large','补'.repeat(3999),{parent:question})).status,'review_invalid');assert.equal(f.notes[0].plaintext,before);
 const r=await revise(f,'替换','revoked','撤权新稿');f.config.review.writeEnabled=false;await f.restart();assert.equal((await f.send('om_revision_revoked_confirm','确认保存',{parent:r.parent})).code,'PERMISSION_DENIED');assert.ok(!f.operations.includes('replace'));
 const {f:g}=fixture(t);await register(g);g.notes[0].body+='<div>1006-心得</div><div>无边界人工条目</div>';g.notes[0].plaintext+='\n1006-心得\n无边界人工条目';await g.send('om_manual_existing','小婕 review 每日心得');
 const unsupported=await g.send('om_manual_choice','替换',{parent:g.sent.at(-1).message_id});assert.equal(unsupported.code,'UNSUPPORTED_ENTRY');assert.match(unsupported.receipt,/核对.*边界/);assert.ok(!g.operations.includes('replace'));
 g.notes[0].body+='<div>1006-心得</div><div>重复人工条目</div>';g.notes[0].plaintext+='\n1006-心得\n重复人工条目';assert.equal((await g.send('om_duplicate_heading','小婕 review 每日心得')).code,'LOCATION_NOT_UNIQUE');assert.ok(!g.operations.includes('replace'));
});

test('心得原文以补记一词开头但不是日期指令时，仍完整保留用户原文',async t=>{
 const {f}=fixture(t);await register(f);const answer='补记昨天的收获让我明白，先核对事实。';const d=await draft(f,'backfill-word',answer);assert.equal(d.result.status,'review_draft');assert.ok(d.result.receipt.includes(answer));
 assert.equal((await f.send('om_backfill_word_save','确认保存',{parent:d.parent})).status,'review_saved');assert.ok(f.notes[0].plaintext.includes(answer));
});

test('原生编辑拒绝保留具体失败码和待核对进度，不把拒绝伪报为不可用',async t=>{
 const {f}=fixture(t,{beforeBridge:r=>{if(r.command==='replace')throw new Error('INVALID_INPUT');}});await saveOriginal(f);const before=f.notes[0].plaintext,d=await revise(f,'替换','native-rejected','合成新稿');
 const r=await f.send('om_native_rejected_confirm','确认保存',{parent:d.parent});assert.equal(r.code,'INVALID_INPUT');assert.match(r.receipt,/待核对/);assert.equal(f.notes[0].plaintext,before);
});

test('记录心得给引导问题，回复原文直接保存，无草案或二次确认',async t=>{
 const {f}=fixture(t);await register(f);
 const q=await f.send('om_direct_question','小婕 review 记录心得');assert.equal(q.status,'review_question');assert.match(q.receipt,/值得记住/);assert.match(q.receipt,/学到了什么/);assert.match(q.receipt,/行动/);assert.ok(!f.operations.includes('append'));
 const saved=await f.send('om_direct_answer','直接记录的合成原文。',{parent:f.sent.at(-1).message_id});assert.equal(saved.status,'review_recorded');assert.equal(saved.date,'2026-10-06');assert.equal(saved.modelCalls,0);
 assert.match(f.notes[0].plaintext,/心得日期：2026-10-06\n记录时间：2026-10-06 10:00:00 \+08:00（Asia\/Shanghai）\n直接记录的合成原文。\nPGTD-DOPL-RECORD-END-/);assert.equal(f.operations.filter(c=>c==='append').length,1);assert.ok(!saved.receipt.includes('确认保存'));
});

test('已有当天记录心得只给问题，回答追加独立块，旧条目原文只出现一次',async t=>{
 const {f}=fixture(t);await saveOriginal(f);const old='原心得：先核对事实。';
 const q=await f.send('om_direct_existing','小婕 review 记录心得');assert.equal(q.status,'review_question');assert.ok(!q.receipt.includes(old));assert.ok(!q.receipt.includes('替换'));
 const r=await f.send('om_direct_added','这次新增收获。',{parent:f.sent.at(-1).message_id});assert.equal(r.status,'review_recorded');assert.ok(!r.receipt.includes(old));assert.ok(r.receipt.includes('这次新增收获。'));
 assert.match(f.notes[0].plaintext,/1006-心得\n原心得：先核对事实。\nPGTD-DOPL-ENTRY-/);assert.match(f.notes[0].plaintext,/心得日期：2026-10-06\n记录时间：[^\n]+\n这次新增收获。\nPGTD-DOPL-RECORD-END-/);assert.equal(f.notes[0].plaintext.split(old).length-1,1);assert.equal(f.operations.filter(c=>c==='append').length,2);assert.ok(!f.operations.includes('replace'));
});

test('直接记录旧问题/错身份/取消不写，跨午夜与重启重投仍只记录一次',async t=>{
 const {f}=fixture(t);await register(f);await f.send('om_direct_old_q','小婕 review 记录心得');const old=f.sent.at(-1).message_id;
 await f.send('om_direct_new_q','小婕 review 记录心得',{sentAt:'2026-10-06T23:59:00+08:00'});const current=f.sent.at(-1).message_id;
 assert.notEqual((await f.send('om_direct_stale','旧问题回复',{parent:old})).status,'review_recorded');
 assert.equal((await f.send('om_direct_wrong','别人的回复',{parent:current,sender:'ou_other'})).status,'not_handled');
 assert.equal((await f.send('om_direct_wrong_chat','别的会话回复',{parent:current,chat:'oc_other'})).status,'not_handled');await f.restart();
 const resumed=await f.send('om_direct_resume','小婕 review 续接');assert.equal(resumed.status,'review_question');assert.equal(resumed.date,'2026-10-06');
 const answer=await f.send('om_direct_once','跨午夜直接原文',{parent:current,sentAt:'2026-10-07T00:01:00+08:00'});assert.equal(answer.status,'review_recorded');assert.equal(answer.date,'2026-10-06');assert.match(f.notes[0].plaintext,/心得日期：2026-10-06\n记录时间：2026-10-07 00:01:00 \+08:00/);await f.restart();
 assert.equal((await f.send('om_direct_once','跨午夜直接原文',{parent:current,sentAt:'2026-10-07T00:01:00+08:00'})).status,'review_recorded');assert.equal(f.operations.filter(c=>c==='append').length,1);
 await f.send('om_direct_cancel_q','小婕 review 记录心得');const cancelled=f.sent.at(-1).message_id;await f.send('om_direct_cancel','取消',{parent:cancelled});
 assert.notEqual((await f.send('om_direct_cancel_answer','取消后回复',{parent:cancelled})).status,'review_recorded');assert.ok(!f.operations.includes('replace'));
});

test('直接追加未知响应保留原文，续接只读核对，跨会话/新请求不重写',async t=>{
 let lost=false;const {f}=fixture(t,{bridgeFailure:r=>{if(r.command==='append'&&lost)throw new Error('APPLE_TIMEOUT');}});await saveOriginal(f);await f.send('om_direct_unknown_q','小婕 review 记录心得');const parent=f.sent.at(-1).message_id;lost=true;
 const failed=await f.send('om_direct_unknown_answer','直接追加未知合成原文',{parent});assert.equal(failed.code,'APPLE_TIMEOUT');await f.restart();lost=false;
 assert.equal((await f.send('om_direct_other_recover','小婕 review 续接',{sender:'ou_other'})).status,'review_recovery_required');
 assert.equal((await f.send('om_direct_pending_new','小婕 review 记录心得')).status,'review_recovery_required');
 const recovered=await f.send('om_direct_unknown_resume','小婕 review 续接');assert.equal(recovered.status,'review_recorded');assert.ok(recovered.receipt.includes('直接追加未知合成原文'));assert.ok(!recovered.receipt.includes('原心得：先核对事实。'));
 assert.equal((await f.send('om_direct_unknown_answer','直接追加未知合成原文',{parent})).status,'review_recorded');assert.equal(f.operations.filter(c=>c==='append').length,2);assert.ok(!f.operations.includes('replace'));assert.equal(f.notes[0].plaintext.split('直接追加未知合成原文').length-1,1);
});

test('直接记录冲突/撤权保留本次原文，空答/保留标记/超限不写入，不覆写旧条目',async t=>{
 const {f}=fixture(t);await saveOriginal(f);await f.send('om_direct_guard_q','小婕 review 记录心得');const parent=f.sent.at(-1).message_id;
 for(const [i,answer] of ['  ','1007-心得','原文\nPGTD-DOPL-伪造'].entries())assert.equal((await f.send('om_direct_invalid_'+i,answer,{parent})).status,'review_invalid');
 f.notes[0].body+='<div>人工追加</div>';f.notes[0].plaintext+='\n人工追加';const before=f.notes[0].plaintext;
 const conflict=await f.send('om_direct_conflict_answer','冲突时的新原文',{parent});assert.equal(conflict.code,'CONFLICT');assert.match(conflict.receipt,/记录心得/);
 const resumed=await f.send('om_direct_conflict_resume','小婕 review 续接');assert.equal(resumed.status,'review_unsaved');assert.ok(resumed.receipt.includes('冲突时的新原文'));assert.equal(f.notes[0].plaintext,before);
 await f.send('om_direct_large_q','小婕 review 记录心得');const large=await f.send('om_direct_large_answer','字'.repeat(4001),{parent:f.sent.at(-1).message_id});assert.notEqual(large.status,'review_recorded');assert.equal(f.notes[0].plaintext,before);
 await f.send('om_direct_revoked_q','小婕 review 记录心得');const revoked=f.sent.at(-1).message_id;f.config.review.writeEnabled=false;await f.restart();
 assert.equal((await f.send('om_direct_revoked_answer','撤权后的原文',{parent:revoked})).code,'PERMISSION_DENIED');assert.equal((await f.send('om_direct_revoked_resume','小婕 review 续接')).status,'review_unsaved');assert.ok(!f.operations.includes('replace'));
});

test('每次记录独立追加带回复时间的块，旧正文HTML及原文保持原样',async t=>{
 const {f}=fixture(t);await saveOriginal(f);const before={...f.notes[0]};
 for(const [i,answer,sentAt] of [[1,'第一条\n<原文>&保持','2026-10-06T02:03:04Z'],[2,'第二条独立记录','2026-10-06T10:05:06+08:00']]){
  await f.send('om_append_q_'+i,'小婕 review 记录心得');const parent=f.sent.at(-1).message_id;
  assert.equal((await f.send('om_append_a_'+i,answer,{parent,sentAt})).status,'review_recorded');
 }
 assert.ok(f.notes[0].body.startsWith(before.body));assert.ok(f.notes[0].plaintext.startsWith(before.plaintext+'\n'));
 assert.match(f.notes[0].plaintext,/心得日期：2026-10-06\n记录时间：2026-10-06 10:03:04 \+08:00（Asia\/Shanghai）\n第一条\n<原文>&保持/);
 assert.match(f.notes[0].plaintext,/心得日期：2026-10-06\n记录时间：2026-10-06 10:05:06 \+08:00（Asia\/Shanghai）\n第二条独立记录/);
 assert.equal(f.operations.filter(c=>c==='append').length,3);assert.ok(!f.operations.includes('replace'));
 assert.equal(f.notes[0].plaintext.split('原心得：先核对事实。').length-1,1);
});

test('同秒两条原文各可4000字，独立追加不受旧条目累计长度或手工边界影响',async t=>{
 const {f}=fixture(t);await register(f);f.notes[0].body+='<div>1006-心得</div><div>手工旧心得，无结束标记</div>';f.notes[0].plaintext+='\n1006-心得\n手工旧心得，无结束标记';const before={...f.notes[0]};
 for(const i of [1,2]){await f.send('om_same_second_q_'+i,'小婕 review 记录心得');assert.equal((await f.send('om_same_second_a_'+i,'字'.repeat(3999)+i,{parent:f.sent.at(-1).message_id})).status,'review_recorded');}
 assert.ok(f.notes[0].body.startsWith(before.body));assert.equal(f.notes[0].plaintext.split('记录时间：2026-10-06 10:00:00 +08:00').length-1,2);assert.equal(f.operations.filter(c=>c==='append').length,2);assert.ok(!f.operations.includes('replace'));
 const legacy=await f.send('om_read_legacy','小婕 review 每日心得');assert.equal(legacy.status,'review_existing');assert.ok(legacy.receipt.includes('手工旧心得'));assert.ok(!legacy.receipt.includes('字'.repeat(10)));
});

test('直接追加写前超时未落盘，重启续接保留未知状态并拒绝自动重放',async t=>{
 let stop=false;const {f}=fixture(t,{beforeBridge:r=>{if(stop&&r.command==='append')throw new Error('APPLE_TIMEOUT');}});await register(f);const before=f.notes[0].plaintext;
 await f.send('om_append_timeout_q','小婕 review 记录心得');stop=true;assert.equal((await f.send('om_append_timeout_a','写前超时原文',{parent:f.sent.at(-1).message_id})).code,'APPLE_TIMEOUT');await f.restart();stop=false;
 assert.equal((await f.send('om_append_timeout_resume','小婕 review 续接')).code,'WRITE_RESULT_UNKNOWN');assert.equal((await f.send('om_append_timeout_new','小婕 review 记录心得')).status,'review_recovery_required');assert.equal(f.notes[0].plaintext,before);assert.equal(f.operations.filter(c=>c==='append').length,1);assert.ok(!f.operations.includes('replace'));
});

test('独立追加仍遵守年度容量，失败保留本次原文且旧正文不变',async t=>{
 const {f}=fixture(t);await register(f);f.notes[0].body+='<div>'+('旧'.repeat(63000))+'</div>';f.notes[0].plaintext+='\n'+('旧'.repeat(63000));const before={...f.notes[0]};
 await f.send('om_append_capacity_q','小婕 review 记录心得');const answer='新'.repeat(4000);
 const result=await f.send('om_append_capacity_a',answer,{parent:f.sent.at(-1).message_id});assert.equal(result.code,'CAPACITY_EXCEEDED');assert.deepEqual(f.notes[0],before);assert.ok(!f.operations.includes('append'));
 const progress=await f.send('om_append_capacity_resume','小婕 review 续接');assert.equal(progress.status,'review_unsaved');assert.ok(progress.receipt.includes(answer));
});

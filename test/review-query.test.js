import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {doplFixture} from '../examples/review-dopl-fixture.js';
function fixture(t,options){const dir=mkdtempSync(join(tmpdir(),'query-dopl-'));const f=doplFixture(dir,options);t.after(async()=>{await f.close();rmSync(dir,{recursive:true,force:true});});return f;}
async function register(f){await f.send('om_reg','小婕 review 注册 DOPL');await f.send('om_reg_ok','确认注册',{parent:f.sent.at(-1).message_id});}
test('注册状态独立查询，未注册与已注册不同，不读取或写入Notes',async t=>{
 const f=fixture(t);const before=await f.send('om_q0','小婕 review 查询注册');assert.equal(before.status,'review_registration_status');assert.equal(before.registration.registered,false);assert.equal(f.operations.length,0);
 await register(f);const count=f.operations.length;const after=await f.send('om_q1','小婕 review 注册状态');assert.equal(after.registration.registered,true);assert.equal(after.registration.noteId,f.notes[0].id);assert.equal(f.operations.length,count);
});
test('今天心得只读返回多条时间块与原文，查询不打断当前问题',async t=>{
 const f=fixture(t);await register(f);
 for(const [suffix,answer,time] of [['a','第一条\n多行原文','10:01:00'],['b','第二条<&>','10:02:00']]){
  await f.send('om_open_'+suffix,'小婕 review 记录心得');await f.send('om_answer_'+suffix,answer,{parent:f.sent.at(-1).message_id,sentAt:'2026-10-06T'+time+'+08:00'});
 }
 await f.send('om_open_c','小婕 review 记录心得');const parent=f.sent.at(-1).message_id;const count=f.operations.length;
 const result=await f.send('om_today','小婕 review 查询今天心得');assert.equal(result.status,'review_query');assert.deepEqual(result.entries.map(e=>e.text),['第一条\n多行原文','第二条<&>']);assert.equal(result.entries[0].date,'2026-10-06');assert.match(result.entries[1].recordedAt,/10:02:00/);assert.ok(!result.receipt.includes('PGTD-DOPL-'));assert.deepEqual(f.operations.slice(count),['read']);assert.equal(result.modelCalls,0);
 assert.equal((await f.send('om_answer_c','第三条',{parent})).status,'review_recorded');
});
test('旧当前正文与新块兼容，修订历史和恢复标记不当作心得，分页有界且重启重投零写',async t=>{
 const f=fixture(t);await register(f);const n=f.notes[0];n.plaintext='2026-DOPL\n1005-心得\n昨天原文\nPGTD-DOPL-ENTRY-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\nPGTD-DOPL-HISTORY-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb\n修订历史 2026-10-05（替换）\n旧心得原文\n1005-心得\n不要展示的历史\nPGTD-DOPL-HISTORY-END-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';n.body='<div>'+n.plaintext+'</div>';
 for(let i=0;i<4;i++){await f.send('om_op'+i,'小婕 review 记录心得');await f.send('om_an'+i,'原文'+i,{parent:f.sent.at(-1).message_id});}
 const count=f.operations.length;const first=await f.send('om_recent','小婕 review 查询近期心得');assert.equal(first.total,5);assert.equal(first.entries.length,3);assert.equal(first.nextPage,2);assert.ok(!first.receipt.includes('不要展示的历史'));
 const second=await f.send('om_page','小婕 review 查询近期心得 第2页');assert.deepEqual(second.entries.map(e=>e.text),['原文3','昨天原文']);assert.equal(second.entries[1].recordedAt,null);
 const yesterday=await f.send('om_yesterday','小婕 review 查询昨天心得');assert.deepEqual(yesterday.entries.map(e=>e.text),['昨天原文']);await f.restart();assert.deepEqual(await f.send('om_recent','小婕 review 查询近期心得'),first);assert.ok(f.operations.slice(count).every(op=>op==='read'));
});
test('范围空、非法日期、无权限、Notes失败与歧义分别报告且零写',async t=>{
 const f=fixture(t);await register(f);assert.equal((await f.send('om_empty','小婕 review 查询昨天心得')).status,'review_query_empty');
 assert.equal((await f.send('om_bad','小婕 review 查询 2026-02-30 心得')).status,'review_query_needs_range');
 assert.equal((await f.send('om_amb','小婕 review 查询心得')).status,'review_query_needs_range');
 f.notes[0].plaintext='2026-DOPL\n1006-心得\nA\n1006-心得\nB';assert.equal((await f.send('om_dup','小婕 review 查询今天心得')).code,'LOCATION_NOT_UNIQUE');
 f.config.review.readEnabled=false;await f.restart();assert.equal((await f.send('om_denied','小婕 review 查询今天心得')).code,'PERMISSION_DENIED');assert.ok(f.operations.every(op=>['bind','find','create','read'].includes(op)));
});
test('近期跨年只读取明确年度ID，缺年度不能假装空，权限白名单不扩张',async t=>{
 const f=fixture(t,{config:{review:{account:'synthetic',folder:'Notes',year:2026,allowCreate:true,writeEnabled:true,annualNotes:{2025:{noteId:'old-year'}}}}});await register(f);
 f.notes.push({id:'old-year',plaintext:'2025-DOPL\n1231-心得\n跨年旧原文',body:'<div>2025-DOPL</div>'});
 const r=await f.send('om_cross','小婕 review 查询近期心得',{sentAt:'2026-01-02T10:00:00+08:00'});assert.equal(r.total,1);assert.equal(r.entries[0].date,'2025-12-31');assert.equal(r.references.length,2);
 assert.equal((await f.send('om_unbound','小婕 review 查询 2024-01-01 心得')).code,'YEAR_NOT_BOUND');
 assert.equal((await f.send('om_bad_user','小婕 review 查询今天心得',{sender:'ou_outside'})).status,'not_handled');
});
test('4500字页预算完整保留原文，单条过大与服务失败不是空结果',async t=>{
 const f=fixture(t);await register(f);for(let i=0;i<2;i++){await f.send('om_o'+i,'小婕 review 记录心得');await f.send('om_a'+i,'文'.repeat(3000),{parent:f.sent.at(-1).message_id});}
 const result=await f.send('om_chars','小婕 review 查询今天心得');assert.equal(result.entries.length,1);assert.equal(result.entries[0].text.length,3000);assert.equal(result.nextPage,2);
 f.notes[0].plaintext='2026-DOPL\n1006-心得\n'+'文'.repeat(4501);assert.equal((await f.send('om_large','小婕 review 查询今天心得')).code,'CAPACITY_EXCEEDED');
 f.notes.length=0;assert.equal((await f.send('om_failure','小婕 review 查询今天心得')).status,'review_error');
});

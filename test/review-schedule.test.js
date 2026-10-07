import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {doplFixture} from '../examples/review-dopl-fixture.js';
function fixture(t,options={}){const dir=mkdtempSync(join(tmpdir(),'daily-dopl-'));let time='2026-10-06T20:59:00+08:00';
 const f=doplFixture(dir,{...options,now:()=>time,config:{...options.config,review:{account:'synthetic',folder:'Notes',year:2026,allowCreate:true,writeEnabled:true,daily:{enabled:true,time:'21:00',senderId:'ou_test',conversationId:'oc_test'},...options.config?.review}}});
 t.after(async()=>{await f.close();rmSync(dir,{recursive:true,force:true});});return {f,setTime:value=>time=value};}
async function register(f){await f.send('om_reg','小婕 review 注册 DOPL');await f.send('om_ok','确认注册',{parent:f.sent.at(-1).message_id});}
test('日度触发只发三个问题，可信回复直接追加真实时间；重复与重启不重发',async t=>{
 const {f,setTime}=fixture(t);await register(f);assert.equal((await f.tick()).status,'review_schedule_not_due');const count=f.operations.length;setTime('2026-10-06T21:00:00+08:00');
 const result=await f.tick();assert.equal(result.status,'review_schedule_sent');const question=f.sent.at(-1);assert.match(question.text,/今天哪件事最值得记住/);assert.match(question.text,/询问编号/);assert.deepEqual(f.operations.slice(count),['read']);
 const sent=f.sent.length;assert.equal((await f.tick()).status,'review_schedule_duplicate');await f.restart();assert.equal((await f.tick()).status,'review_schedule_duplicate');assert.equal(f.sent.length,sent);
 const saved=await f.send('om_auto_answer','自动提问的合成回复',{parent:question.message_id,sentAt:'2026-10-06T21:05:00+08:00'});assert.equal(saved.status,'review_recorded');assert.match(f.notes[0].plaintext,/21:05:00/);
});
test('未回应跨日不堆问题，手动新开替代旧问题且旧关联不能保存',async t=>{
 const {f,setTime}=fixture(t);await register(f);setTime('2026-10-06T21:00:00+08:00');await f.tick();const old=f.sent.at(-1).message_id;setTime('2026-10-07T21:00:00+08:00');const count=f.sent.length;assert.equal((await f.tick()).status,'review_schedule_waiting');assert.equal(f.sent.length,count);
 await f.send('om_manual','小婕 review 记录心得',{sentAt:'2026-10-07T21:01:00+08:00'});const manual=f.sent.at(-1).message_id;assert.notEqual((await f.send('om_stale','旧问题回复',{parent:old})).status,'review_recorded');assert.equal((await f.send('om_current','新问题回复',{parent:manual,sentAt:'2026-10-07T21:02:00+08:00'})).status,'review_recorded');assert.equal((await f.tick()).status,'review_schedule_waiting');
});
test('未知发送写后超时仅只读核对，重启不重发并恢复可信回复关联',async t=>{
 const {f,setTime}=fixture(t,{sendFailure:()=>{throw new Error('TIMEOUT_AFTER_SEND');}});await register(f);setTime('2026-10-06T21:00:00+08:00');assert.equal((await f.tick()).status,'review_schedule_unknown');const question=f.sent.at(-1);const count=f.sent.length;await f.restart();assert.equal((await f.tick()).status,'review_schedule_sent');assert.equal(f.sent.length,count);assert.equal((await f.send('om_recovered_reply','读回恢复后的回复',{parent:question.message_id,sentAt:'2026-10-06T21:04:00+08:00'})).status,'review_recorded');
});
test('未知发送未找到不盲重放，有界两页核对且停止自动核对',async t=>{
 let lists=0;const {f,setTime}=fixture(t,{sendFailure:()=>{throw new Error('TIMEOUT');},listMessages:async()=>{lists++;return {items:[],has_more:true,page_token:'next'};}});await register(f);setTime('2026-10-06T21:00:00+08:00');await f.tick();const count=f.sent.length;assert.equal((await f.tick()).status,'review_schedule_unknown');assert.equal(lists,2);await f.restart();await f.tick();assert.equal(lists,2);assert.equal(f.sent.length,count);
 const r=await f.send('om_reconcile','小婕 review 核对自动询问');assert.equal(r.status,'review_schedule_unknown');assert.equal(lists,4);
});
test('暂停和恢复错过时刻不补跑，配置可查看修改且重启持久',async t=>{
 const {f,setTime}=fixture(t);await register(f);const pause=await f.send('om_pause','小婕 review 暂停自动询问');assert.equal(pause.schedule.enabled,false);setTime('2026-10-06T21:01:00+08:00');assert.equal((await f.tick()).status,'review_schedule_disabled');await f.send('om_resume','小婕 review 恢复自动询问');await f.restart();assert.equal((await f.tick()).status,'review_schedule_not_due');
 setTime('2026-10-07T20:59:00+08:00');const status=await f.send('om_state','小婕 review 查询自动询问');assert.equal(status.schedule.time,'21:00');assert.equal(status.schedule.enabled,true);
 assert.equal((await f.send('om_set_bad','小婕 review 设置自动询问 25:00')).status,'review_schedule_needs_time');await f.send('om_set','小婕 review 设置自动询问 22:00');setTime('2026-10-07T21:00:00+08:00');assert.equal((await f.tick()).status,'review_schedule_not_due');setTime('2026-10-07T22:00:00+08:00');assert.equal((await f.tick()).status,'review_schedule_sent');
});
test('宕机同日30分钟内补一次，超窗和跨日不补旧日，撤权及身份控制阻止发送',async t=>{
 const {f,setTime}=fixture(t);await register(f);setTime('2026-10-06T21:31:00+08:00');assert.equal((await f.tick()).status,'review_schedule_missed');setTime('2026-10-07T00:00:00+08:00');assert.equal((await f.tick()).status,'review_schedule_not_due');setTime('2026-10-07T21:29:00+08:00');await f.restart();assert.equal((await f.tick()).status,'review_schedule_sent');
 assert.equal((await f.send('om_other_control','小婕 review 暂停自动询问',{sender:'ou_other'})).status,'review_schedule_forbidden');f.config.review.writeEnabled=false;await f.restart();assert.equal((await f.tick()).status,'review_schedule_forbidden');
});
test('跨午夜回答保留提问日期与回复时间；跨年只用明确新年度绑定',async t=>{
 const {f,setTime}=fixture(t,{config:{review:{daily:{enabled:true,time:'23:59',senderId:'ou_test',conversationId:'oc_test'},annualNotes:{2027:{noteId:'new-year'}}}}});await register(f);setTime('2026-12-31T23:59:00+08:00');await f.tick();const old=f.sent.at(-1).message_id;const r=await f.send('om_midnight','跨年回复',{parent:old,sentAt:'2027-01-01T00:01:02+08:00'});assert.equal(r.date,'2026-12-31');assert.match(f.notes[0].plaintext,/2027-01-01 00:01:02/);
 f.notes.push({id:'new-year',plaintext:'2027-DOPL',body:'<div>2027-DOPL</div>'});setTime('2027-01-01T23:59:00+08:00');assert.equal((await f.tick()).status,'review_schedule_sent');const current=f.sent.at(-1).message_id;assert.equal((await f.send('om_new_year','新年度原文',{parent:current,sentAt:'2027-01-02T00:01:00+08:00'})).status,'review_recorded');assert.ok(f.notes[1].plaintext.includes('新年度原文'));
});
test('提问准备失败保留本日失败结果，不每分钟重复读取；Notes未知写入仅沿用续接核对',async t=>{
 let fail=false;const {f,setTime}=fixture(t,{beforeBridge:r=>{if(fail&&r.command==='read')throw new Error('APPLE_TIMEOUT');}});await register(f);fail=true;setTime('2026-10-06T21:00:00+08:00');assert.equal((await f.tick()).status,'review_schedule_blocked');const count=f.operations.length;assert.equal((await f.tick()).status,'review_schedule_duplicate');assert.equal(f.operations.length,count);
});
test('飞书写前超时不重放；写后读回失败通过只读核对恢复，不自动保存心得',async t=>{
 const before=fixture(t,{beforeSend:()=>{throw new Error('TIMEOUT_BEFORE_SEND');}});await register(before.f);before.setTime('2026-10-06T21:00:00+08:00');const count=before.f.sent.length;assert.equal((await before.f.tick()).status,'review_schedule_unknown');assert.equal((await before.f.tick()).status,'review_schedule_unknown');await before.f.restart();await before.f.tick();assert.equal(before.f.sent.length,count);
 const after=fixture(t,{getMessageFailure:id=>{if(id.startsWith('om_review_auto'))throw new Error('READ_TIMEOUT');}});await register(after.f);after.setTime('2026-10-06T21:00:00+08:00');assert.equal((await after.f.tick()).status,'review_schedule_unknown');assert.equal((await after.f.tick()).status,'review_schedule_sent');assert.ok(!after.f.operations.includes('append'));
});
test('自动问题回复Notes写后超时，重启续接只读核对一次，人工编辑冲突不写',async t=>{
 let failed=false;const {f,setTime}=fixture(t,{bridgeFailure:r=>{if(r.command==='append'&&!failed){failed=true;throw new Error('WRITE_RESULT_UNKNOWN');}}});await register(f);setTime('2026-10-06T21:00:00+08:00');await f.tick();const question=f.sent.at(-1).message_id;assert.equal((await f.send('om_unknown_answer','未知写入回复',{parent:question})).status,'review_error');await f.restart();setTime('2026-10-07T21:00:00+08:00');assert.equal((await f.tick()).status,'review_schedule_waiting');assert.equal((await f.send('om_reconcile_notes','小婕 review 续接')).status,'review_recorded');assert.equal(f.operations.filter(op=>op==='append').length,1);
 await f.send('om_new_manual','小婕 review 记录心得');const parent=f.sent.at(-1).message_id;f.notes[0].body+='<div>人工改动</div>';f.notes[0].plaintext+='\n人工改动';assert.equal((await f.send('om_conflict','保留原文',{parent})).code,'CONFLICT');assert.equal(f.operations.filter(op=>op==='append').length,1);
});
test('未确认时刻保持停用；多义目标、非法配置拒绝且不扩张白名单',async t=>{
 const {f,setTime}=fixture(t,{config:{review:{daily:{enabled:false,senderId:'ou_test',conversationId:'oc_test'}}}});await register(f);setTime('2026-10-06T21:00:00+08:00');assert.equal((await f.tick()).status,'review_schedule_disabled');const r=await f.send('om_no_time','小婕 review 恢复自动询问');assert.equal(r.status,'review_schedule_needs_time');
 assert.equal((await f.send('om_status','小婕 review 查询自动询问')).schedule.time,null);
 const invalid=mkdtempSync(join(tmpdir(),'daily-invalid-'));t.after(()=>rmSync(invalid,{recursive:true,force:true}));assert.throws(()=>doplFixture(invalid,{config:{review:{account:'synthetic',folder:'Notes',year:2026,writeEnabled:true,daily:{enabled:true,time:'21:00',senderId:'ou_outside',conversationId:'oc_test'}}}}),/INVALID_REVIEW_SCHEDULE/);
});
test('注册查询展示日度调度实际暂停状态，不把注册和心得结果混淆',async t=>{
 const {f}=fixture(t);await register(f);await f.send('om_pause_query','小婕 review 暂停自动询问');const r=await f.send('om_registration_query','小婕 review 查询注册');assert.equal(r.registration.schedule.enabled,false);assert.equal(r.registration.schedule.time,'21:00');assert.equal(r.status,'review_registration_status');
});
test('已发送自动问题在权限即时撤销后不能沿用旧配置追加，原文可续接且零写',async t=>{
 let permissions={account:'synthetic',folder:'Notes',year:2026,writeEnabled:true};const {f,setTime}=fixture(t,{reviewConfig:()=>permissions});await register(f);setTime('2026-10-06T21:00:00+08:00');await f.tick();const parent=f.sent.at(-1).message_id;permissions={...permissions,writeEnabled:false};const r=await f.send('om_revoked_live','原文保留',{parent});assert.equal(r.code,'PERMISSION_DENIED');assert.ok(!f.operations.includes('append'));
});

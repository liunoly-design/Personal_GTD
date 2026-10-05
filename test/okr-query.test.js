import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { standaloneFixture } from '../examples/okr-standalone-fixture.js';
function fixture(t,options={}) {
  const dir=mkdtempSync(join(tmpdir(),'okr-query-')),f=standaloneFixture(dir,options);
  t.after(async()=>{await f.close();rmSync(dir,{recursive:true,force:true});});
  return f;
}
async function finalize(f) {
  await f.send('om_open','小婕 okr 讨论');
  for(let i=1;i<=7;i++) await f.send('om_r'+i,'合成回答'+i,{parent:f.sent.at(-1).message_id});
  return f.send('om_final','确认定稿',{parent:f.sent.at(-1).message_id});
}
test('查询缺少当前已确认稿绑定只询问，零Notes访问、零生成或草案',async t=>{
  const f=fixture(t);
  const result=await f.send('om_query','小婕 okr 查询当前目标');
  assert.equal(result.status,'okr_query_needs_binding');
  assert.match(result.receipt,/绑定/);
  assert.equal(f.notes.length,0);assert.equal(f.guideCalls,0);assert.deepEqual(f.operations,[]);
});
test('查询同义表达/关联回复/旧入口读同一已确认稿，显示可读来源，重复和重启零写入零生成',async t=>{
  const f=fixture(t),final=await finalize(f);
  const beforeCalls=f.guideCalls,writes=f.operations.filter(c=>['create','append','replace'].includes(c)).length;
  f.notes.push({...f.notes[1],id:'another-same-title',plaintext:'同名候选未确认'});
  let first;
  for(const [i,command] of ['查询当前目标','查一下目标','查看当前已确认目标','看看目标','找一下当前目标','列出当前目标','当前目标是什么'].entries()) {
    const result=await f.send('om_q'+i,'小婕 okr '+command);
    first??=result;
    assert.equal(result.status,'okr_query');assert.equal(result.source.noteId,final.noteId);
    assert.match(result.receipt,/synthetic\/Notes/);assert.match(result.receipt,/读取时间/);assert.match(result.content,/#KR3/);
    assert.doesNotMatch(result.content,/PGTD-FINAL|PGTD OKR 最新稿/);
  }
  assert.equal((await f.send('om_linkquery','查看当前目标',{parent:f.sent.at(-1).message_id})).status,'okr_query');
  assert.equal((await f.send('om_legacy','小婕 gtd okr 查一下目标')).status,'okr_query');
  await f.restart();
  const reads=f.operations.length;
  const replay=await f.send('om_q0','小婕 okr 查询当前目标');
  assert.equal(replay.readAt,first.readAt);assert.equal(f.operations.length,reads);
  assert.equal(f.guideCalls,beforeCalls);assert.equal(f.operations.filter(c=>['create','append','replace'].includes(c)).length,writes);
});
test('当前目标分页有界且新查询反映人工修改，不把讨论稿或大文档冒充结果',async t=>{
  const f=fixture(t);await finalize(f);
  const n=f.notes[1],original=n.plaintext,marker=original.match(/PGTD-FINAL-[0-9a-f-]{36}/u)[0];
  n.plaintext='PGTD OKR 最新稿\n'+'甲'.repeat(2000)+'乙'.repeat(1000)+'\n'+marker;
  const first=await f.send('om_page1','小婕 okr 查询当前目标');
  assert.equal(first.pages,2);assert.equal(first.content,'甲'.repeat(2000));
  const second=await f.send('om_page2','小婕 okr 查询当前目标 第2页');
  assert.equal(second.content,'乙'.repeat(1000));assert.equal(second.page,2);
  assert.equal((await f.send('om_badpage','小婕 okr 查询当前目标 第3页')).status,'okr_query_invalid_page');
  n.plaintext='';assert.equal((await f.send('om_empty','小婕 okr 查询当前目标')).status,'okr_query_empty');
  n.plaintext='讨论稿（未确认） #O1 新草案';assert.equal((await f.send('om_draft','小婕 okr 查询当前目标')).status,'okr_query_unconfirmed');
  n.plaintext='甲'.repeat(65537);assert.equal((await f.send('om_large','小婕 okr 查询当前目标')).status,'okr_query_too_large');
  n.plaintext=original;
  assert.equal((await f.send('om_refresh','小婕 okr 查询当前目标')).status,'okr_query');
});
test('权限、读取失败、绑定消失分别报告，失败不算空且不按同名文档补建',async t=>{
  let failure;
  const f=fixture(t,{bridgeFailure:r=>{if(r.command==='read'&&failure) throw new Error(failure);}});
  await finalize(f);const writes=f.operations.filter(c=>['create','append','replace'].includes(c)).length;
  for(const [i,code,status] of [[1,'PERMISSION_DENIED','okr_query_forbidden'],[2,'ACCESSIBILITY_DENIED','okr_query_forbidden'],[3,'APPLE_TIMEOUT','okr_query_failed'],[4,'LOCATION_NOT_UNIQUE','okr_query_missing'],[5,'RESPONSE_TOO_LARGE','okr_query_too_large'],[6,'UNAVAILABLE','okr_query_failed']]) {
    failure=code;
    assert.equal((await f.send('om_failure'+i,'小婕 okr 查询当前目标')).status,status);
  }
  assert.equal(f.operations.filter(c=>['create','append','replace'].includes(c)).length,writes);
  assert.equal(f.guideCalls,7);
});
test('确认结果未知时查询说明需核对原消息，不显示尚未核实的最新稿',async t=>{
  let lost=false;
  const f=fixture(t,{bridgeFailure:r=>{if(r.command==='create'&&r.title==='PGTD OKR 最新稿'&&!lost){lost=true;throw new Error('APPLE_TIMEOUT');}}});
  const result=await finalize(f);assert.equal(result.status,'okr_error');
  const parent=f.sent.at(-2).message_id;
  const before=f.operations.length;
  assert.equal((await f.send('om_unknownquery','小婕 okr 查询当前目标')).status,'okr_query_recovery_required');
  assert.equal(f.operations.length,before);
  await f.restart();
  assert.equal((await f.send('om_final','确认定稿',{parent})).status,'okr_finalized');
  assert.equal((await f.send('om_afterrecover','小婕 okr 查询当前目标')).status,'okr_query');
  assert.equal(f.notes.length,2);
});
test('未授权身份、否定、引用或多动作查询不会生成目标或写Notes',async t=>{
  const f=fixture(t);
  for(const [i,text] of ['小婕 okr 不要查询当前目标','小婕 okr “查询当前目标”','小婕 okr 查询当前目标然后保存目标'].entries()) assert.equal((await f.send('om_guard'+i,text)).status,'okr_help');
  assert.equal((await f.send('om_forbidden','小婕 okr 查询当前目标',{sender:'ou_unauthorized'})).status,'not_handled');
  assert.equal(f.guideCalls,0);assert.equal(f.operations.length,0);
});
test('目标分页保留Unicode完整字符，不在页边界拆开emoji',async t=>{
  const f=fixture(t);await finalize(f);
  const marker=f.notes[1].plaintext.match(/PGTD-FINAL-[0-9a-f-]{36}/u)[0];
  f.notes[1].plaintext='PGTD OKR 最新稿\n'+'甲'.repeat(1999)+'😀乙\n'+marker;
  const first=await f.send('om_unicode1','小婕 okr 查询当前目标');
  const second=await f.send('om_unicode2','小婕 okr 查询当前目标 第2页');
  assert.equal(first.content,'甲'.repeat(1999)+'😀');assert.equal(second.content,'乙');
});

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { standaloneFixture } from './okr-standalone-fixture.js';
const dir=mkdtempSync(join(tmpdir(),'f603-query-demo-')),f=standaloneFixture(dir);
try {
  assert.equal((await f.send('om_missing','小婕 okr 查询当前目标')).status,'okr_query_needs_binding');
  await f.send('om_open','小婕 okr 讨论');
  for(let i=1;i<=7;i++) await f.send('om_r'+i,'合成回答'+i,{parent:f.sent.at(-1).message_id});
  const final=await f.send('om_final','确认定稿',{parent:f.sent.at(-1).message_id});
  const before=f.operations.filter(c=>['create','replace','append'].includes(c)).length,calls=f.guideCalls;
  const first=await f.send('om_query','小婕 okr 查询当前目标');
  const second=await f.send('om_find','小婕 gtd okr 找一下当前目标');
  await f.restart();const replay=await f.send('om_query','小婕 okr 查询当前目标');
  assert.equal(first.source.noteId,final.noteId);assert.equal(second.content,first.content);assert.equal(replay.readAt,first.readAt);
  assert.equal(f.guideCalls,calls);assert.equal(f.operations.filter(c=>['create','replace','append'].includes(c)).length,before);
  console.log(JSON.stringify({mode:'simulation',status:first.status,source:first.source,scope:first.scope,pages:first.pages,queryNotesWrites:0,queryModelCalls:0,paidCalls:0,restartReplay:true,content:first.content}));
} finally {await f.close();rmSync(dir,{recursive:true,force:true});}

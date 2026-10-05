import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { standaloneFixture } from './okr-standalone-fixture.js';
const dir=mkdtempSync(join(tmpdir(),'f603-demo-')),f=standaloneFixture(dir);
try {
  await f.send('om_open','小婕 okr 讨论');
  await f.send('om_r1','合成回答1',{parent:f.sent.at(-1).message_id});
  await f.send('om_pause','暂停',{parent:f.sent.at(-1).message_id});
  await f.restart();await f.send('om_resume','小婕 gtd okr 续接');
  let ready;
  for(let i=2;i<=7;i++) ready=await f.send('om_r'+i,'合成回答'+i,{parent:f.sent.at(-1).message_id});
  const parent=f.sent.at(-1).message_id;
  assert.ok(ready.draftVersion);assert.equal(f.notes.length,1);
  const result=await f.send('om_confirm','确认定稿',{parent});
  assert.equal(result.status,'okr_finalized');
  await f.restart();assert.equal((await f.send('om_confirm','确认定稿',{parent})).noteId,result.noteId);
  assert.equal(f.notes.length,2);assert.equal(f.guideCalls,7);
  console.log(JSON.stringify({mode:'simulation',enabledModules:['okr'],paidCalls:0,scriptedGuidanceCalls:f.guideCalls,pauseRestart:true,confirmedNoteId:result.noteId,twoNotes:true,duplicateSuppressed:true,localJournal:true}));
} finally {await f.close();rmSync(dir,{recursive:true,force:true});}

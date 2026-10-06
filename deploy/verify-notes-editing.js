// Explicit real-Notes acceptance: synthetic content only, no model or Feishu sends.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const [configPath, outputDirectory, authorization] = process.argv.slice(2);
if (!configPath || !outputDirectory || authorization !== '--allow-notes-writes') throw new Error('Explicit config, private output directory and Notes-write authorization required');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const bridgePath = process.env.PGTD_NOTES_BRIDGE_PATH ?? resolve('src/apple-notes.js');
const { callNotes } = await import(pathToFileURL(bridgePath));
mkdirSync(outputDirectory, {recursive:true, mode:0o700});
const scope = await callNotes({command:'bind', account:config.okr.account, folder:config.okr.folder});
const marker = 'PGTD-OKR-' + randomUUID();
const escape = text => text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\n','<br>');
let note = await callNotes({command:'create', ...scope, title:'PGTD OKR 日志', body:`<div>PGTD OKR 讨论稿<br>${marker}<br>合成编辑稳定性验收</div>`});
writeFileSync(join(outputDirectory,'test-note.private.json'), JSON.stringify({id:note.id, marker}), {mode:0o600});
for (let round=0; round<5; round++) {
  const text = `PGTD OKR 讨论稿\n${marker}\n合成轮次 ${round}\n正文标签 #KR6，候选 #O3（待确认）。\n`
    + Array.from({length:100},(_,i)=>`合成段落 ${i}：仅用于标签转换验收，不含用户信息。`).join('\n')
    + '\n## #O1 合成目标\n### #KR1 合成指标\n### #KR2 合成指标\n### #KR3 合成指标\n### #KR4 合成指标\n## #O2 合成目标\n';
  note = await callNotes({command:'replace', ...scope, noteId:note.id, expectedBody:note.body, body:`<div>${escape(text)}</div>`});
  const after = await callNotes({command:'read', ...scope, noteId:note.id});
  assert.equal(after.plaintext.trim(), text.trim());
  assert.equal(after.tagsComplete,true); assert.equal(after.headingsComplete,true);
  note = after;
  console.log(JSON.stringify({round, exactBody:true, tags:true, headings:true, modelCalls:0}));
}

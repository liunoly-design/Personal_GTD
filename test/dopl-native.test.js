import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const helper=fileURLToPath(new URL('../native/notes-tags.swift',import.meta.url));
function validate(plaintext){return new Promise((resolve,reject)=>{
 const child=execFile('/usr/bin/swift',[helper],{timeout:15000},(error,stdout)=>{try{resolve(JSON.parse(stdout));}catch{reject(error??new Error('NATIVE_INVALID_RESPONSE'));}});
 child.stdin.end(JSON.stringify({command:'checkReplacement',rawPlaintext:plaintext,html:'<div>'+plaintext.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\n','<br>')+'</div>'}));
});}
test('原生替换允许受保护年度DOPL及原OKR目标，拒绝普通笔记与无标记年度', {skip:process.platform!=='darwin'},async()=>{
 const marker='PGTD-DOPL-12345678-1234-1234-1234-123456789abc';
 for(const text of ['2026-DOPL\n'+marker,'2025-DOPL\n1231-心得\n原文\nPGTD-DOPL-ENTRY-12345678-1234-1234-1234-123456789abc','PGTD OKR 最新稿\nPGTD-FINAL-synthetic','PGTD OKR 讨论稿\nPGTD-OKR-synthetic']){
  const r=await validate(text);assert.equal(r.ok,true);assert.equal(r.value.allowed,true);
 }
 for(const text of ['其他笔记\n'+marker,'2026-DOPL\n普通手工文字','2026-DOPL\nPGTD-DOPL-伪造标记'])assert.equal((await validate(text)).code,'INVALID_INPUT');
});

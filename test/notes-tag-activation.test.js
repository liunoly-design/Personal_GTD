import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const helper=fileURLToPath(new URL('../native/notes-tags.swift',import.meta.url));
function check(rawPlaintext) {
  return JSON.parse(execFileSync('/usr/bin/swift',[helper],{input:JSON.stringify({command:'checkTagActivation',rawPlaintext,tag:'#KR2'}),encoding:'utf8',timeout:30000}));
}
test('原生标签前面有逗号引用时仍可激活后面的同名结构标题，选择已有空格的出现位置',{skip:process.platform!=='darwin'},()=>{
  const r=check('先核对 #KR2，依据待确认。\n### #KR2 合成指标\n');
  assert.equal(r.ok,true);assert.equal(r.value.length,4);assert.equal(r.value.location,20);
});
test('同名标签均无空格或换行时明确拒绝，不选择标点范围',{skip:process.platform!=='darwin'},()=>{
  const r=check('先核对 #KR2，另见 #KR2。');
  assert.equal(r.ok,false);assert.equal(r.code,'TAG_DELIMITER_REQUIRED');
});

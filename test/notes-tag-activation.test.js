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
  assert.equal(r.value.temporaryDelimiter,false);
});
test('只有标点引用的标签使用临时分隔，不选择或替换原标点',{skip:process.platform!=='darwin'},()=>{
  const r=check('先核对 #KR2，另见 #KR2。');
  assert.equal(r.ok,true);assert.equal(r.value.location,4);assert.equal(r.value.length,4);
  assert.equal(r.value.temporaryDelimiter,true);
});
test('中文冒号紧贴的正文引用不抢占可激活的结构标题',{skip:process.platform!=='darwin'},()=>{
  const raw='候选目标：#KR2 合成指标\n### #KR2 合成指标\n';
  const r=check(raw);assert.equal(r.ok,true);assert.equal(r.value.location,raw.lastIndexOf('#KR2'));assert.equal(r.value.temporaryDelimiter,false);
});
test('仅有不支持的冒号引用时保留已有分隔，不插入额外空格',{skip:process.platform!=='darwin'},()=>{
  const r=check('候选目标：#KR2 合成指标');assert.equal(r.ok,true);assert.equal(r.value.temporaryDelimiter,false);
});

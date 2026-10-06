import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const helper=fileURLToPath(new URL('../native/notes-tags.swift',import.meta.url));
function check(delayMs, timeoutMs) {
  return JSON.parse(execFileSync('/usr/bin/swift',[helper],{input:JSON.stringify({command:'checkWriteReadback',rawPlaintext:'合成旧正文',target:'合成新正文',delayMs,timeoutMs}),encoding:'utf8',timeout:30000}));
}
test('粘贴消费延迟超过150ms时等待实际新正文，不重新执行写入',{skip:process.platform!=='darwin'},()=>{
  const r=check(350,1000); assert.equal(r.ok,true); assert.equal(r.value.matched,true);
});
test('正文持续未改变时有界结束并保留结果未知，不能宣称写入成功',{skip:process.platform!=='darwin'},()=>{
  const r=check(1000,150); assert.equal(r.ok,false); assert.equal(r.code,'WRITE_RESULT_UNKNOWN');
});

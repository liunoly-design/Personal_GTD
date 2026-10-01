import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGuidance} from '../src/okr-guidance.js';
const period='# 2026 第四季度（2026-10-01 至 2026-12-31）';
const objective=period+'\n## #O1 改善体力';
const kr=i=>`\n### #KR${i} 合成结果${i}\n基线：未知；目标值：待确认；证据：合成记录；检查日期：2026-12-31`;
const value=(draft,stage='okr')=>({stage,summary:'待核对',advice:'建议先确认目标价值，因为投入有限。',questions:['这个改变为什么值得优先投入？'],draft});
test('允许逐项建立O和KR，完整草案要求每个O有3至5个KR及明确周期层级',()=>{
 assert.equal(validateGuidance(value(objective)).draft,objective);
 for(const count of [1,2,6])assert.throws(()=>validateGuidance(value(objective+Array.from({length:count},(_,i)=>kr(i+1)).join(''),'ready')),/INVALID_GUIDANCE/);
 for(const count of [3,5])assert.ok(validateGuidance(value(objective+Array.from({length:count},(_,i)=>kr(i+1)).join(''),'ready')));
 for(const bad of [objective.replace('2026-12-31','2026-09-30'),objective.replace('2026-10-01','2026-02-30'),objective.replace('## #O1','#O1')])assert.throws(()=>validateGuidance(value(bad)),/INVALID_GUIDANCE/);
});

test('每个O分别检查KR数量，拒绝孤立KR与重复标签', () => {
  const three = objective + kr(1) + kr(2) + kr(3);
  for (const bad of [period + kr(1), three + '\n## #O2 另一目标' + kr(4), three + kr(1)]) {
    assert.throws(() => validateGuidance(value(bad, 'ready')), /INVALID_GUIDANCE/);
  }
  assert.throws(() => validateGuidance(value(null, 'challenge')), /INVALID_GUIDANCE/);
});

test('前一个O至少三个KR后才允许新增下一个O，每轮只改变一个条目', async () => {
  const { validateOkrStep } = await import('../src/okr-structure.js');
  assert.throws(() => validateOkrStep(objective, objective + '\n## #O2 另一目标'), /INCOMPLETE_OBJECTIVE/);
  assert.throws(() => validateOkrStep(objective, objective + kr(1) + kr(2)), /MULTIPLE_OKR_ITEMS/);
  const three = objective + kr(1) + kr(2) + kr(3);
  assert.doesNotThrow(() => validateOkrStep(three, three + '\n## #O2 另一目标'));
  assert.doesNotThrow(() => validateOkrStep(objective, objective + kr(1)));
});

test('在末尾空行的O后新增一个KR不把排版分隔算作修改第二项', async () => {
  const { validateOkrStep } = await import('../src/okr-structure.js');
  const before = objective + '\n基线：未知，先澄清。\n\n';
  const after = before + '### #KR1 合成结果\n基线：未知；目标值：待确认。';
  assert.doesNotThrow(() => validateOkrStep(before, after));
  assert.doesNotThrow(() => validateOkrStep(objective, objective + '\n' + kr(1)));
});

test('单项变更保留兄弟条目、层级和原周期，拒绝多项或越权父节点', async () => {
  const { applyOkrChange } = await import('../src/okr-structure.js');
  const before = objective + kr(1) + kr(2) + kr(3) + '\n\n## #O2 合成第二目标\n原文保持不变。';
  const edit = { operation: 'upsert', id: '#KR1', parentId: '#O1', text: '### #KR1 明确合成结果\n目标值：待用户确认。' };
  const after = applyOkrChange(before, edit);
  assert.ok(after.includes('### #KR1 明确合成结果\n目标值：待用户确认。'));
  assert.ok(after.endsWith(kr(2) + kr(3) + '\n\n## #O2 合成第二目标\n原文保持不变。'));
  assert.equal(applyOkrChange(before, null), before);
  const added = applyOkrChange(before, { ...edit, id: '#KR4', text: '### #KR4 合成新增结果' });
  assert.ok(added.indexOf('#KR4') < added.indexOf('#O2'));
  for (const invalid of [[edit, edit], { ...edit, parentId: '#O2' }, { ...edit, text: edit.text + '\n### #KR9 隐藏第二项' },
    { ...edit, otherChange: edit }, { operation: 'delete', id: '#O1', parentId: null, text: null }]) {
    assert.throws(() => applyOkrChange(before, invalid), /INVALID_GUIDANCE/);
  }
  assert.throws(() => applyOkrChange(objective, { operation: 'delete', id: '#O1', parentId: null, text: null }), /INVALID_GUIDANCE/);
  assert.throws(() => applyOkrChange(objective, { operation: 'upsert', id: '#O2', parentId: null, text: '## #O2 过早的新目标' }), /INCOMPLETE_OBJECTIVE/);
});

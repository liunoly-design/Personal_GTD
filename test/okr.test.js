import {sampleDraft, sampleGuide} from '../examples/okr-sample.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openOkrSession } from '../src/okr-session.js';

function fixture(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-okr-'));
  const notes = [];
  const plaintext = body => body.replaceAll('<br>', '\n').replace(/<[^>]+>/gu, '').replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
  const bridge = async r => {
    if (r.command === 'bind') return { accountId: 'a1', folderId: 'f1' };
    if (r.command === 'create') { const n = { title: r.title, id: 'n' + (notes.length + 1), body: r.body, plaintext: plaintext(r.body) }; notes.push(n); return structuredClone(n); }
    if (r.command === 'find') return structuredClone(notes.filter(n => n.title === r.title && n.body.includes(r.marker)));
    const n = notes.find(n => n.id === r.noteId);
    if (!n) throw new Error('LOCATION_NOT_UNIQUE');
    if (r.command === 'append' || r.command === 'replace') {
      if (r.expectedBody !== n.body) throw new Error('CONFLICT');
      n.body = r.command === 'replace' ? r.body : n.body + r.addition; n.plaintext = plaintext(n.body);
    }
    return structuredClone(n);
  };
  const options = { statePath: join(dir, 'okr.sqlite'), config: { account: 'iCloud', folder: 'Notes' }, bridge, ...overrides };
  let session = openOkrSession(options);
  t.after(async () => { await session.close(); rmSync(dir, { recursive: true, force: true }); });
  return { notes, options, bridge, get session() { return session; }, async restart(override = {}) {
    await session.close(); session = openOkrSession({ ...options, ...override });
  } };
}
const event = (id, action, text = '') => ({ id, action, text, senderId: 'user', conversationId: 'chat', sentAt: '2026-09-27T10:00:00Z' });

test('启动创建固定日志，保存带标签的原文，重启后读回续接', async t => {
  const f = fixture(t);
  const opened = await f.session.handle(event('1', 'open'));
  assert.equal(opened.status, 'okr_open');
  assert.match(opened.receipt, /个人情况/);
  assert.equal((await f.session.handle(event('2', 'record', '#O1 健康\n#KR1 每周运动三次'))).status, 'okr_saved');
  await f.restart();
  const resumed = await f.session.handle(event('3', 'open'));
  assert.equal(resumed.noteId, opened.noteId);
  assert.match(resumed.receipt, /#KR1 每周运动三次/);
  assert.equal(f.notes.length, 1);
});

test('重复来源不重复写入；同 ID 改文拒绝，HTML 原文转义', async t => {
  const f = fixture(t);
  await f.session.handle(event('1', 'open'));
  const input = event('2', 'record', '#KR1 <script> & 记录');
  await f.session.handle(input);
  await f.restart();
  await f.session.handle(input);
  assert.equal(f.notes[0].body.split('&lt;script&gt;').length, 2);
  await assert.rejects(f.session.handle({ ...input, text: '不同内容' }), /EVENT_CONFLICT/);
});

test('创建响应丢失后重启按标识核对，只保留一篇日志', async t => {
  const f = fixture(t);
  await f.restart({ bridge: async r => { const value = await f.bridge(r); if (r.command === 'create') throw new Error('APPLE_TIMEOUT'); return value; } });
  await assert.rejects(f.session.handle(event('1', 'open')), /APPLE_TIMEOUT/);
  await f.restart();
  assert.equal((await f.session.handle(event('1', 'open'))).noteId, 'n1');
  assert.equal(f.notes.length, 1);
});

test('追加已落地但响应丢失，重启核对后不会重复或丢掉后续记录', async t => {
  const f = fixture(t);
  await f.session.handle(event('1', 'open'));
  await f.restart({ bridge: async r => { const value = await f.bridge(r); if (r.command === 'append') throw new Error('APPLE_TIMEOUT'); return value; } });
  await assert.rejects(f.session.handle(event('2', 'record', '#KR1 首次记录')), /APPLE_TIMEOUT/);
  await f.restart();
  await f.session.handle(event('3', 'record', '#KR2 后续记录'));
  await f.session.handle(event('2', 'record', '#KR1 首次记录'));
  assert.equal(f.notes[0].body.split('首次记录').length, 2);
  assert.match(f.notes[0].body, /后续记录/);
});

test('暂停后不保存回复；重新启动才恢复，另一个会话须独立启动', async t => {
  const f = fixture(t);
  await f.session.handle(event('1', 'open'));
  assert.equal((await f.session.handle(event('2', 'pause'))).status, 'okr_paused');
  await f.restart();
  assert.equal((await f.session.handle(event('3', 'record', '暂停期间'))).status, 'okr_paused');
  await f.session.handle(event('4', 'open'));
  assert.equal((await f.session.handle({ ...event('5', 'record', '其他会话'), conversationId: 'other' })).status, 'okr_paused');
  assert.equal((await f.session.handle(event('6', 'record', '恢复记录'))).status, 'okr_saved');
  assert.doesNotMatch(f.notes[0].body, /暂停期间|其他会话/);
});

test('超长或无效输入在 Apple 访问前拒绝，长预览明确标注截断', async t => {
  const f = fixture(t);
  for (const e of [event('1', 'record', 'x'.repeat(4001)), event('2', 'record', ' '), event('3', 'bad'), { ...event('4', 'open'), id: '' }]) {
    await assert.rejects(f.session.handle(e), /INVALID_INPUT/);
  }
  assert.equal(f.notes.length, 0);
  await f.session.handle(event('5', 'open'));
  await f.session.handle(event('6', 'record', '文字'.repeat(1800)));
  assert.match((await f.session.handle(event('7', 'open'))).receipt, /仅显示末尾/);
});

test('长期讨论日志超过旧正文上限仍能记录，不丢失既有历史', async t => {
  const f = fixture(t);
  await f.session.handle(event('1', 'open'));
  f.notes[0].body = 'x'.repeat(40000); f.notes[0].plaintext = f.notes[0].body;
  assert.equal((await f.session.handle(event('2', 'record', '合成后续回答'))).status, 'okr_saved');
  assert.ok(f.notes[0].body.startsWith('x'.repeat(40000)));
  assert.match(f.notes[0].body, /合成后续回答/);
});

test('笔记达到容量时拒绝新增记录并保留原文', async t => {
  const f = fixture(t);
  await f.session.handle(event('1', 'open'));
  f.notes[0].body = 'x'.repeat(65530); f.notes[0].plaintext = f.notes[0].body;
  await assert.rejects(f.session.handle(event('2', 'record', '不能挤掉旧记录')), /CAPACITY_EXCEEDED/);
  assert.equal(f.notes[0].body.length, 65530);
});

test('创建结果未核实时不补建；追加未知或人工冲突阻止后续写入', async t => {
  const f = fixture(t);
  await f.restart({ bridge: async r => { if (r.command === 'create') throw new Error('APPLE_TIMEOUT'); return f.bridge(r); } });
  await assert.rejects(f.session.handle(event('1', 'open')), /APPLE_TIMEOUT/);
  await f.restart();
  await assert.rejects(f.session.handle(event('1', 'open')), /CREATE_RESULT_UNKNOWN/);
  assert.equal(f.notes.length, 0);
});

test('追加未知且外部未落地时停止；不重复写入或继续新记录', async t => {
  const f = fixture(t);
  await f.session.handle(event('1', 'open'));
  await f.restart({ bridge: async r => { if (r.command === 'append') throw new Error('APPLE_TIMEOUT'); return f.bridge(r); } });
  await assert.rejects(f.session.handle(event('2', 'record', '未落地')), /APPLE_TIMEOUT/);
  await f.restart();
  await assert.rejects(f.session.handle(event('3', 'record', '后续')), /UPDATE_RESULT_UNKNOWN/);
  assert.doesNotMatch(f.notes[0].body, /未落地|后续/);
});

test('人工编辑冲突保留外部内容，不覆盖、不另建', async t => {
  const f = fixture(t);
  await f.session.handle(event('1', 'open'));
  await f.restart({ bridge: async r => {
    if (r.command === 'append') f.notes[0].body += '<div>人工编辑</div>';
    return f.bridge(r);
  } });
  await assert.rejects(f.session.handle(event('2', 'record', '新记录')), /CONFLICT/);
  assert.match(f.notes[0].body, /人工编辑/);
  assert.doesNotMatch(f.notes[0].body, /新记录/);
});

test('跨进程占用或更改绑定拒绝；笔记丢失不创建替代', async t => {
  const f = fixture(t);
  assert.throws(() => openOkrSession(f.options), /STATE_IN_USE/);
  await f.session.handle(event('1', 'open'));
  await f.session.close();
  assert.throws(() => openOkrSession({ ...f.options, config: { account: 'iCloud', folder: 'Other' } }), /BINDING_CHANGED/);
  await f.restart();
  f.notes.length = 0;
  await assert.rejects(f.session.handle(event('2', 'open')), /LOCATION_NOT_UNIQUE/);
  assert.equal(f.notes.length, 0);
});

test('追加后读回丢失旧记录不能宣告成功，也不能继续覆盖', async t => {
  const f = fixture(t);
  await f.session.handle(event('1', 'open'));
  await f.session.handle(event('2', 'record', '必须保留的旧记录'));
  await f.restart({ bridge: async r => {
    const value = await f.bridge(r);
    if (r.command === 'append' || r.command === 'replace') {
      f.notes[0].body = f.notes[0].body.replace('必须保留的旧记录', '');
      f.notes[0].plaintext = f.notes[0].plaintext.replace('必须保留的旧记录', '');
    }
    return value;
  } });
  await assert.rejects(f.session.handle(event('3', 'record', '新记录')), /READBACK_FAILED/);
  await f.restart();
  await assert.rejects(f.session.handle(event('4', 'record', '后续')), /UPDATE_RESULT_UNKNOWN/);
});

test('逐轮引导与原回答一起保存，重启和重投不重复调用模型', async t => {
  let calls=0;
  const f=fixture(t,{guide:async input=>{
    calls++;assert.equal(input.stage,'background');assert.equal(input.answer,'每周两小时');
    return {stage:'direction',summary:'每周两小时，待核对。',advice:'比较运动和改善睡眠的成本。',questions:['优先改善哪一个？'],draft:null};
  }});
  await f.session.handle(event('1','open'));
  const result=await f.session.handle(event('2','record','每周两小时'));
  assert.match(result.receipt,/优先改善哪一个/);
  assert.match(f.notes[0].plaintext,/每周两小时/);
  assert.match(f.notes[0].plaintext,/比较运动和改善睡眠/);
  await f.restart();
  assert.deepEqual(await f.session.handle(event('2','record','每周两小时')),result);
  assert.equal(calls,1);
});

const draftText = sampleDraft;
const stagedGuide = sampleGuide;
async function readyDraft(f) {
  await f.session.handle(event('open','open'));
  let result;
  for(let i=1;i<=7;i++) result=await f.session.handle(event('round'+i,'record','合成回应'+i));
  return result;
}

test('经反向审视后显式确认当前草案才创建最新稿，重复确认跨重启不增笔记', async t => {
  const f=fixture(t,{guide:stagedGuide()});
  const ready=await readyDraft(f);
  assert.ok(ready.draftVersion);assert.equal(f.notes.length,1);
  const confirmation={...event('confirm','confirm'),confirmVersion:ready.draftVersion};
  const result=await f.session.handle(confirmation);
  assert.equal(result.status,'okr_finalized');assert.equal(f.notes.length,2);
  assert.match(f.notes[1].plaintext,/#O1 改善体力/);
  assert.match(f.notes[0].plaintext,/用户确认定稿/);
  await f.restart();
  assert.deepEqual(await f.session.handle(confirmation),result);
  assert.equal(f.notes.length,2);
});

test('再次定稿替换同一最新稿并归档旧版，重新打开显示当前目标', async t => {
  const guide=stagedGuide();let revised=false;
  const f=fixture(t,{guide:async args=>{const v=await guide(args);return revised?{...v,draft:v.draft?.replace('改善体力','改善耐力')??null}:v;}});
  const first=await readyDraft(f);
  await f.session.handle({...event('c1','confirm'),confirmVersion:first.draftVersion});
  revised=true;
  const next=await f.session.handle(event('new','record','调整为耐力'));
  await f.session.handle({...event('c2','confirm'),confirmVersion:next.draftVersion});
  assert.equal(f.notes.length,2);assert.match(f.notes[1].plaintext,/改善耐力/);assert.doesNotMatch(f.notes[1].plaintext,/改善体力/);
  assert.match(f.notes[0].plaintext,/旧版：/);assert.match(f.notes[0].plaintext,/改善体力/);
  await f.restart();
  assert.match((await f.session.handle(event('reopen','open'))).receipt,/当前目标/);
});

test('旧版、跨会话或未关联确认不能定稿，普通认可仅继续讨论', async t => {
  const f=fixture(t,{guide:stagedGuide()});
  const first=await readyDraft(f);
  await f.session.handle(event('other-open','open'));
  const next=await f.session.handle(event('change','record','好的，但把投入再减少一些'));
  assert.equal((await f.session.handle({...event('old','confirm'),confirmVersion:first.draftVersion})).status,'okr_needs_confirmation');
  await f.session.handle({...event('open-other','open'),conversationId:'other'});
  assert.equal((await f.session.handle({...event('cross','confirm'),conversationId:'other',confirmVersion:next.draftVersion})).status,'okr_needs_confirmation');
  assert.equal((await f.session.handle(event('bare','confirm'))).status,'okr_needs_confirmation');
  assert.equal(f.notes.length,1);
});

test('模型不可用或跳过审视时保存原文、不生成可确认草案，重复不重调', async t => {
  let calls=0;
  const f=fixture(t,{guide:async()=>{calls++;return {stage:'ready',summary:'跳过背景',advice:'直接定稿',questions:[],draft:draftText};}});
  await f.session.handle(event('1','open'));
  assert.equal((await f.session.handle(event('2','record','需要先讨论'))).status,'okr_guidance_failed');
  await f.restart();await f.session.handle(event('2','record','需要先讨论'));
  assert.equal(calls,1);assert.match(f.notes[0].plaintext,/需要先讨论/);
  assert.equal((await f.session.handle(event('3','confirm'))).status,'okr_needs_confirmation');
});

test('日志已写但最新稿创建响应丢失，重启核对后只保留两篇', async t => {
  const f=fixture(t,{guide:stagedGuide()});const ready=await readyDraft(f);
  const confirm={...event('confirm','confirm'),confirmVersion:ready.draftVersion};
  await f.restart({bridge:async r=>{const value=await f.bridge(r);if(r.command==='create')throw new Error('APPLE_TIMEOUT');return value;}});
  await assert.rejects(f.session.handle(confirm),/APPLE_TIMEOUT/);
  await f.restart();
  assert.equal((await f.session.handle(confirm)).status,'okr_finalized');
  assert.equal(f.notes.length,2);assert.equal(f.notes[0].plaintext.split('用户确认定稿').length,2);
});

test('人工修改最新稿使待确认草案过期，不能覆盖；未知写入阻止新轮次', async t => {
  const f=fixture(t,{guide:stagedGuide()});const first=await readyDraft(f);
  await f.session.handle({...event('c1','confirm'),confirmVersion:first.draftVersion});
  const next=await f.session.handle(event('new','record','继续修改'));
  f.notes[1].body+='<div>人工修改</div>';f.notes[1].plaintext+='人工修改';
  await assert.rejects(f.session.handle({...event('c2','confirm'),confirmVersion:next.draftVersion}),/CONFLICT/);
  assert.match(f.notes[1].body,/人工修改/);
});

test('最新稿替换响应丢失后核对同一 ID，历史不重复追加', async t => {
  const f=fixture(t,{guide:stagedGuide()});const first=await readyDraft(f);
  await f.session.handle({...event('c1','confirm'),confirmVersion:first.draftVersion});
  const next=await f.session.handle(event('new','record','保持目标并更新说明'));
  const confirmation={...event('c2','confirm'),confirmVersion:next.draftVersion};
  await f.restart({bridge:async r=>{const value=await f.bridge(r);if(r.command==='replace')throw new Error('APPLE_TIMEOUT');return value;}});
  await assert.rejects(f.session.handle(confirmation),/APPLE_TIMEOUT/);
  await assert.rejects(f.session.handle(event('blocked','record','不应开始新轮次')),/RECOVERY_REQUIRED/);
  await f.restart();
  assert.equal((await f.session.handle(confirmation)).noteId,'n2');
  assert.equal(f.notes.length,2);assert.equal(f.notes[0].plaintext.split('用户确认定稿').length,3);
});

test('日志已落地但最新稿未落地时不重试写入或虚报定稿', async t => {
  const f=fixture(t,{guide:stagedGuide()});const ready=await readyDraft(f);
  const confirmation={...event('c','confirm'),confirmVersion:ready.draftVersion};
  await f.restart({bridge:async r=>{if(r.command==='create')throw new Error('APPLE_TIMEOUT');return f.bridge(r);}});
  await assert.rejects(f.session.handle(confirmation),/APPLE_TIMEOUT/);
  await f.restart();
  await assert.rejects(f.session.handle(confirmation),/CREATE_RESULT_UNKNOWN/);
  assert.equal(f.notes.length,1);assert.equal(f.notes[0].plaintext.split('用户确认定稿').length,2);
});

test('模型超时保存原文且停止阶段推进，同一事件不再次请求', async t => {
  let calls=0;
  const f=fixture(t,{guideTimeoutMs:5,guide:async()=>{calls++;return new Promise(()=>{});}});
  await f.session.handle(event('1','open'));
  assert.equal((await f.session.handle(event('2','record','模型失败也要保存'))).status,'okr_guidance_failed');
  await f.restart();await f.session.handle(event('2','record','模型失败也要保存'));
  assert.equal(calls,1);assert.match(f.notes[0].plaintext,/模型失败也要保存/);
});

test('模型缓存不能把随后人工编辑的最新稿当作已分析版本', async t => {
  const f=fixture(t,{guide:stagedGuide()});const first=await readyDraft(f);
  await f.session.handle({...event('c1','confirm'),confirmVersion:first.draftVersion});
  let failRead=true;
  await f.restart({bridge:async r=>{
    // Latest-note pre-read succeeds; the log write itself is rejected before mutating.
    if(r.command==='append'&&failRead){failRead=false;throw new Error('CONFLICT');}
    return f.bridge(r);
  }});
  await assert.rejects(f.session.handle(event('new','record','讨论修改')),/CONFLICT/);
  // The unresolved append remains conservative: no new model or publication may proceed.
  f.notes[1].body+='<div>人工新内容</div>';f.notes[1].plaintext+='人工新内容';
  await f.restart();
  await assert.rejects(f.session.handle(event('new','record','讨论修改')),/UPDATE_RESULT_UNKNOWN|CONFLICT/);
  assert.match(f.notes[1].plaintext,/人工新内容/);
});

test('正文成功但原生标签失败不能报保存成功，核对修复后恢复且不重复追加', async t => {
  const f = fixture(t);
  await f.session.handle(event('native-open', 'open'));
  let complete = false, writes = 0;
  await f.restart({ bridge: async r => {
    if (r.command === 'append') writes++;
    const result = await f.bridge(r);
    return r.command === 'read' ? { ...result, tagsComplete: complete } : result;
  } });
  const input = event('native-record', 'record', '#O1 合成目标');
  await assert.rejects(f.session.handle(input), /READBACK_FAILED/);
  await assert.rejects(f.session.handle(input), /UPDATE_RESULT_UNKNOWN/);
  complete = true;
  assert.equal((await f.session.handle(input)).status, 'okr_saved');
  assert.equal(writes, 1);
});

test('最新稿原生标签未完成时保留定稿恢复状态，不重复创建第二篇笔记', async t => {
  const f = fixture(t, { guide: stagedGuide() });
  const draft = await readyDraft(f);
  let complete = false;
  await f.restart({ bridge: async r => {
    const value = await f.bridge(r);
    return r.command === 'read' && value.id === 'n2' ? { ...value, tagsComplete: complete } : value;
  } });
  const confirm = { ...event('native-confirm', 'confirm'), confirmVersion: draft.draftVersion };
  await assert.rejects(f.session.handle(confirm), /UPDATE_RESULT_UNKNOWN/);
  assert.equal(f.notes.length, 2);
  complete = true;
  assert.equal((await f.session.handle(confirm)).status, 'okr_finalized');
  assert.equal(f.notes.length, 2);
});

test('正文成功但标题格式失败不能报保存成功，核对修复后恢复且不重复追加', async t => {
  const f = fixture(t);
  await f.session.handle(event('heading-open', 'open'));
  let complete = false, writes = 0;
  await f.restart({ bridge: async r => {
    if (r.command === 'append') writes++;
    const result = await f.bridge(r);
    return r.command === 'read' ? { ...result, headingsComplete: complete } : result;
  } });
  const input = event('heading-record', 'record', '#O1 合成目标');
  await assert.rejects(f.session.handle(input), /READBACK_FAILED/);
  await assert.rejects(f.session.handle(input), /UPDATE_RESULT_UNKNOWN/);
  complete = true;
  assert.equal((await f.session.handle(input)).status, 'okr_saved');
  assert.equal(writes, 1);
});

test('最新稿标题格式未完成时保留定稿恢复状态，不重复创建第二篇笔记', async t => {
  const f = fixture(t, { guide: stagedGuide() });
  const draft = await readyDraft(f);
  let complete = false;
  await f.restart({ bridge: async r => {
    const value = await f.bridge(r);
    return r.command === 'read' && value.id === 'n2' ? { ...value, headingsComplete: complete } : value;
  } });
  const confirm = { ...event('heading-confirm', 'confirm'), confirmVersion: draft.draftVersion };
  await assert.rejects(f.session.handle(confirm), /UPDATE_RESULT_UNKNOWN/);
  assert.equal(f.notes.length, 2);
  complete = true;
  assert.equal((await f.session.handle(confirm)).status, 'okr_finalized');
  assert.equal(f.notes.length, 2);
});

test('每轮只推进一个O或KR，重启后把工作草案传回模型', async t => {
  const heading = '# 2026 第四季度（2026-10-01 至 2026-12-31）\n## #O1 改善体力';
  let calls = 0, seen;
  const guide = async input => {
    seen = input;
    calls++;
    return { stage: calls === 1 ? 'direction' : 'okr', summary: '待用户核对', advice: '先确认目标意义，再讨论关键结果。', questions: ['这个改变为何值得投入？'],
      draft: calls === 1 ? null : calls === 2 ? heading : heading + '\n### #KR1 结果一\n### #KR2 结果二' };
  };
  const f = fixture(t, { guide });
  await f.session.handle(event('focus-open', 'open'));
  await f.session.handle(event('focus-1', 'record', '讨论2026第四季度'));
  await f.session.handle(event('focus-2', 'record', '希望改善体力'));
  await f.restart();
  const reply = await f.session.handle(event('focus-3', 'record', '先讨论第一个KR'));
  assert.equal(seen.workingDraft, heading);
  assert.equal(reply.status, 'okr_guidance_failed');
  assert.equal(reply.guidanceFailure, 'MULTIPLE_OKR_ITEMS');
  const opened = await f.session.handle(event('focus-resume', 'open'));
  assert.match(opened.receipt, /当前工作草案/);
  assert.match(opened.receipt, /改善体力/);
});

test('草案尚未形成时重启仍保留已澄清事实和当前问题，不重新追问周期', async t => {
  let received;
  const f = fixture(t, { guide: async input => { received = input; return { stage: 'direction', summary: '合成事实：周期已确认，旧目标为测试内容；当前仅讨论产品方向。', advice: '先验证客户需要。', questions: ['哪类客户问题已获得实际付费证据？'], draft: null }; } });
  await f.session.handle(event('start', 'open'));
  await f.session.handle(event('first', 'record', '合成背景'));
  await f.restart();
  const opened = await f.session.handle(event('resume', 'open'));
  assert.match(opened.receipt, /继续上一轮问题：哪类客户问题已获得实际付费证据/);
  await f.session.handle(event('second', 'record', '补充合成证据'));
  assert.match(received.discussionSummary, /旧目标为测试内容/);
  assert.equal(received.lastQuestion, '哪类客户问题已获得实际付费证据？');
});

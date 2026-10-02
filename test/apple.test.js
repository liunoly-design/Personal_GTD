import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openAppleReminders } from '../src/apple-reminders.js';
import { openDurableCapture } from '../src/durable-capture.js';
import { simulatedAnalysis } from '../src/simulation.js';

test('Apple 创建响应丢失后只核对操作标识，不重复写入', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-apple-'));
  const items = [];
  // Native EventKit process is the external system boundary.
  const bridge = async input => {
    if (input.command === 'boundList') return { id: 'apple-list', name: 'Inbox', sourceId: 'source-1' };
    if (input.command === 'lists') return { lists: [{ id: 'apple-list', name: 'Inbox', sourceId: 'source-1' }] };
    if (input.command === 'createItem') {
      items.push({ id: 'apple-item', listId: input.listId, title: input.title, notes: input.notes });
      throw new Error('Response lost');
    }
    if (input.command === 'findCreate') return { state: 'applied', value: items[0] };
    throw new Error('Unexpected command');
  };
  const apple = openAppleReminders({ statePath: join(dir, 'apple.sqlite'), sourceId: 'source-1', bridge });
  const capture = openDurableCapture({ journalPath: join(dir, 'capture.sqlite'), reminders: apple, analyze: simulatedAnalysis });
  t.after(async () => { await capture.close(); apple.close(); rmSync(dir, { recursive: true, force: true }); });
  const event = { id: 'a1', senderId: 'demo-user', conversationId: 'demo-chat', sentAt: '2026-09-27T10:00:00+08:00', type: 'text', text: '小婕 GTD，收集：PGTD 测试' };
  assert.equal((await capture.handle(event)).status, 'result_unknown');
  assert.equal((await capture.recover())[0].itemId, 'apple-item');
  assert.equal(items.length, 1);
});

test('Apple 无法核实时停止写入，权限拒绝不声称保存成功', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-apple-denied-'));
  let writes = 0;
  const bridge = async input => {
    if (input.command === 'lists') return { lists: [{ id: 'L', name: 'Inbox' }] };
    if (input.command === 'boundList') return { id: 'L', name: 'Inbox' };
    if (input.command === 'findCreate') return { state: 'unknown' };
    if (input.command === 'createItem') { writes++; throw Object.assign(new Error('Denied'), { code: 'WRITE_REJECTED' }); }
    throw new Error('Unexpected');
  };
  const apple = openAppleReminders({ statePath: join(dir, 'apple.sqlite'), sourceId: 'S', bridge });
  const capture = openDurableCapture({ journalPath: join(dir, 'capture.sqlite'), reminders: apple, analyze: simulatedAnalysis });
  t.after(async () => { await capture.close(); apple.close(); rmSync(dir, { recursive: true, force: true }); });
  const event = { id: 'denied', senderId: 'demo-user', conversationId: 'demo-chat', sentAt: '2026-09-27T10:00:00+08:00', type: 'text', text: '小婕 GTD，收集：测试' };
  assert.equal((await capture.handle(event)).status, 'failed');
  assert.equal((await capture.recover())[0].status, 'result_unknown');
  assert.equal(writes, 1);
});

test('Apple查询只读绑定列表，未绑定返回同名候选不自动选择或创建', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-query-apple-'));
  const requests = [];
  const bridge = async input => {
    requests.push(input);
    if (input.command === 'lists') return { lists: [{ id: 'L1', name: 'Inbox' }, { id: 'L2', name: 'Inbox' }] };
    if (input.command === 'queryTasks') return { state: 'ok', list: { id: 'L1', name: 'Inbox', sourceId: 'S' },
      items: [{ id: 'manual-item', listId: 'L1', title: '人工任务', completed: false }], total: 1, hasMore: false };
    throw new Error('Write forbidden');
  };
  let apple = openAppleReminders({ statePath: join(dir, 'apple.sqlite'), sourceId: 'S', bridge });
  t.after(() => { apple.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.deepEqual(await apple.queryTasks({ limit: 20, offset: 0 }), { state: 'needs_list', candidates: [{ id: 'L1', name: 'Inbox' }, { id: 'L2', name: 'Inbox' }] });
  apple.close();
  apple = openAppleReminders({ statePath: join(dir, 'bound.sqlite'), sourceId: 'S', listId: 'L1', bridge });
  assert.equal((await apple.queryTasks({ limit: 20, offset: 0 })).items[0].id, 'manual-item');
  assert.deepEqual(requests[1], { command: 'queryTasks', sourceId: 'S', listId: 'L1', limit: 20, offset: 0 });
  await assert.rejects(apple.queryTasks({ limit: 51, offset: 0 }), /Invalid query/);
  assert.equal(requests.length, 2);
});

test('未绑定查询提示后可显式配置列表，同一已绑定目录不允许换目标', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-query-config-'));
  const bridge = async r => r.command === 'lists' ? { lists: [{ id: 'L', name: 'Inbox' }] }
    : { state: 'ok', list: { id: r.listId, name: 'Inbox', sourceId: 'S' }, items: [], total: 0, hasMore: false };
  let apple = openAppleReminders({ statePath: join(dir, 'adapter.sqlite'), sourceId: 'S', bridge });
  t.after(() => { apple?.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.equal((await apple.queryTasks({ limit: 20, offset: 0 })).state, 'needs_list');
  apple.close();
  apple = openAppleReminders({ statePath: join(dir, 'adapter.sqlite'), sourceId: 'S', listId: 'L', bridge });
  assert.equal((await apple.queryTasks({ limit: 20, offset: 0 })).list.id, 'L');
  apple.close();
  apple = undefined;
  assert.throws(() => openAppleReminders({ statePath: join(dir, 'adapter.sqlite'), sourceId: 'S', listId: 'other', bridge }), /binding changed/);
});

test('插件复制目录缺少runtime时使用显式绝对helper路径完成只读查询', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-captured-plugin-'));
  const src = join(dir, 'captured', 'src');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(dir, 'captured', 'package.json'), '{"type":"module"}');
  for (const name of ['apple-reminders.js', 'operation-store.js']) copyFileSync(new URL('../src/' + name, import.meta.url), join(src, name));
  const helperPath = join(dir, 'authorized-helper');
  const value = { state: 'ok', list: { id: 'L', sourceId: 'S', name: 'Inbox' },
    items: [{ id: 'manual-1', listId: 'L', title: '合成任务', completed: false }], total: 1, hasMore: false };
  writeFileSync(helperPath, '#!' + process.execPath + '\nlet text="";process.stdin.on("data",d=>text+=d);process.stdin.on("end",()=>{const r=JSON.parse(text);if(r.command!=="queryTasks"||r.sourceId!=="S"||r.listId!=="L"||r.limit!==20||r.offset!==0)process.exit(2);console.log(' + JSON.stringify(JSON.stringify({ ok: true, value })) + ');});\n', { mode: 0o700 });
  const { openAppleReminders: openCaptured } = await import(pathToFileURL(join(src, 'apple-reminders.js')));
  const apple = openCaptured({ statePath: join(dir, 'state.sqlite'), sourceId: 'S', listId: 'L', helperPath });
  t.after(() => { apple.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.deepEqual(await apple.queryTasks({ limit: 20, offset: 0 }), value);
  assert.throws(() => openCaptured({ statePath: join(dir, 'bad.sqlite'), sourceId: 'S', helperPath: 'relative-helper' }), /absolute/i);
});

test('Apple显式列表查询不发送默认ID或改收集绑定，未绑定也能查询', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-explicit-list-'));
  const requests = [];
  const bridge = async r => { requests.push(r); return r.command === 'lists' ? { lists: [] } : r.command === 'boundList' ? { id: 'inbox', name: 'Inbox', sourceId: 'S' }
    : { state: 'ok', list: { id: 'work', name: '工作', sourceId: 'S' }, items: [], total: 0, hasMore: false }; };
  const apple = openAppleReminders({ statePath: join(dir, 'bound.sqlite'), sourceId: 'S', listId: 'inbox', bridge });
  const unbound = openAppleReminders({ statePath: join(dir, 'unbound.sqlite'), sourceId: 'S', bridge });
  t.after(() => { apple.close(); unbound.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.equal((await apple.queryTasks({ limit: 20, offset: 0, listName: '工作' })).list.id, 'work');
  assert.deepEqual(requests[0], { command: 'queryTasks', sourceId: 'S', listName: '工作', limit: 20, offset: 0 });
  assert.equal((await apple.listLists())[0].id, 'inbox');
  assert.equal((await unbound.queryTasks({ limit: 20, offset: 0, listName: '工作' })).list.id, 'work');
  assert.equal((await unbound.listLists())[0]?.id, undefined);
});

test('Apple按快照引用只读核对非默认人工事项，不开放原写入权限', async t => {
  const dir=mkdtempSync(join(tmpdir(),'pgtd-read-selected-')); const requests=[];
  const value={items:[{id:'manual',state:'ok',value:{id:'manual',listId:'work',sourceId:'S',revision:'a'.repeat(64),completed:false,title:'合成人工事项'}}]};
  const bridge=async r=>{requests.push(r);return r.command==='boundList'?{id:'inbox',sourceId:'S',name:'Inbox'}:value;};
  const apple=openAppleReminders({statePath:join(dir,'state.sqlite'),sourceId:'S',listId:'inbox',bridge});
  t.after(()=>{apple.close();rmSync(dir,{recursive:true,force:true});});
  assert.deepEqual(await apple.readTasks({items:[{id:'manual',listId:'work'}]}),value);
  assert.deepEqual(requests[0],{command:'readTasks',sourceId:'S',items:[{id:'manual',listId:'work'}]});
  assert.equal((await apple.listLists())[0].id,'inbox');
  await assert.rejects(apple.setReminder('manual',{remindAt:'2026-10-04T01:00:00Z'},'a'.repeat(64)),/Unknown PGTD item/);
  for (const items of [[],Array.from({length:11},(_,i)=>({id:'i'+i,listId:'work'})),[{id:'bad\n',listId:'work'}],[{id:'manual',listId:'work'},{id:'manual',listId:'work'}]]) {
    await assert.rejects(apple.readTasks({items}),/Invalid task references/);
  }
});

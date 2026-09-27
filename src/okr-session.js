import { randomUUID, createHash } from 'node:crypto';
import { openOperationStore } from './operation-store.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const html = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\n', '<br>');

export function openOkrSession({ statePath, config, bridge }) {
  config = structuredClone(config);
  if (![config.account, config.folder].every(v => typeof v === 'string' && v.trim() && v.length <= 200)
    || (config.noteId !== undefined && (typeof config.noteId !== 'string' || !config.noteId))) throw new Error('INVALID_LOCATION');
  const store = openOperationStore(statePath);
  const token = randomUUID();
  try {
    store.transaction(() => {
      const owner = store.get('owner');
      if (owner?.pid) {
        let alive = true;
        try { process.kill(owner.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
        if (alive) throw new Error('STATE_IN_USE');
      }
      if (store.get('config') && hash(store.get('config')) !== hash(config)) throw new Error('BINDING_CHANGED');
      store.set('config', config);
      store.set('owner', { pid: process.pid, token });
    });
  } catch (error) { store.close(); throw error; }
  let queue = Promise.resolve(), closed = false;
  async function handle(event) {
    if (!['open', 'record', 'pause'].includes(event.action)
      || ![event.id, event.senderId, event.conversationId].every(v => typeof v === 'string' && v.trim() && v.length <= 256)
      || typeof event.sentAt !== 'string' || !Number.isFinite(Date.parse(event.sentAt))
      || typeof event.text !== 'string' || event.text.length > 4000
      || (event.action === 'record' && !event.text.trim())) throw new Error('INVALID_INPUT');
    const key = 'event:' + hash([event.senderId, event.conversationId, event.id]);
    const fingerprint = hash(event);
    const previous = store.get(key);
    if (previous && previous.fingerprint !== fingerprint) throw new Error('EVENT_CONFLICT');
    if (previous?.result) return previous.result;
    if (!previous && store.entries('event:').length >= 1000) throw new Error('BUDGET_EXHAUSTED');
    const finish = result => { store.set(key, { fingerprint, result }); return result; };
    store.set(key, { fingerprint });
    const sessionKey = 'session:' + hash([event.senderId, event.conversationId]);
    if (event.action === 'pause') store.set(sessionKey, false);
    if (event.action === 'pause' || (event.action === 'record' && !store.get(sessionKey))) {
      return finish({ status: 'okr_paused', receipt: 'OKR 记录已暂停。发送“小婕 gtd okr 讨论”后继续。' });
    }
    let calls = 0;
    const call = request => {
      if (++calls > 6) throw new Error('BUDGET_EXHAUSTED');
      return bridge(request);
    };
    let state = store.get('note');
    if (!state) {
      const binding = await call({ command: 'bind', account: config.account, folder: config.folder });
      state = { ...binding, marker: 'PGTD-OKR-' + randomUUID(), title: 'PGTD OKR 日志', noteId: config.noteId };
      store.set('note', state);
    }
    const request = command => ({ command, accountId: state.accountId, folderId: state.folderId });
    if (!state.noteId && state.creating) {
      const matches = await call({ ...request('find'), title: state.title, marker: state.marker });
      if (matches.length !== 1) throw new Error('CREATE_RESULT_UNKNOWN');
      state.noteId = matches[0].id;
      store.set('note', state);
    }
    if (!state.noteId) {
      state.creating = true;
      store.set('note', state);
      const note = await call({ ...request('create'), title: state.title,
        body: `<div>${state.title}</div><div>${state.marker}</div><div>OKR 讨论记录（草案）</div>` });
      state.noteId = note.id;
      store.set('note', state);
    }
    let note = await call({ ...request('read'), noteId: state.noteId });
    if (note.id !== state.noteId || typeof note.body !== 'string' || typeof note.plaintext !== 'string') throw new Error('READBACK_FAILED');
    const pending = store.get('pending');
    if (pending) {
      if (!note.plaintext.includes(pending.marker) || !note.plaintext.includes(pending.text)
        || !note.plaintext.includes(pending.beforePlaintext)) throw new Error('UPDATE_RESULT_UNKNOWN');
      store.transaction(() => {
        store.set(pending.key, { fingerprint: pending.fingerprint, result: pending.result });
        store.set('pending', null);
      });
      if (pending.key === key) return pending.result;
    }
    if (event.action === 'record') {
      const marker = 'PGTD-ENTRY-' + randomUUID();
      const result = { status: 'okr_saved', noteId: note.id, receipt: '已保存到 OKR 日志。回复此消息可继续记录；启动 OKR 讨论可回看。' };
      const addition = `<div>${html(event.sentAt)}</div><div>${html(event.text)}</div><div>${marker}</div>`;
      if ((note.body + addition).length > 32768) throw new Error('CAPACITY_EXCEEDED');
      const beforePlaintext = note.plaintext.trim();
      store.set('pending', { key, fingerprint, marker, text: event.text, beforePlaintext, result });
      await call({ ...request('append'), noteId: state.noteId, expectedBody: note.body,
        addition });
      note = await call({ ...request('read'), noteId: state.noteId });
      if (note.id !== state.noteId || !note.plaintext.includes(marker) || !note.plaintext.includes(event.text)
        || !note.plaintext.includes(beforePlaintext)) throw new Error('READBACK_FAILED');
      store.transaction(() => { finish(result); store.set('pending', null); });
      return result;
    }
    store.set(sessionKey, true);
    const preview = note.plaintext.replace(/PGTD-(?:ENTRY|OKR)-[a-f0-9-]{36}/gu, '').trim();
    return finish({ status: 'okr_open', noteId: note.id,
      receipt: `已打开 OKR 日志。请介绍个人情况与希望达成的目标，或继续已有记录。回复此消息可保存讨论原文。\n${preview.length > 3000 ? '（仅显示末尾 3000 字符，完整内容在备忘录）\n' : ''}${preview.slice(-3000)}` });
  }
  return {
    handle(event) {
      if (closed) return Promise.reject(new Error('SESSION_CLOSED'));
      const input = structuredClone(event);
      const task = queue.then(() => handle(input)); queue = task.catch(() => {}); return task;
    },
    async close() {
      if (closed) return; closed = true; await queue;
      if (store.get('owner')?.token === token) store.set('owner', null);
      store.close();
    },
  };
}

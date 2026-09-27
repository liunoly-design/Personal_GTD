import { randomUUID } from 'node:crypto';
import { openOperationStore } from './operation-store.js';

// F101 feasibility probe only; the note contains synthetic data throughout.
export async function verifyNotes({ statePath, account, folder, bridge }) {
  if (![account, folder].every(v => typeof v === 'string' && v.length > 0 && v.length <= 200)) throw new Error('INVALID_LOCATION');
  const store = openOperationStore(statePath);
  const owner = randomUUID();
  const started = performance.now();
  let calls = 0;
  const call = async request => {
    if (++calls > 8) throw new Error('BUDGET_EXHAUSTED');
    return bridge(request);
  };
  try {
    store.transaction(() => {
      const lease = store.get('owner');
      if (lease?.pid) {
        let alive = true;
        try { process.kill(lease.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
        if (alive) throw new Error('STATE_IN_USE');
      }
      store.set('owner', { pid: process.pid, token: owner });
    });
    let state = store.get('probe');
    if (state && (state.account !== account || state.folder !== folder)) throw new Error('BINDING_CHANGED');
    if (!state) {
      const binding = await call({ command: 'bind', account, folder });
      const marker = 'PGTD-F101-' + randomUUID();
      state = { account, folder, ...binding, marker, title: 'PGTD F101 合成测试 ' + marker, phase: 'new' };
      store.set('probe', state);
    }
    const request = command => ({ command, accountId: state.accountId, folderId: state.folderId });
    if (state.phase === 'creating') {
      const matches = await call({ ...request('find'), title: state.title, marker: state.marker });
      if (matches.length !== 1) throw new Error('CREATE_RESULT_UNKNOWN');
      state.noteId = matches[0].id;
      state.phase = 'created';
      store.set('probe', state);
    }
    if (state.phase === 'new') {
      state.phase = 'creating';
      store.set('probe', state);
      const note = await call({ ...request('create'), title: state.title, body: `<div>${state.title}</div><div>${state.marker}</div><div>合成初始记录</div>` });
      state.noteId = note.id;
      state.phase = 'created';
      store.set('probe', state);
    }
    const note = await call({ ...request('read'), noteId: state.noteId });
    if (note.id !== state.noteId || !note.plaintext.includes(state.marker) || !note.plaintext.includes('合成初始记录')) throw new Error('READBACK_FAILED');
    const updateMarker = state.marker + '-update-1';
    if (!note.plaintext.includes(updateMarker)) {
      if (['updating', 'verified'].includes(state.phase)) throw new Error('UPDATE_RESULT_UNKNOWN');
      state.phase = 'updating';
      state.snapshot = note.body;
      store.set('probe', state);
      await call({ ...request('append'), noteId: state.noteId, expectedBody: note.body,
        addition: `<div>合成追加记录 ${updateMarker}</div>` });
    }
    const updated = await call({ ...request('read'), noteId: state.noteId });
    if (updated.id !== state.noteId || !updated.plaintext.includes(updateMarker) || !updated.plaintext.includes('合成初始记录') || !updated.plaintext.includes('合成追加记录')) throw new Error('READBACK_FAILED');
    state.phase = 'verified';
    store.set('probe', state);
    return { status: 'verified', noteId: state.noteId, accountId: state.accountId, folderId: state.folderId,
      calls, durationMs: Math.round(performance.now() - started), modelCalls: 0 };
  } finally {
    if (store.get('owner')?.token === owner) store.set('owner', null);
    store.close();
  }
}

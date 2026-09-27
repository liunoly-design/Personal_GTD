import { randomUUID } from 'node:crypto';
const html = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\n', '<br>');

// Two-note publication: archive the accepted revision before replacing the current document.
// Every possibly applied write is reconciled before another write is attempted.
export async function publishOkr({ store, call, binding, logNote, key, fingerprint, draft, sentAt }) {
  const request = command => ({ command, accountId: binding.accountId, folderId: binding.folderId });
  let op = store.get('publication');
  if (op && (op.key !== key || op.fingerprint !== fingerprint)) throw new Error('RECOVERY_REQUIRED');
  if (!op) {
    const latest = store.get('latest');
    const before = latest ? await call({ ...request('read'), noteId: latest.id }) : null;
    if ((before?.body ?? null) !== draft.latestBody) throw new Error('CONFLICT');
    const marker = 'PGTD-FINAL-' + randomUUID();
    const addition = `<div>${html(sentAt)} 用户确认定稿（更新请求；当前内容见最新稿）</div><div>旧版：${html(before?.plaintext ?? '首次定稿')}</div><div>确认稿：${html(draft.text)}</div><div>${marker}</div>`;
    const body = `<div>PGTD OKR 最新稿</div><div>${html(draft.text)}</div><div>${marker}</div>`;
    if ((logNote.body + addition).length > 32768 || body.length > 32768) throw new Error('CAPACITY_EXCEEDED');
    op = { key, fingerprint, marker, title: 'PGTD OKR 最新稿', body, text: draft.text, addition,
      logId: logNote.id, logBody: logNote.body, logPlaintext: logNote.plaintext.trim(),
      latestId: latest?.id, latestBody: before?.body, phase: 'log-new' };
    store.set('publication', op);
  }
  const save = phase => { op.phase = phase; store.set('publication', op); };
  if (op.phase === 'done') return op.result;
  if (op.phase === 'log-new') {
    save('log-writing');
    await call({ ...request('append'), noteId: op.logId, expectedBody: op.logBody, addition: op.addition });
  }
  if (op.phase === 'log-writing') {
    const saved = await call({ ...request('read'), noteId: op.logId });
    if (saved.id !== op.logId || !saved.plaintext.includes(op.marker) || !saved.plaintext.includes(op.text)
      || !saved.plaintext.includes(op.logPlaintext)) throw new Error('UPDATE_RESULT_UNKNOWN');
    save('latest-new');
  }
  if (op.phase === 'latest-new') {
    save('latest-writing');
    if (op.latestId) {
      await call({ ...request('replace'), noteId: op.latestId, expectedBody: op.latestBody, body: op.body });
    } else {
      const created = await call({ ...request('create'), title: op.title, body: op.body });
      op.latestId = created.id;
      store.set('publication', op);
    }
  }
  if (!op.latestId) {
    const matches = await call({ ...request('find'), title: op.title, marker: op.marker });
    if (matches.length !== 1) throw new Error('CREATE_RESULT_UNKNOWN');
    op.latestId = matches[0].id;
    store.set('publication', op);
  }
  const latest = await call({ ...request('read'), noteId: op.latestId });
  if (latest.id !== op.latestId || !latest.plaintext.includes(op.marker) || !latest.plaintext.includes(op.text)) throw new Error('UPDATE_RESULT_UNKNOWN');
  op.result = { status: 'okr_finalized', noteId: latest.id, receipt: '已更新 OKR 最新完整稿，确认内容和旧版已保留在 OKR 日志中。' };
  store.set('latest', { id: latest.id });
  save('done');
  return op.result;
}

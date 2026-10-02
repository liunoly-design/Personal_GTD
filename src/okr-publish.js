import { randomUUID } from 'node:crypto';
const html = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\n', '<br>');

// Two-note publication: archive the accepted revision before replacing the current document.
// Every possibly applied write is reconciled before another write is attempted.
export async function publishOkr({ store, call, binding, logNote, key, fingerprint, draft, sentAt, journal = null, discussion = null }) {
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
    if ((!journal && (logNote.body + addition).length > 65536) || body.length > 65536) throw new Error('CAPACITY_EXCEEDED');
    op = { key, fingerprint, marker, title: 'PGTD OKR 最新稿', body, text: draft.text, addition,
      logId: logNote.id, logBody: logNote.body, logPlaintext: logNote.plaintext.trim(),
      latestId: latest?.id, latestBody: before?.body, latestPlaintext: before?.plaintext, phase: 'log-new' };
    if (journal) op.local = true;
    store.set('publication', op);
  }
  const save = phase => { op.phase = phase; store.set('publication', op); };
  if (op.phase === 'done') return op.result;
  if (op.phase === 'log-new') {
    if (journal) {
      const archive = `# OKR 定稿讨论稿归档\n\n${sentAt}\n\n${discussion?.summary ?? ''}\n\n${discussion?.lastQuestion ?? ''}\n\n## 讨论稿快照\n${op.logPlaintext}\n\n## 确认结果\n${op.text}\n\n## 旧结果版本\n${op.latestPlaintext ?? '首次定稿'}\n`;
      // Store the exact archive before the first file write, for crash recovery.
      if (!op.archiveText) { op.archiveText = archive; store.set('publication', op); }
      op.archivePath = journal.archive(op.marker, op.archiveText);
      journal.append(op.marker, `${sentAt} 用户确认定稿\n${op.text}\n归档：${op.archivePath}`);
      save('latest-new');
    } else {
      save('log-writing');
      await call({ ...request('append'), noteId: op.logId, expectedBody: op.logBody, addition: op.addition });
    }
  }
  if (!journal && op.phase === 'log-writing') {
    const saved = await call({ ...request('read'), noteId: op.logId });
    if (saved.tagsComplete === false || saved.headingsComplete === false || saved.id !== op.logId || !saved.plaintext.includes(op.marker) || !saved.plaintext.includes(op.text)
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
  if (latest.tagsComplete === false || latest.headingsComplete === false || latest.id !== op.latestId || !latest.plaintext.includes(op.marker) || !latest.plaintext.includes(op.text)) throw new Error('UPDATE_RESULT_UNKNOWN');
  if (journal) {
    if (op.phase !== 'discussion-clearing') {
      const current = await call({ ...request('read'), noteId: op.logId });
      // Archive before clearing: a successful latest write is already verified.
      op.clearText = `PGTD OKR 讨论稿\n${binding.marker}\n讨论已定稿，结果见“PGTD OKR 最新稿”。\n完整问答和讨论稿已归档到本地 Markdown。\n${op.marker}\n${(current.nativeTags ?? []).filter(tag => !/^#(?:O|KR)[0-9]+$/.test(tag)).join(' ')}`;
      op.clearBefore = current.body;
      save('discussion-clearing');
      await call({ ...request('replace'), noteId: op.logId, expectedBody: op.clearBefore, body: `<div>${html(op.clearText)}</div>` });
    }
    const cleared = await call({ ...request('read'), noteId: op.logId });
    if (cleared.tagsComplete === false || cleared.headingsComplete === false || cleared.plaintext.trim() !== op.clearText.trim()) throw new Error('UPDATE_RESULT_UNKNOWN');
    store.set('local-note-body', cleared.body);
  }
  op.result = { status: 'okr_finalized', noteId: latest.id, receipt: journal ? '已更新 OKR 最新完整稿；完整问答、讨论稿和旧版本已归档到本地 Markdown，备忘录讨论稿已收起。' : '已更新 OKR 最新完整稿，确认内容和旧版已保留在 OKR 日志中。' };
  store.set('latest', { id: latest.id });
  save('done');
  return op.result;
}

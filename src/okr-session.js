import { validateOkrStep } from './okr-structure.js';
import { publishOkr } from './okr-publish.js';
import { validateGuidance, guidanceText, stages } from './okr-guidance.js';
import { randomUUID, createHash } from 'node:crypto';
import { openOperationStore } from './operation-store.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const html = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\n', '<br>');

export function openOkrSession({ statePath, config, bridge, guide, guideTimeoutMs = 15000 }) {
  config = structuredClone(config);
  if (!Number.isSafeInteger(guideTimeoutMs) || guideTimeoutMs < 1 || guideTimeoutMs > 60000) throw new Error('INVALID_BUDGET');
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
    if (!['open', 'record', 'pause', 'confirm'].includes(event.action)
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
    if (store.get('publication') && store.get('publication').key !== key) throw new Error('RECOVERY_REQUIRED');
    const sessionKey = 'session:' + hash([event.senderId, event.conversationId]);
    if (event.action === 'pause') store.set(sessionKey, false);
    if (event.action === 'pause' || (['record', 'confirm'].includes(event.action) && !store.get(sessionKey))) {
      return finish({ status: 'okr_paused', receipt: 'OKR 记录已暂停。发送“小婕 gtd okr 讨论”后继续。' });
    }
    let calls = 0;
    const call = async request => {
      if (++calls > (event.action === 'confirm' ? 12 : 8)) throw new Error('BUDGET_EXHAUSTED');
      try { return await bridge(request); }
      catch (cause) {
        const error = new Error(cause instanceof Error ? cause.message : 'NOTES_UNAVAILABLE');
        error.operation = request.command;
        throw error;
      }
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
      if (note.tagsComplete === false || note.headingsComplete === false || !note.plaintext.includes(pending.marker) || !note.plaintext.includes(pending.text)
        || !note.plaintext.includes(pending.beforePlaintext)) throw new Error('UPDATE_RESULT_UNKNOWN');
      store.transaction(() => {
        store.set(pending.key, { fingerprint: pending.fingerprint, result: pending.result });
        if (pending.discussion) store.set('discussion:' + pending.sessionKey, pending.discussion);
        if (pending.clearDraft) store.set('draft', pending.draft);
        store.set('pending', null);
      });
      if (pending.key === key) return pending.result;
    }
    if (event.action === 'confirm') {
      const draft = store.get('draft');
      if (!draft || draft.owner !== sessionKey || draft.version !== event.confirmVersion) {
        return finish({ status: 'okr_needs_confirmation', receipt: '请回复当前完整草案的消息“确认定稿”；旧草案或其他会话的确认不能使用。' });
      }
      const result = await publishOkr({ store, call, binding: state, logNote: note, key, fingerprint, draft, sentAt: event.sentAt });
      store.transaction(() => { finish(result); store.set('draft', null); store.set('publication', null); });
      return result;
    }
    if (event.action === 'record') {
      const marker = 'PGTD-ENTRY-' + randomUUID();
      let analysis, discussion, guidanceFailure, draft = null;
      const latestBinding = store.get('latest');
      const latest = guide && latestBinding ? await call({ ...request('read'), noteId: latestBinding.id }) : null;
      if (guide) {
        const analysisKey = 'analysis:' + key;
        const oldAnalysis = store.get(analysisKey);
        if (oldAnalysis?.value) {
          if (oldAnalysis.logBody !== note.body || oldAnalysis.latestBody !== (latest?.body ?? null)) throw new Error('CONFLICT');
          analysis = oldAnalysis.value;
        }
        else if (!oldAnalysis) {
          store.set(analysisKey, { phase: 'started' });
          const current = store.get('discussion:' + sessionKey) ?? { stage: 'background' };
          const controller = new AbortController();
          let timer;
          try {
            const value = await Promise.race([
              Promise.resolve().then(() => guide({ stage: current.stage, workingDraft: current.workingDraft ?? null, answer: event.text,
                discussionSummary: current.summary ?? null, lastQuestion: current.lastQuestion ?? null, sentAt: event.sentAt,
                currentGoals: latest?.plaintext.slice(0, 8000) ?? '', goalsTruncated: (latest?.plaintext.length ?? 0) > 8000,
                recentLog: note.plaintext.slice(-3000), logTruncated: note.plaintext.length > 3000,
                signal: controller.signal })),
              new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('MODEL_TIMEOUT')); }, guideTimeoutMs); }),
            ]);
            analysis = validateGuidance(value);
            validateOkrStep(current.workingDraft, analysis.draft);
            if (stages.indexOf(analysis.stage) > stages.indexOf(current.stage) + 1) throw new Error('INVALID_TRANSITION');
            if (analysis.stage === 'ready' && (latest?.plaintext.length ?? 0) > 8000) throw new Error('INCOMPLETE_CONTEXT');
            store.set(analysisKey, { phase: 'done', value: analysis, logBody: note.body, latestBody: latest?.body ?? null });
          } catch (error) {
            analysis = null;
            guidanceFailure = /^[A-Z_]+$/u.test(error.message) ? error.message : 'MODEL_UNAVAILABLE';
            store.set(analysisKey, { phase: 'failed', reason: guidanceFailure });
          } finally { clearTimeout(timer); }
        }
        if (!analysis && !guidanceFailure) guidanceFailure = oldAnalysis?.reason ?? 'MODEL_INTERRUPTED';
        if (analysis) {
          discussion = { stage: analysis.stage, summary: analysis.summary, lastQuestion: analysis.questions[0] ?? null, workingDraft: analysis.draft ?? store.get('discussion:' + sessionKey)?.workingDraft ?? null };
          if (analysis.stage === 'ready') draft = { version: randomUUID(), text: analysis.draft, owner: sessionKey, latestBody: latest?.body ?? null };
        }
      }
      const failureText = guidanceFailure === 'MULTIPLE_OKR_ITEMS'
        ? '已保存原回答。模型本轮试图同时改动多项目标或关键结果，未更新草案或推进讨论。你可以一次提供多个想法；我们接下来只讨论一项。请回复新消息，明确“先只讨论当前目标的某一个 KR”，并说明你希望先完善哪一项。'
        : '已保存原回答，本轮分析未完成。可稍后用新消息继续；同一消息不会重复调用模型。';
      const entryText = guide ? event.text + '\n' + (analysis ? guidanceText(analysis) : failureText) : event.text;
      const result = { status: guide ? analysis ? 'okr_guided' : 'okr_guidance_failed' : 'okr_saved', noteId: note.id, receipt: '已保存到 OKR 日志。回复此消息可继续记录；启动 OKR 讨论可回看。' };
      if (guidanceFailure) result.guidanceFailure = guidanceFailure;
      if (guide) result.receipt = analysis ? '已记录。\n' + guidanceText(analysis) : failureText;
      if (draft) {
        result.draftVersion = draft.version;
        result.receipt += '\n请核对以上完整草案，回复此消息“确认定稿”后更新最新完整稿；也可回复修改意见。';
      }
      const addition = `<div>${html(event.sentAt)}</div><div>${html(entryText)}</div><div>${marker}</div>`;
      if ((note.body + addition).length > 65536) throw new Error('CAPACITY_EXCEEDED');
      const beforePlaintext = note.plaintext.trim();
      store.set('pending', { key, fingerprint, marker, text: entryText, beforePlaintext, result, discussion, draft, clearDraft: true, sessionKey });
      await call({ ...request('append'), noteId: state.noteId, expectedBody: note.body,
        addition });
      note = await call({ ...request('read'), noteId: state.noteId });
      if (note.tagsComplete === false || note.headingsComplete === false || note.id !== state.noteId || !note.plaintext.includes(marker) || !note.plaintext.includes(entryText)
        || !note.plaintext.includes(beforePlaintext)) throw new Error('READBACK_FAILED');
      store.transaction(() => { finish(result); if (discussion) store.set('discussion:' + sessionKey, discussion); store.set('draft', draft); store.set('pending', null); });
      return result;
    }
    store.set(sessionKey, true);
    const clean = text => text.replace(/PGTD-(?:ENTRY|OKR|FINAL)-[a-f0-9-]{36}/gu, '').trim();
    const preview = clean(note.plaintext);
    const latestBinding = store.get('latest');
    const latest = latestBinding ? await call({ ...request('read'), noteId: latestBinding.id }) : null;
    const progress = store.get('discussion:' + sessionKey);
    const resume = progress?.workingDraft ? '\n当前工作草案（待确认）：\n' + progress.workingDraft : '';
    const current = latest ? '\n当前目标：\n' + clean(latest.plaintext).slice(0, 3000) + (latest.plaintext.length > 3000 ? '\n（当前目标预览截断，完整内容在最新稿）' : '') : '';
    return finish({ status: 'okr_open', noteId: note.id,
      receipt: `已进入 OKR 逐项讨论（grilling 模式）。先明确周期和个人情况，再讨论一个 O，并逐个讨论其 3–5 个 KR。每轮一个核心问题，回答后保存并继续。\n${progress?.lastQuestion ? "继续上一轮问题：" + progress.lastQuestion : progress?.workingDraft ? "请先核对下方工作草案，说明当前这一项需要补充或修改什么。" : "这次要制定或回顾哪个年度/季度？起止日期是什么？"}${resume}${current}\n最近日志：\n${preview.length > 3000 ? '（仅显示末尾 3000 字符，完整内容在备忘录）\n' : ''}${preview.slice(-3000)}` });
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

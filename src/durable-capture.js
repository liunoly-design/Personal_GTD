import { createHash, randomUUID } from 'node:crypto';
import { createCapture } from './capture.js';
import { openOperationStore } from './operation-store.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unfinished = new Set(['result_unknown', 'reminder_result_unknown', 'failed', 'collected_reminder_failed']);

async function bounded(call, timeoutMs, parentSignal) {
  let timer;
  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal?.addEventListener('abort', abort, { once: true });
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = () => reject(new Error('Aborted')); });
  controller.signal.addEventListener('abort', rejectAbort, { once: true });
  if (parentSignal?.aborted) controller.abort();
  try {
    return await Promise.race([aborted, Promise.resolve().then(() => call(controller.signal)), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('External timeout')); }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); parentSignal?.removeEventListener('abort', abort); }
}

export function openDurableCapture({ journalPath, reminders, receipts, analyze, config = {}, now, ...options }) {
  config = structuredClone(config);
  const limits = { maxWriteAttempts: 2, maxReconcileAttempts: 3, externalTimeoutMs: 2000, maxStoredEvents: 1000,
    maxEventChars: 20000, maxAnalysisOutputChars: 4096, maxRecoveryAttempts: 5, ...config };
  for (const name of ['maxWriteAttempts', 'maxReconcileAttempts', 'externalTimeoutMs', 'maxStoredEvents', 'maxAnalysisOutputChars', 'maxEventChars', 'maxRecoveryAttempts']) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] < 1) throw new Error(`Invalid ${name}`);
  }
  const validator = createCapture({ config, reminders, analyze, now });
  const store = openOperationStore(journalPath);
  const owner = randomUUID();
  try {
    store.transaction(() => {
      const lease = store.get('owner');
      if (lease?.pid) {
        let alive = true;
        try { process.kill(lease.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
        if (alive) throw new Error('Operation journal busy');
      }
      store.set('owner', { pid: process.pid, token: owner });
    });
  } catch (error) { store.close(); throw error; }
  const namespace = store.get('namespace') ?? randomUUID();
  store.set('namespace', namespace);
  let queue = Promise.resolve();
  let closed = false;
  let exhausted = false;

  async function reconcile(key, service = reminders) {
    let old = store.get('effect:' + key);
    if (!old) return { state: 'absent' };
    if (old.state === 'done') return { state: 'applied', value: old.value };
    if ((old.queries ?? 0) >= limits.maxReconcileAttempts) {
      exhausted = true; throw new Error('Reconciliation budget exhausted');
    }
    old = { ...old, queries: (old.queries ?? 0) + 1 };
    store.set('effect:' + key, old);
    const found = await bounded(signal => service.getOperation(digest([namespace, key]), { signal }), limits.externalTimeoutMs);
    if (found.state === 'applied') store.set('effect:' + key, { ...old, state: 'done', value: found.value });
    else if (found.state !== 'absent') throw new Error('External state unknown');
    return found;
  }

  async function effect(key, input, write, service = reminders) {
    const id = digest([namespace, key]);
    let old = store.get('effect:' + key);
    if (old && old.input !== digest(input)) throw new Error('Operation input changed');
    if (old?.state === 'done') return old.value;
    if (old) {
      const found = await reconcile(key, service);
      if (found.state === 'applied') return found.value;
      old = store.get('effect:' + key);
    }
    if ((old?.attempts ?? 0) >= limits.maxWriteAttempts) {
      exhausted = true; throw new Error('Write budget exhausted');
    }
    const record = { input: digest(input), state: 'intent', queries: old?.queries ?? 0, attempts: (old?.attempts ?? 0) + 1 };
    store.set('effect:' + key, record);
    const value = await bounded(signal => write(id, signal), limits.externalTimeoutMs);
    store.set('effect:' + key, { ...record, state: 'done', value });
    return value;
  }

  async function deliver(key, record) {
    if (!receipts || !record.result.receipt || record.delivery === 'sent' || record.delivery === 'budget_exhausted') {
      return { ...record.result, ...(record.delivery ? { delivery: record.delivery } : {}) };
    }
    let delivery;
    try {
      await effect(key + ':receipt', record.result.receipt,
        (id, signal) => receipts.send({ conversationId: record.event.conversationId, replyTo: record.event.id,
          text: record.result.receipt }, id, { signal }), receipts);
      delivery = 'sent';
    } catch { delivery = exhausted ? 'budget_exhausted' : 'pending'; }
    store.set('event:' + key, { ...record, delivery });
    return { ...record.result, delivery };
  }

  async function handle(event) {
    exhausted = false;
    const rejected = validator.validate(event);
    if (rejected) return rejected;
    if (JSON.stringify(event).length > limits.maxEventChars) return { status: 'input_too_large', receipt: '【模拟】完整事件超过容量；未保存或截断原文。' };
    const key = digest([event.senderId, event.conversationId, event.id]);
    const existing = store.get('event:' + key);
    if (existing && digest(existing.event) !== digest(event)) {
      return { status: 'event_conflict', receipt: '【模拟】同一消息 ID 的内容不一致，未新增操作。' };
    }
    if (existing?.done) return deliver(key, existing);
    if (!existing && !createCapture({ config, reminders, analyze, now, checkpoint: store.get('checkpoint') }).canHandle(event)) {
      return { status: 'not_handled', receipt: null };
    }
    if (store.entries('event:').some(([id, record]) => id !== 'event:' + key && !record.done)) {
      return { status: 'recovery_required', receipt: '【模拟】先前操作尚待恢复，请先重投原消息或执行恢复。' };
    }
    if (existing?.result?.recovery === 'budget_exhausted') return existing.result;
    if (!existing && store.entries('event:').length >= limits.maxStoredEvents) {
      return { status: 'budget_exhausted', receipt: '【模拟】操作记录容量已满，未开始新的操作。' };
    }
    const record = existing ?? { event, config, done: false };
    if ((record.attempts ?? 0) >= limits.maxRecoveryAttempts) {
      const result = { ...record.result, status: record.result?.status ?? 'result_unknown', recovery: 'budget_exhausted' };
      store.set('event:' + key, { ...record, result });
      return result;
    }
    record.attempts = (record.attempts ?? 0) + 1;
    store.set('event:' + key, record);
    const adapter = {
      listLists: () => bounded(signal => reminders.listLists({ signal }), limits.externalTimeoutMs),
      createList: name => effect('inbox', name, (id, signal) => reminders.createList(name, id, { signal })),
      createItem: input => effect(key + ':create', input, (id, signal) => reminders.createItem(input, id, { signal })),
      reconcileReminder: async () => (await reconcile(key + ':reminder')).state === 'applied',
      setReminder: (itemId, input) => effect(key + ':reminder', { itemId, ...input }, (id, signal) => reminders.setReminder(itemId, input, id, { signal })),
    };
    let analysisReused = false;
    const cachedAnalysis = async args => {
      const cached = store.get('analysis:' + key);
      if (cached) analysisReused = true;
      if (cached?.value) return cached.value;
      if (cached) throw new Error('Analysis already attempted');
      const started = performance.now();
      const metrics = { mode: 'simulation', calls: 1, inputTokens: null, outputTokens: null };
      store.set('analysis:' + key, { state: 'started', metrics: { ...metrics, latencyMs: null, failureReason: 'interrupted_or_in_progress' } });
      try {
        const value = await bounded(signal => analyze({ ...args, signal }), record.config.analysisTimeoutMs ?? 15000, args.signal);
        if (JSON.stringify(value)?.length > limits.maxAnalysisOutputChars) throw new Error('Analysis output too large');
        store.set('analysis:' + key, { value, metrics: { ...metrics, latencyMs: performance.now() - started, failureReason: null } });
        return value;
      } catch {
        store.set('analysis:' + key, { state: 'failed', metrics: { ...metrics, latencyMs: performance.now() - started, failureReason: 'analysis_unavailable' } });
        throw new Error('Analysis unavailable');
      }
    };
    cachedAnalysis.mode = analyze.mode;
    const capture = createCapture({ ...options, config: record.config, now, reminders: adapter,
      analyze: cachedAnalysis, checkpoint: store.get('checkpoint') });
    const result = await capture.handle(record.event);
    if (result.analysis && analysisReused) result.analysis = { ...result.analysis, calls: 0, inputTokens: 0,
      outputTokens: 0, estimatedCostUsd: 0, cacheReused: true };
    if (unfinished.has(result.status)) result.receipt = result.itemId
      ? '【模拟】已收集，提醒尚待恢复核对；进度已保存，不会重新创建事项。'
      : '【模拟】写入尚未确认成功，进度已保存；恢复时先核对外部状态。';
    if (exhausted) result.recovery = 'budget_exhausted';
    const checkpoint = await capture.checkpoint();
    const done = !unfinished.has(result.status);
    store.transaction(() => {
      store.set('event:' + key, { ...record, result, done });
      if (done) store.set('checkpoint', checkpoint);
    });
    return done ? deliver(key, { ...record, result, done }) : result;
  }
  return {
    handle(event) {
      if (closed) throw new Error('Capture closed');
      const input = structuredClone(event);
      const task = queue.then(() => handle(input));
      queue = task.catch(() => {});
      return task;
    },
    recover() {
      if (closed) throw new Error('Capture closed');
      const task = queue.then(async () => {
        const results = [];
        for (const [, record] of store.entries('event:')) {
          if (!record.done || (receipts && record.result.receipt && record.delivery !== 'sent')) {
            results.push(await handle(record.event));
          }
        }
        return results;
      });
      queue = task.catch(() => {});
      return task;
    },
    async close() {
      if (!closed) {
        closed = true;
        await queue;
        if (store.get('owner')?.token === owner) store.set('owner', null);
        store.close();
      }
    },
  };
}

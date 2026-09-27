import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { openOperationStore } from './operation-store.js';
import { openDurableCapture } from './durable-capture.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function validateFeishuScope(config) {
  for (const name of ['accountId', 'entryAgentId']) {
    if (typeof config[name] !== 'string' || !config[name].trim()) throw new Error('Explicit scope required');
  }
  for (const [name, pattern] of [['allowedSenderIds', /^ou_[\w-]+$/u], ['allowedConversationIds', /^oc_[\w-]+$/u]]) {
    if (!Array.isArray(config[name]) || !config[name].length || config[name].some(id => !pattern.test(id))) {
      throw new Error('Explicit ID allowlist required');
    }
  }
  if (config.activation !== undefined && (typeof config.activation !== 'string' || !config.activation.trim()
    || config.activation !== config.activation.trim())) throw new Error('Invalid activation');
}
function activated(text, config) {
  const activation = config.activation ?? '小婕 GTD';
  return typeof text === 'string' && text.startsWith(activation)
    && (text.length === activation.length || /^[\s，,:：]/u.test(text.slice(activation.length)));
}
// Only admits a candidate; the durable capture checks pending requests and
// responds needs_target without guessing an item or calling the model.
function timeCandidate(text) {
  return typeof text === 'string' && /^(?:\d{1,4}[:\-]|今天|明天|后天|下午|上午|北京时间|\[)/u.test(text.trim());
}
export function acceptsFeishuContext(ctx, config) {
  return ctx.Provider === 'feishu' && ctx.AccountId === config.accountId && ctx.AgentId === config.entryAgentId
    // CommandAuthorized describes host control commands, not natural-language capture.
    // Business authorization is the explicit scope below plus the original-message API check.
    && !ctx.SenderIsBot
    && config.allowedSenderIds.includes(ctx.SenderId) && config.allowedConversationIds.includes(ctx.NativeChannelId)
    && (activated(ctx.rawText ?? ctx.RawBody, config) || Boolean(ctx.ReplyToIdFull ?? ctx.ReplyToId)
      || timeCandidate(ctx.rawText ?? ctx.RawBody));
}
export function openFeishuCapture({ stateDir, config, reminders, feishu, analyze, now }) {
  config = structuredClone(config);
  validateFeishuScope(config);
  const maxEvents = config.maxStoredEvents ?? 1000;
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 1000) throw new Error('Event limit must be 1..1000');
  let queue = Promise.resolve(), queued = 0, closed = false, activeSignal;
  const options = signal => {
    activeSignal?.throwIfAborted();
    return { signal: AbortSignal.any([...(signal ? [signal] : []), ...(activeSignal ? [activeSignal] : [])]) };
  };
  const store = openOperationStore(join(stateDir, 'feishu.sqlite'));
  const binding = store.get('account');
  if (binding && binding !== config.accountId) { store.close(); throw new Error('Feishu account binding changed'); }
  const receipts = {
    async getOperation(id) {
      const old = store.get('receipt:' + id);
      return old?.value ? { state: 'applied', value: old.value } : { state: old ? 'unknown' : 'absent' };
    },
    async send(input, id, { signal } = {}) {
      const requestOptions = options(signal);
      const old = store.get('receipt:' + id);
      if (old?.hash !== undefined && old.hash !== hash(input)) throw new Error('Receipt conflict');
      if (old?.value) return old.value;
      if (old) throw new Error('Receipt result unknown');
      store.set('receipt:' + id, { hash: hash(input) });
      const value = await feishu.reply({ ...input, text: input.text.replace('【模拟】', '【Apple】'), uuid: id.slice(0, 32) }, requestOptions);
      if (!value?.message_id || value.chat_id !== input.conversationId) throw new Error('Receipt result unknown');
      store.transaction(() => {
        store.set('receipt:' + id, { hash: hash(input), value });
        const source = store.get('source:' + input.replyTo);
        store.set('reply:' + value.message_id, { ...source, conversationId: input.conversationId,
          rootId: source?.rootId ?? input.replyTo });
      });
      return value;
    },
  };
  let capture;
  try {
    const scopedReminders = {
      listLists: ({ signal } = {}) => reminders.listLists(options(signal)),
      createList: (name, id, { signal } = {}) => reminders.createList(name, id, options(signal)),
      createItem: (input, id, { signal } = {}) => reminders.createItem(input, id, options(signal)),
      setReminder: (itemId, input, id, { signal } = {}) => reminders.setReminder(itemId, input, id, options(signal)),
      getOperation: (id, { signal } = {}) => reminders.getOperation(id, options(signal)),
    };
    const scopedAnalyze = args => analyze({ ...args, ...options(args.signal) });
    scopedAnalyze.mode = analyze.mode;
    capture = openDurableCapture({ journalPath: join(stateDir, 'capture.sqlite'), reminders: scopedReminders, receipts, analyze: scopedAnalyze,
      config: { ...config, externalTimeoutMs: 20000 }, now });
    store.set('account', config.accountId);
  } catch (error) { store.close(); throw error; }
  async function handle(ctx) {
    if (!acceptsFeishuContext(ctx, config)) return { status: 'not_handled' };
    const replyTo = ctx.ReplyToIdFull ?? ctx.ReplyToId;
    const linked = store.get('reply:' + replyTo) ?? store.get('source:' + replyTo);
    if (!activated(ctx.rawText ?? ctx.RawBody, config)
      && !timeCandidate(ctx.rawText ?? ctx.RawBody)
      && !(linked?.senderId === ctx.SenderId && linked.conversationId === ctx.NativeChannelId)) return { status: 'not_handled' };
    const id = ctx.MessageSidFull ?? ctx.MessageSid;
    if (typeof id !== 'string' || !/^om_[\w-]+$/u.test(id)) return { status: 'invalid_source' };
    if (!store.get('source:' + id) && store.entries('source:').length >= maxEvents) return { status: 'budget_exhausted' };
    const message = await feishu.getMessage(id, options());
    if (!message || message.message_id !== id || message.chat_id !== ctx.NativeChannelId
      || message.sender?.id !== ctx.SenderId || message.sender.id_type !== 'open_id'
      || message.sender.sender_type !== 'user' || message.updated || message.deleted
      || !Number.isSafeInteger(Number(message.create_time)) || Number(message.create_time) <= 0
      || Number(message.create_time) > 8640000000000000) return { status: 'invalid_source' };
    const event = { id, senderId: message.sender.id, conversationId: message.chat_id, type: message.msg_type,
      text: message.msg_type === 'text' ? JSON.parse(message.body.content).text : '', sentAt: new Date(Number(message.create_time)).toISOString(),
      ...(message.parent_id ? { replyTo: message.parent_id } : {}) };
    const parent = store.get('reply:' + message.parent_id) ?? store.get('source:' + message.parent_id);
    if (parent?.senderId === event.senderId && parent.conversationId === event.conversationId) event.replyTo = parent.rootId;
    store.set('source:' + id, { senderId: event.senderId, conversationId: event.conversationId,
      rootId: activated(event.text, config) ? id : event.replyTo ?? id });
    const result = await capture.handle(event);
    if (result.receipt && !result.delivery) {
      try {
        await receipts.send({ conversationId: event.conversationId, replyTo: id, text: result.receipt },
          hash([config.accountId, id, result.status, result.receipt]));
        result.delivery = 'sent';
      } catch { result.delivery = 'pending'; }
    }
    return result;
  }
  function enqueue(work, signal) {
    if (closed) return Promise.reject(new Error('Feishu capture closed'));
    if (queued >= 16) return Promise.resolve({ status: 'busy' });
    queued++;
    const task = queue.then(async () => {
      if (signal?.aborted) return { status: 'cancelled' };
      activeSignal = signal;
      try { return await work(); } finally { activeSignal = undefined; }
    }).finally(() => { queued--; });
    queue = task.catch(() => {});
    return task;
  }
  return {
    handle(ctx, { signal } = {}) {
      const fields = ['Provider', 'AccountId', 'AgentId', 'CommandAuthorized', 'SenderIsBot', 'SenderId',
        'NativeChannelId', 'rawText', 'RawBody', 'MessageSidFull', 'MessageSid', 'ReplyToIdFull', 'ReplyToId'];
      const input = Object.fromEntries(fields.map(name => [name, ctx[name]]));
      return enqueue(() => handle(input), signal);
    },
    recover() { return enqueue(() => capture.recover()); },
    async close() { if (closed) return; closed = true; await queue; await capture.close(); store.close(); },
  };
}

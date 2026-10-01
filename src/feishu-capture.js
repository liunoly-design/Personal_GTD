import { openOkrSession } from './okr-session.js';
import { activationLength } from './activation.js';
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
  return activationLength(text, config.activation) > 0;
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
export function openFeishuCapture({ stateDir, config, reminders, feishu, analyze, now, notesBridge, okrGuide }) {
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
  let capture, okr;
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
    if (config.okr) {
      if (typeof notesBridge !== 'function') throw new Error('Notes bridge required');
      okr = openOkrSession({ statePath: join(stateDir, 'okr.sqlite'), config: config.okr,
        bridge: request => { options(); return notesBridge(request); },
        guide: okrGuide ? args => okrGuide({ ...args, ...options(args.signal) }) : undefined });
    }
    capture = openDurableCapture({ journalPath: join(stateDir, 'capture.sqlite'), reminders: scopedReminders, receipts, analyze: scopedAnalyze,
      config: { ...config, externalTimeoutMs: 20000 }, now });
    store.set('account', config.accountId);
  } catch (error) { void okr?.close(); store.close(); throw error; }
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
      || message.sender.sender_type !== 'user' || message.deleted
      || !Number.isSafeInteger(Number(message.create_time)) || Number(message.create_time) <= 0
      || Number(message.create_time) > 8640000000000000) return { status: 'invalid_source' };
    const event = { id, senderId: message.sender.id, conversationId: message.chat_id, type: message.msg_type,
      text: message.msg_type === 'text' ? JSON.parse(message.body.content).text : '', sentAt: new Date(Number(message.create_time)).toISOString(),
      ...(message.parent_id ? { replyTo: message.parent_id } : {}) };
    const parentReceipt = store.get('reply:' + message.parent_id);
    const parent = parentReceipt ?? store.get('source:' + message.parent_id);
    if (parent?.senderId === event.senderId && parent.conversationId === event.conversationId) event.replyTo = parent.rootId;
    const prefix = activationLength(event.text, config.activation);
    const command = prefix ? event.text.slice(prefix).replace(/^[\s，,:：]+/u, '') : '';
    const explicitOkr = /^okr(?=$|[\s，,:：])/iu.test(command);
    const linkedOkr = !prefix && parent?.route === 'okr' && parent.senderId === event.senderId
      && parent.conversationId === event.conversationId;
    const isOkr = explicitOkr || linkedOkr;
    if (message.updated) {
      // A provider update flag does not prove that the delivered text changed.
      // Only conversational OKR replies may proceed after exact content checks.
      const ordinaryReply = linkedOkr && !['确认定稿', '暂停'].includes(event.text.trim());
      if (!ordinaryReply) return { status: 'invalid_source' };
      const previousSource = store.get('source:' + id);
      if (event.text !== (ctx.rawText ?? ctx.RawBody)
        || (previousSource && previousSource.textHash !== hash(event.text))) {
        return deliverResult(event, { status: 'source_changed', receipt: '这条回复的正文已发生变化，本次未处理。请将希望讨论的完整内容作为新消息回复原 OKR 对话。' });
      }
    }
    store.set('source:' + id, { senderId: event.senderId, conversationId: event.conversationId,
      rootId: prefix ? id : event.replyTo ?? id, textHash: hash(event.text), ...(isOkr ? { route: 'okr' } : {}) });
    let result;
    if (isOkr) {
      const instruction = explicitOkr ? command.slice(3).replace(/^[\s，,:：]+/u, '') : '';
      let action;
      if ((linkedOkr && event.text.trim() === '确认定稿') || instruction === '确认定稿') action = 'confirm';
      else if (linkedOkr) action = 'record';
      else if (/^(讨论|续接)$/u.test(instruction)) action = 'open';
      else if (instruction === '暂停') action = 'pause';
      else if (/^记录[\s，,:：]/u.test(instruction)) action = 'record';
      const text = action !== 'record' ? '' : linkedOkr ? event.text : instruction.replace(/^记录[\s，,:：]+/u, '');
      if (!okr) result = { status: 'okr_unavailable', receipt: 'OKR 备忘录尚未配置，请先启用 OKR 记录功能。' };
      else if (!action || event.type !== 'text') result = { status: 'okr_help', receipt: '请发送“小婕 gtd okr 讨论”，回复关联消息记录文字，或使用“okr 记录：内容”“okr 暂停”。' };
      else {
        const confirmVersion = parentReceipt?.route === 'okr' && parentReceipt.senderId === event.senderId
          && parentReceipt.conversationId === event.conversationId ? parentReceipt.draftVersion : undefined;
        try {
          result = await okr.handle({ ...event, action, text, ...(action === 'confirm' ? { confirmVersion } : {}) });
        }
        catch (error) {
          const code = ['INVALID_INPUT', 'CONFLICT', 'CAPACITY_EXCEEDED', 'BUDGET_EXHAUSTED', 'CREATE_RESULT_UNKNOWN',
            'UPDATE_RESULT_UNKNOWN', 'RECOVERY_REQUIRED', 'READBACK_FAILED', 'PERMISSION_DENIED', 'ACCESSIBILITY_DENIED', 'LOCATION_NOT_UNIQUE'].includes(error.message)
            ? error.message : 'NOTES_UNAVAILABLE';
          const explanation = code === 'INVALID_INPUT' ? '请使用不超过 4000 字的非空文字。'
            : code === 'ACCESSIBILITY_DENIED' ? '网关运行程序（node）的辅助功能权限未开启，请在 macOS“隐私与安全性 → 辅助功能”中开启后再试。'
            : code === 'PERMISSION_DENIED' ? '请检查网关运行程序控制备忘录的自动化权限。'
            : code === 'CAPACITY_EXCEEDED' || code === 'BUDGET_EXHAUSTED' ? '记录已达到本版容量上限。'
            : '请保留原消息，核对备忘录后再继续。';
          result = { status: 'okr_error', code, receipt: `OKR 记录未确认完成。${explanation}` };
        }
      }
    } else result = await capture.handle(event);
    if (result.draftVersion) store.set('source:' + id, { ...store.get('source:' + id), draftVersion: result.draftVersion });
    return deliverResult(event, result);
  }
  async function deliverResult(event, result) {
    if (result.receipt && !result.delivery) {
      try {
        await receipts.send({ conversationId: event.conversationId, replyTo: event.id, text: result.receipt },
          hash([config.accountId, event.id, result.status, result.receipt]));
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
    async close() { if (closed) return; closed = true; await queue; await capture.close(); await okr?.close(); store.close(); },
  };
}

import { createMessageAnalyzer } from './analyze-message.js';
import { createCollector } from './actions/collect.js';
import { createReminderSetter } from './actions/set-reminder.js';
import { createReminderClarifier } from './actions/clarify-reminder.js';
import { confirmLink } from './actions/confirm-link.js';
import { activationLength } from './activation.js';
import { validInstant, validTimeZone } from './reminder-time.js';

export function createCapture({ reminders, analyze, config = {}, now = () => new Date().toISOString(), checkpoint = {} }) {
  config = {
    activation: '小婕 GTD', allowedSenderIds: ['demo-user'], allowedConversationIds: ['demo-chat'],
    maxInputChars: 8000, analysisTimeoutMs: 15000, timeZone: 'Asia/Shanghai', ...structuredClone(config),
  };
  if (typeof config.activation !== 'string' || !config.activation.trim() || config.activation !== config.activation.trim()) {
    throw new Error('activation must be a nonempty trimmed string');
  }
  if (typeof config.timeZone !== 'string' || !validTimeZone(config.timeZone)) throw new Error('Invalid timeZone');
  for (const name of ['maxInputChars', 'analysisTimeoutMs']) {
    if (!Number.isSafeInteger(config[name]) || config[name] < 1) throw new Error(`Invalid ${name}`);
  }
  for (const name of ['allowedSenderIds', 'allowedConversationIds']) {
    if (!Array.isArray(config[name]) || config[name].some(x => typeof x !== 'string' || !x)) throw new Error(`Invalid ${name}`);
  }
  const activation = config.activation;
  const pending = new Map(structuredClone(checkpoint.pending ?? []));
  const reminderRequests = new Map(structuredClone(checkpoint.reminderRequests ?? []));
  const key = (event, id = event.id) => JSON.stringify([event.senderId, event.conversationId, id]);

  const analyzeMessage = createMessageAnalyzer({ analyze, config });
  const applyTime = createReminderSetter({ reminders, now });
  const clarifyTime = createReminderClarifier({ analyzeMessage, applyTime });
  const save = createCollector({ reminders, analyzeMessage, async startReminder(event, itemId, listId, candidate, metrics) {
    const record = { event: structuredClone(event), itemId, listId };
    reminderRequests.set(key(event), record);
    record.result = await applyTime(record, candidate, metrics);
    return record.result;
  } });

  function validate(event) {
    if (!event || ['id', 'senderId', 'conversationId', 'type', 'sentAt'].some(field => typeof event[field] !== 'string' || !event[field])
      || !validInstant(event.sentAt) || (event.type === 'text' && typeof event.text !== 'string')
      || (event.replyTo !== undefined && (typeof event.replyTo !== 'string' || !event.replyTo))) {
      return { status: 'invalid_event', receipt: '【模拟】消息元数据无效；未创建事项。' };
    }
    if (!config.allowedSenderIds.includes(event.senderId) || !config.allowedConversationIds.includes(event.conversationId)) {
      return { status: 'forbidden', receipt: null };
    }
    if (event.type !== 'text') return { status: 'unsupported', receipt: '【模拟】目前只支持文字和文字中的链接；未创建事项。' };
    if ([...event.text].length > config.maxInputChars) {
      return { status: 'input_too_large', receipt: '【模拟】内容超过本地收集容量，请拆分后再收集；未保存或截断原文。' };
    }
  }

  function activated(event) {
    return activationLength(event.text, activation) > 0;
  }
  function canHandle(event) {
    if (activated(event)) return true;
    if (event.replyTo && (pending.has(key(event, event.replyTo)) || reminderRequests.has(key(event, event.replyTo)))) return true;
    return /^(?:\d{1,4}[:\-]|今天|明天|后天|下午|上午|北京时间|\[)/u.test(event.text.trim())
      && [...reminderRequests.values()].some(record => record.event.senderId === event.senderId
        && record.event.conversationId === event.conversationId && record.result?.status === 'collected_awaiting_time');
  }

  return {
    validate,
    canHandle,
    async checkpoint() {
      const links = [];
      for (const [id, entry] of pending) {
        links.push([id, { ...entry, ...(entry.result ? { result: await entry.result } : {}) }]);
      }
      const times = [];
      for (const [id, entry] of reminderRequests) {
        await entry.queue;
        const { queue, ...record } = entry;
        times.push([id, record]);
      }
      return structuredClone({ pending: links, reminderRequests: times });
    },
    async handle(event) {
      const rejected = validate(event);
      if (rejected) return rejected;
      const isActivated = activated(event);
      const timeRequest = !isActivated && event.replyTo && reminderRequests.get(key(event, event.replyTo));
      if (timeRequest) {
        timeRequest.queue = (timeRequest.queue ?? Promise.resolve()).then(() => clarifyTime(timeRequest, event));
        return timeRequest.queue;
      }
      const waiting = !isActivated && event.replyTo && pending.get(key(event, event.replyTo));
      if (waiting) {
        return confirmLink(waiting, event, save);
      }
      if (!isActivated) {
        const ownPending = [...reminderRequests.values()].some(record => record.event.senderId === event.senderId
          && record.event.conversationId === event.conversationId && record.result?.status === 'collected_awaiting_time');
        if (ownPending && /^(?:\d{1,4}[:\-]|今天|明天|后天|下午|上午|北京时间|\[)/u.test(event.text.trim())) {
          return { status: 'needs_target', receipt: '【模拟】请关联需要补充时间的原请求；尚未更新任何事项。' };
        }
        return { status: 'not_handled', receipt: null };
      }
      const remainder = event.text.slice(activationLength(event.text, activation));
      if (remainder && !/^[\s，,:：]/u.test(remainder)) return { status: 'not_handled', receipt: null };
      const instruction = remainder.replace(/^[\s，,:：]+/u, '');
      const reminder = instruction.match(/^(?:请)?(?:帮我)?提醒我([\s\S]+)$/u);
      if (reminder && reminder[1].trim()) {
        const existing = reminderRequests.get(key(event));
        if (existing?.result) return existing.result;
        return save(event, reminder[1].trim(), true);
      }
      if (/^https?:\/\/\S+$/u.test(instruction.trim())) {
        const existing = pending.get(key(event));
        if (existing?.result) return existing.result;
        pending.set(key(event), { event: structuredClone(event), content: instruction.trim() });
        return { status: 'awaiting_confirmation', receipt: '【模拟】是否收集这个链接？请关联原消息回复“确认”或“取消”。' };
      }
      const match = instruction.match(/^(?:请)?(?:帮我)?(?:收集|记录|记下|保存)(?:一下)?[\s:：，,]+([\s\S]*)$/u);
      const content = match?.[1].replace(/^[\s:：，,]+/u, '').trim();
      if (!content) {
        if (!instruction.trim() || match || /^(?:请)?(?:帮我)?(?:收集|记录|记下|保存|提醒我)(?:一下)?$/u.test(instruction.trim())) {
          return { status: 'needs_instruction', receipt: '【模拟】请补充要收集的内容；未创建事项。' };
        }
        if (config.modelIntents) {
          const evaluated = await analyzeMessage(event, instruction);
          return save(event, instruction, evaluated.analysis?.intent === 'remind', evaluated);
        }
        return save(event, instruction.trim());
      }
      return save(event, content);
    },
  };
}

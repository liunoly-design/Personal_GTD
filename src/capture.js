import { activationLength } from './activation.js';
import { resolveReminder, validInstant, validTimeZone } from './reminder-time.js';

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

  async function analyzeMessage(event, content, reminderRequest = false, previousReminder = null, clarification = false) {
    let analysis;
    const started = performance.now();
    const controller = new AbortController();
    let timer;
    let failureReason = null;
    try {
      analysis = await Promise.race([
        Promise.resolve().then(() => analyze({ content, signal: controller.signal, reminderRequest,
          sentAt: event.sentAt, timeZone: config.timeZone, previousReminder, clarification })),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            failureReason = 'timeout';
            controller.abort();
            reject(new Error('Analysis timeout'));
          }, config.analysisTimeoutMs);
        }),
      ]);
      if (!analysis || typeof analysis.title !== 'string' || !analysis.title.trim()
        || [...analysis.title].length > 80 || /[\r\n]/u.test(analysis.title)
        || typeof analysis.suggestion !== 'string' || !analysis.suggestion.trim()
        || [...analysis.suggestion].length > 120 || !/^[^\r\n。！？!?.]+[。！？!?.]?$/u.test(analysis.suggestion)) {
        failureReason = 'invalid_output';
        throw new Error('Invalid analysis output');
      }
    } catch {
      analysis = null;
      failureReason ??= 'analysis_error';
    } finally {
      clearTimeout(timer);
    }
    const metrics = { mode: analyze.mode ?? 'simulation', calls: 1, latencyMs: performance.now() - started,
      inputTokens: null, outputTokens: null, ...analysis?.telemetry, failureReason };
    return { analysis, metrics };
  }

  async function save(event, content, reminderRequest = false, evaluated) {
    const { analysis, metrics } = evaluated ?? await analyzeMessage(event, content, reminderRequest);
    try {
      const candidates = (await reminders.listLists()).filter(x => x.name === 'Inbox');
      if (candidates.length > 1) {
        return { status: 'needs_list_selection', receipt: '【模拟】存在多个 Inbox，请先明确目标列表；未创建事项。', analysis: metrics };
      }
      const list = candidates[0] ?? await reminders.createList('Inbox');
      const item = await reminders.createItem({
        listId: list.id,
        title: analysis?.title ?? [...content.replace(/\s+/gu, ' ')].slice(0, 80).join(''),
        notes: `原文：\n${event.text}` + (analysis ? `\n\n小婕的建议：${analysis.suggestion}` : ''),
      });
      if (reminderRequest) {
        const record = { event: structuredClone(event), itemId: item.id, listId: list.id };
        reminderRequests.set(key(event), record);
        record.result = await applyTime(record, analysis?.reminder, metrics);
        return record.result;
      }
      return {
        status: analysis ? 'collected' : 'collected_analysis_failed', listId: list.id, itemId: item.id,
        analysis: metrics,
        receipt: analysis ? '【模拟】已收集到 Inbox；未设置提醒。' : '【模拟】已收集到 Inbox，分析未完成；未设置提醒。',
      };
    } catch (error) {
      return { status: error?.code === 'WRITE_REJECTED' ? 'failed' : 'result_unknown', analysis: metrics,
        receipt: error?.code === 'WRITE_REJECTED'
          ? '【模拟】写入未成功；本版本不自动重试。'
          : '【模拟】操作结果待核对；本版本不自动核对或重试，请勿直接重复提交。' };
    }
  }

  async function applyTime(record, candidate, metrics) {
    if (candidate) record.candidate = candidate;
    const base = { itemId: record.itemId, listId: record.listId, analysis: metrics };
    const resolved = resolveReminder(candidate);
    if (!resolved) {
      return { ...base, status: 'collected_awaiting_time',
        receipt: metrics.failureReason
          ? '【模拟】已收集，分析未完成，未设置提醒；请关联原请求回复具体日期、时间和时区。'
          : '【模拟】已收集，未设置提醒；请关联原请求回复具体日期、时间和时区。' };
    }
    try {
      const past = Date.parse(resolved.remindAt) <= Date.parse(now());
      const alreadyApplied = past && await reminders.reconcileReminder?.(record.itemId, resolved);
      if (past && !alreadyApplied) {
        return { ...base, status: 'collected_awaiting_time', timeIssue: 'past',
          receipt: '【模拟】已收集，但指定时间已过去，未设置提醒；请关联原请求回复新的日期和时间。' };
      }
      if (!alreadyApplied) await reminders.setReminder(record.itemId, resolved);
      return { ...base, status: 'reminder_set', ...resolved,
        receipt: `【模拟】已收集，提醒已设置：${resolved.localTime} ${resolved.timeZone}。` };
    } catch (error) {
      return { ...base, status: error?.code === 'WRITE_REJECTED' ? 'collected_reminder_failed' : 'reminder_result_unknown',
        receipt: error?.code === 'WRITE_REJECTED'
          ? '【模拟】已收集，但提醒设置失败；未重新创建事项。'
          : '【模拟】已收集，提醒设置结果待核对；不会自动重试。' };
    }
  }

  async function clarifyTime(record, event) {
    if (record.result?.status === 'reminder_set' || record.result?.status === 'reminder_result_unknown') return record.result;
    const { analysis, metrics } = await analyzeMessage(event, event.text, true, record.candidate, true);
    record.result = await applyTime(record, analysis?.reminder, metrics);
    return record.result;
  }

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
        if (waiting.result) return waiting.result;
        if (/^(?:确认|是|是的|收集|好的)[。！!]?$/u.test(event.text.trim())) {
          waiting.result = save(waiting.event, waiting.content);
          return waiting.result;
        }
        if (/^(?:取消|不|不要|不用)[。！!]?$/u.test(event.text.trim())) {
          waiting.result = { status: 'cancelled', receipt: '【模拟】已取消收集，未创建事项。' };
          return waiting.result;
        }
        return { status: 'awaiting_confirmation', receipt: '【模拟】请回复“确认”或“取消”；未创建事项。' };
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

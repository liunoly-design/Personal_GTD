export function createCapture({ reminders, analyze, config = {} }) {
  config = {
    activation: '小婕 GTD', allowedSenderIds: ['demo-user'], allowedConversationIds: ['demo-chat'],
    maxInputChars: 8000, analysisTimeoutMs: 15000, ...structuredClone(config),
  };
  if (typeof config.activation !== 'string' || !config.activation.trim() || config.activation !== config.activation.trim()) {
    throw new Error('activation must be a nonempty trimmed string');
  }
  for (const name of ['maxInputChars', 'analysisTimeoutMs']) {
    if (!Number.isSafeInteger(config[name]) || config[name] < 1) throw new Error(`Invalid ${name}`);
  }
  for (const name of ['allowedSenderIds', 'allowedConversationIds']) {
    if (!Array.isArray(config[name]) || config[name].some(x => typeof x !== 'string' || !x)) throw new Error(`Invalid ${name}`);
  }
  const activation = config.activation;
  const pending = new Map();
  const key = (event, id = event.id) => JSON.stringify([event.senderId, event.conversationId, id]);

  async function save(event, content) {
    let analysis;
    const started = performance.now();
    const controller = new AbortController();
    let timer;
    let failureReason = null;
    try {
      analysis = await Promise.race([
        Promise.resolve().then(() => analyze({ content, signal: controller.signal })),
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
    const metrics = { mode: 'simulation', calls: 1, latencyMs: performance.now() - started,
      inputTokens: null, outputTokens: null, failureReason };
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

  return {
    async handle(event) {
      if (!event || ['id', 'senderId', 'conversationId', 'type', 'sentAt'].some(field => typeof event[field] !== 'string' || !event[field])
        || !Number.isFinite(Date.parse(event.sentAt)) || (event.type === 'text' && typeof event.text !== 'string')
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
      const waiting = event.replyTo && pending.get(key(event, event.replyTo));
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
      if (!event.text.startsWith(activation)) return { status: 'not_handled', receipt: null };
      const remainder = event.text.slice(activation.length);
      if (remainder && !/^[\s，,:：]/u.test(remainder)) return { status: 'not_handled', receipt: null };
      const instruction = remainder.replace(/^[\s，,:：]+/u, '');
      if (/^(?:请)?(?:帮我)?提醒/u.test(instruction)) {
        return { status: 'unsupported', receipt: '【模拟】本任务尚不支持设置提醒时间；未创建事项。' };
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
        return { status: 'needs_instruction', receipt: '【模拟】请明确要收集的内容；未创建事项。' };
      }
      return save(event, content);
    },
  };
}

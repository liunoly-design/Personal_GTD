import { commandHelp } from './command-help.js';
import { completeTask } from './actions/complete-task.js';
import {maintenanceControl,proposeTaskPlan,executeTaskPlan} from './actions/task-maintenance.js';
import { selectionCandidate, taskSelection, selectTasks } from './actions/select-tasks.js';
import { taskQuery, queryTasks, validateQueryConfig } from './actions/query-tasks.js';
import {openReviewSchedule} from './review-schedule.js';
import { openReviewDopl } from './review-dopl.js';
import { openOkrSession } from './okr-session.js';
import { explicitEntry, okrInstruction, validateEntryActivation, gtdGuard, legacyOkrInstruction } from './explicit-entries.js';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { openOperationStore } from './operation-store.js';
import { openDurableCapture } from './durable-capture.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function enabledModules(config) {
  const modules = config.enabledModules ?? ['gtd', 'okr'];
  if (!Array.isArray(modules) || !modules.length || new Set(modules).size !== modules.length
    || modules.some(name => !['gtd', 'okr', 'review'].includes(name))) throw new Error('Invalid enabledModules');
  return modules;
}
export function validateFeishuScope(config) {
  validateEntryActivation(config.activation);
  enabledModules(config);
  validateQueryConfig(config);
  for (const name of ['accountId', 'entryAgentId']) {
    if (typeof config[name] !== 'string' || !config[name].trim()) throw new Error('Explicit scope required');
  }
  for (const [name, pattern] of [['allowedSenderIds', /^ou_[\w-]+$/u], ['allowedConversationIds', /^oc_[\w-]+$/u]]) {
    if (!Array.isArray(config[name]) || !config[name].length || config[name].some(id => !pattern.test(id))) {
      throw new Error('Explicit ID allowlist required');
    }
  }

}
function activated(text, config) {
  return Boolean(explicitEntry(text, config.activation));
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
      || selectionCandidate(ctx.rawText ?? ctx.RawBody) || timeCandidate(ctx.rawText ?? ctx.RawBody));
}
export function openFeishuCapture({ stateDir, config, reminders, feishu, analyze, now, notesBridge, okrGuide, reviewConfig }) {
  config = structuredClone(config);
  validateFeishuScope(config);
  const modules = enabledModules(config);
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
        const query = store.get('routed-result:' + input.replyTo)?.result;
        store.set('reply:' + value.message_id, { ...source, conversationId: input.conversationId,
          rootId: source?.rootId ?? input.replyTo,
          ...(query?.planId ? {planId:query.planId} : {}),
          ...(query?.scope && Array.isArray(query.items) ? {queryEventId:input.replyTo}
            : source?.selectionQueryEventId ? {queryEventId:source.selectionQueryEventId} : {}) });
      });
      return value;
    },
  };
  let capture, okr, review, reviewSchedule;
  try {
    const scopedReminders = {
      listLists: ({ signal } = {}) => reminders.listLists(options(signal)),
      createList: (name, id, { signal } = {}) => reminders.createList(name, id, options(signal)),
      createItem: (input, id, { signal } = {}) => reminders.createItem(input, id, options(signal)),
      setReminder: (itemId, input, id, { signal } = {}) => reminders.setReminder(itemId, input, id, options(signal)),
      getOperation: (id, { signal } = {}) => reminders.getOperation(id, options(signal)),
    };
    const scopedAnalyze = args => analyze({ ...args, ...options(args.signal) });
    scopedAnalyze.mode = analyze?.mode;
    if (modules.includes('okr') && config.okr) {
      if (typeof notesBridge !== 'function') throw new Error('Notes bridge required');
      okr = openOkrSession({ statePath: join(stateDir, 'okr.sqlite'), config: config.okr,
        bridge: request => { options(); return notesBridge(request); },
        guide: okrGuide ? args => okrGuide({ ...args, ...options(args.signal) }) : undefined });
    }
    if (modules.includes('review') && config.review) {
      if (typeof notesBridge !== 'function') throw new Error('Notes bridge required');
      review = openReviewDopl({statePath:join(stateDir,'review.sqlite'),config:config.review,timeZone:config.timeZone,getConfig:reviewConfig,
        bridge:(request, budgets)=>{options();return notesBridge(request,budgets);}});
    }
    if (modules.includes('gtd')) capture = openDurableCapture({ journalPath: join(stateDir, 'capture.sqlite'), reminders: scopedReminders, receipts, analyze: scopedAnalyze,
      config: { ...config, externalTimeoutMs: 20000 }, now });
    reviewSchedule=openReviewSchedule({store,config,review,feishu,now,getConfig:reviewConfig,installLink(messageId,run){
      store.set('reply:'+messageId,{senderId:run.senderId,conversationId:run.conversationId,rootId:run.id,route:'review',reviewLink:run.reviewLink});
    }});
    store.set('account', config.accountId);
  } catch (error) { void okr?.close(); void review?.close(); store.close(); throw error; }
  async function handle(ctx) {
    if (!acceptsFeishuContext(ctx, config)) return { status: 'not_handled' };
    const replyTo = ctx.ReplyToIdFull ?? ctx.ReplyToId;
    const linked = store.get('reply:' + replyTo) ?? store.get('source:' + replyTo);
    if (!activated(ctx.rawText ?? ctx.RawBody, config)
      && !timeCandidate(ctx.rawText ?? ctx.RawBody)
      && !selectionCandidate(ctx.rawText ?? ctx.RawBody)
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
    if ([...event.text].length > (config.maxInputChars ?? 8000)
      || JSON.stringify(event).length > (config.maxEventChars ?? 20000)) {
      return deliverResult(event, { status: 'input_too_large', receipt: '内容超过本地容量，请拆分后发送；未保存或截断原文。' });
    }
    const parentReceipt = store.get('reply:' + message.parent_id);
    const parent = parentReceipt ?? store.get('source:' + message.parent_id);
    // Legacy query receipts copied their original event; maintenance receipts must not inherit it.
    const queryEventId = parentReceipt?.queryEventId ?? (parentReceipt?.event?.id === parentReceipt?.rootId ? parentReceipt?.rootId : undefined);
    const querySnapshot = queryEventId && store.get('routed-result:' + queryEventId)?.result;
    if (parent?.senderId === event.senderId && parent.conversationId === event.conversationId) event.replyTo = parent.rootId;
    const entry = explicitEntry(event.text, config.activation);
    const prefix = entry?.prefix ?? 0;
    const command = entry?.instruction ?? '';
    const legacyInstruction = legacyOkrInstruction(entry);
    const help = event.type === 'text'
      ? commandHelp(legacyInstruction !== null ? { ...entry, module: 'okr', instruction: legacyInstruction } : entry, modules) : null;
    const explicitOkr = entry?.module === 'okr' || legacyInstruction !== null;
    const linkedOkr = !prefix && parent?.route === 'okr' && parent.senderId === event.senderId
      && parent.conversationId === event.conversationId;
    const isOkr = explicitOkr || linkedOkr;
    const isReview = entry?.module === 'review' || (!prefix && parent?.route === 'review' && parent.senderId === event.senderId && parent.conversationId === event.conversationId);
    const retryRequested = isOkr && (linkedOkr ? event.text.trim() : command) === '重试分析';
    if (retryRequested && parentReceipt?.event) {
      const source = parentReceipt.event;
      event.retryParentId = source.id;
      const sourceEntry = explicitEntry(source.text, config.activation);
      const sourceInstruction = sourceEntry?.module === 'okr' ? sourceEntry.instruction : legacyOkrInstruction(sourceEntry);
      event.retryOf = source.retryOf ?? { ...source, action:'record',
        text: sourceInstruction == null ? source.text : okrInstruction(sourceInstruction).text ?? '' };
    }
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
    const previousSource = store.get('source:' + id);
    if (previousSource && (previousSource.providerReplyTo !== message.parent_id
      || previousSource.textHash !== hash(event.text)
      || (previousSource.eventHash && previousSource.eventHash !== hash(event)))) {
      return deliverResult(event, { status: 'event_conflict', receipt: '同一消息 ID 的内容不一致，未新增操作。' });
    }
    const cached = store.get('routed-result:' + id);
    const activePlan=store.entries('maintenance:').find(([,p])=>p.state==='running'&&p.executionEvent?.id===id)?.[1];
    const refreshReview = isReview && cached?.result.status === 'review_error';
    if (cached && !refreshReview && store.get('completion:'+id)?.state !== 'write_started' && !activePlan) return deliverRouted(event, cached.result);
    store.set('source:' + id, { senderId: event.senderId, conversationId: event.conversationId,
      rootId: prefix ? id : event.replyTo ?? id, textHash: hash(event.text), eventHash: hash(event), event, providerReplyTo: message.parent_id, route: help ? 'help' : isOkr ? 'okr' : entry?.module ?? parent?.route ?? 'gtd' });
    let result;
    if (help) {
      store.set('routed-result:' + id, { event, result: help });
      return deliverRouted(event, help);
    }
    if (!isReview && !modules.includes(isOkr ? 'okr' : 'gtd')) {
      result = { status: 'module_disabled', receipt: '该模块未启用，请使用已配置的模块入口。' };
      store.set('routed-result:' + id, { event, result });
      return deliverRouted(event, result);
    } else if (!isReview && (entry?.module==='gtd'||!entry) && ((parentReceipt?.planId && (!entry||maintenanceControl(command)))
      || (maintenanceControl(command||event.text)&&querySnapshot))) {
      const control=maintenanceControl(command||event.text),planId=parentReceipt?.planId;
      result=planId&&!control?{status:'task_plan_help',planId,receipt:'请回复此计划“确认执行”或“取消”。如需修改操作，请回复原任务查询回执重新提出；本次未修改事项。'}
        : planId?await executeTaskPlan({planId,event,control,reminders,config,store,signal:options().signal})
        : {status:'task_plan_needs_reply',receipt:'请回复机器人发出的具体操作计划确认或取消；本次未修改事项。'};
      store.set('routed-result:'+id,{event,result});return deliverRouted(event,result);
    } else if (isReview) {
      result = !review || !modules.includes('review') ? {status:'review_unavailable',receipt:'Review尚未配置/启用，请配置每日心得保存位置；本次未读写。'}
        : event.type !== 'text' ? {status:'review_help',receipt:'每日心得仅支持文字，本次未读写。'}
        : await reviewSchedule.control(event,prefix?command:event.text) ?? await review.handle({...event,text:prefix?command:event.text,link:parentReceipt?.route==='review' && parentReceipt.senderId===event.senderId && parentReceipt.conversationId===event.conversationId?parentReceipt.reviewLink:undefined});
      if(result.registration){result.registration.schedule=reviewSchedule.state();const s=result.registration.schedule;result.receipt+='\n自动询问：'+(s?`${s.enabled?'启用':'暂停'}；北京时间${s.time??'未确定'}；待核对发送${s.unknown}`:'未配置');}
      store.set('source:'+id,{...store.get('source:'+id),reviewLink:result.reviewLink});
      store.set('routed-result:'+id,{event,result});
      return deliverRouted(event,result);
    } else if (isOkr) {
      const instruction = explicitOkr ? (entry.module === 'okr' ? command : legacyInstruction) : '';
      const parsed = okrInstruction(linkedOkr ? event.text.trim() : instruction);
      const shortAnswer = /^(?:不需要|不用|不想|没有|不是|否)[。！!]?$/u.test(event.text.trim());
      const blockedReply = linkedOkr && parsed.action !== 'query' && !shortAnswer && gtdGuard(event.text);
      const action = parsed.action === 'query' ? 'query' : blockedReply ? undefined : linkedOkr ? event.text.trim() === '确认定稿' ? 'confirm'
        : /^(暂停|先停一下)$/u.test(event.text.trim()) ? 'pause' : 'record' : parsed.action;
      const text = action !== 'record' ? '' : linkedOkr ? event.text : parsed.text;
      if ((linkedOkr ? event.text.trim() : instruction) === '重置分析') result = { status:'okr_retry_help', receipt:'恢复分析请回复原“分析未完成”回执发送“重试分析”（试，不是置）。本次未清空记录、未调用模型或写入备忘录。' };
      else if (retryRequested && !event.retryOf) result = { status:'okr_retry_unavailable', receipt:'请回复原“分析未完成”回执发送“重试分析”，以定位已保存的回答；未调用模型。' };
      else if (!okr) result = { status: 'okr_unavailable', receipt: 'OKR 备忘录尚未配置，请先启用 OKR 记录功能。' };
      else if (!action || event.type !== 'text') result = { status: 'okr_help', receipt: '请发送“小婕 okr 讨论/续接”，回复关联消息记录文字，或使用“小婕 okr 记录：内容”“小婕 okr 暂停”。查询当前目标可用“小婕 okr 查询当前目标”；规划和调整尚未实现；定稿须回复当前草案“确认定稿”。' };
      else {
        const confirmVersion = parentReceipt?.route === 'okr' && parentReceipt.senderId === event.senderId
          && parentReceipt.conversationId === event.conversationId ? parentReceipt.draftVersion : undefined;
        try {
          result = await okr.handle({ ...event, action, text, ...(action === 'query' ? { page: parsed.page } : {}), ...(action === 'confirm' ? { confirmVersion } : {}) });
        }
        catch (error) {
          const code = ['INVALID_INPUT', 'CONFLICT', 'CAPACITY_EXCEEDED', 'BUDGET_EXHAUSTED', 'CREATE_RESULT_UNKNOWN',
            'UPDATE_RESULT_UNKNOWN', 'RECOVERY_REQUIRED', 'READBACK_FAILED', 'PERMISSION_DENIED', 'ACCESSIBILITY_DENIED', 'LOCATION_NOT_UNIQUE', 'APPLE_TIMEOUT', 'NOTES_UI_BUSY', 'EDITOR_UNAVAILABLE', 'UI_FOCUS_CHANGED',
            'AX_SELECTION_FAILED', 'HEADING_FORMAT_FAILED', 'TAG_READ_FAILED', 'TAG_WRITE_FAILED',
            'TAG_WRITE_INCOMPLETE', 'TAG_DELIMITER_REQUIRED', 'UNSUPPORTED_NOTE', 'BRIDGE_UNAVAILABLE',
            'APPLE_RESULT_UNKNOWN', 'WRITE_RESULT_UNKNOWN', 'RESPONSE_TOO_LARGE'].includes(error.message)
            ? error.message : 'NOTES_UNAVAILABLE';
          const explanation = code === 'INVALID_INPUT' ? '请使用不超过 4000 字的非空文字。'
            : code === 'ACCESSIBILITY_DENIED' ? '网关运行程序（node）的辅助功能权限未开启，请在 macOS“隐私与安全性 → 辅助功能”中开启后再试。'
            : code === 'APPLE_TIMEOUT' ? '备忘录操作超时。请保留原消息，核对保存状态后恢复，避免重复提交。'
            : code === 'NOTES_UI_BUSY' ? '备忘录正在被另一项操作使用。请保留原消息，待操作结束后核对恢复。'
            : code === 'EDITOR_UNAVAILABLE' ? '未找到可读取的备忘录编辑窗口。请打开备忘录并保持窗口可见，再发送“小婕 okr 续接”核对已保存进度；恢复模型分析须回复原分析失败回执发送“重试分析”。'
            : ['TAG_WRITE_FAILED','TAG_WRITE_INCOMPLETE','TAG_DELIMITER_REQUIRED'].includes(code) ? '原生标签尚未完成核对，不能确认整体记录成功；正文可能已经写入。请打开备忘录并保持窗口可见，再发送“小婕 okr 续接”核对。若仍失败，请联系维护者修复格式；保留原消息，不要发送“重试分析”或重复提交原回答。'
            : ['WRITE_RESULT_UNKNOWN','UPDATE_RESULT_UNKNOWN','READBACK_FAILED'].includes(code) ? '备忘录正文或格式尚未核对成功，不能确认完整落盘。请打开备忘录并保持窗口可见，再发送“小婕 okr 续接”；系统只核对已保存的待写入内容，不重新分析。若仍失败，请保留原消息并联系维护者核对恢复，不要发送“重试分析”或重复提交原回答。'
            : code === 'PERMISSION_DENIED' ? '请检查网关运行程序控制备忘录的自动化权限。'
            : code === 'CAPACITY_EXCEEDED' || code === 'BUDGET_EXHAUSTED' ? '记录已达到本版容量上限。'
            : '请保留原消息，核对备忘录后再继续。';
          const operation = ['bind', 'find', 'create', 'read', 'append', 'replace'].includes(error.operation) ? error.operation : 'unknown';
          const phaseNames = {read:'标签附件读取', 'paste-readback':'粘贴正文核对', 'tag-insert':'标签激活核对', 'tag-delete':'临时分隔删除核对', 'tag-readback':'标签转换核对', 'heading-format':'标题格式核对'};
          const nativePhase = Object.hasOwn(phaseNames,error.nativePhase) ? error.nativePhase : undefined;
          store.set('okr-error:' + hash([event.senderId, event.conversationId, event.id]), { code, operation, ...(nativePhase ? {nativePhase} : {}), at: now?.() ?? new Date().toISOString() });
          result = { status: 'okr_error', code, operation, receipt: `OKR 记录未确认完成。原因：${code}（${operation}）。${nativePhase ? '执行阶段：'+phaseNames[nativePhase]+'。' : ''}${explanation}` };
        }
      }
    } else if ((entry?.module === 'gtd' || !entry) && !taskQuery(command) && (selectionCandidate(command || event.text)
      || (!entry && querySnapshot?.items))) {
      const snapshot = querySnapshot;
      const selection = taskSelection(command || event.text);
      if (!parentReceipt || !snapshot?.scope || !Array.isArray(snapshot.items)) result = {
        status:'task_selection_needs_query',receipt:'请回复机器人发出的任务查询回执，用编号选择事项；未执行或创建事项。',
      };
      else if (parentReceipt.senderId !== event.senderId || parentReceipt.conversationId !== event.conversationId) result = {
        status:'task_selection_forbidden',receipt:'这条查询回执不属于当前用户或会话，请自行查询后回复对应回执；未执行或创建事项。',
      };
      else if (!selection) result = {status:'task_selection_invalid',receipt:'没有看清要操作的编号和动作。可以直接回复这条提示，如“第一项标记完成”或“第一第二项完成”；单项完成已支持，批量完成尚未实现。本次未执行或创建事项。'};
      else if(selection.length===1&&selection[0].action==='complete') result=await completeTask({event,snapshot,selection,reminders,config,store,signal:options().signal});
      else if(selection.some(x=>x.action!=='select'))result=await proposeTaskPlan({event,queryEventId,snapshot,selection,reminders,config,store,signal:options().signal});
      else result = await selectTasks({snapshot,selection,reminders,config,signal:options().signal});
      if (['task_selection_invalid','task_selection_unavailable'].includes(result.status)
        && parentReceipt?.senderId === event.senderId && parentReceipt.conversationId === event.conversationId) {
        store.set('source:' + id, {...store.get('source:' + id), selectionQueryEventId:queryEventId});
      }
      store.set('routed-result:' + id, {event,result});
      return deliverRouted(event,result);
    } else if (entry?.module === 'gtd' && taskQuery(command)) {
      result = await queryTasks({ reminders, config, ...taskQuery(command), now, signal: options().signal });
      store.set('routed-result:' + id, { event, result });
      return deliverRouted(event, result);
    } else result = await capture.handle(event);
    if (result.draftVersion) store.set('source:' + id, { ...store.get('source:' + id), draftVersion: result.draftVersion });
    if ((['review_unavailable', 'okr_unavailable', 'okr_help'].includes(result.status) || result.status.startsWith('okr_query'))) {
      store.set('routed-result:' + id, { event, result });
      return deliverRouted(event, result);
    }
    return deliverResult(event, result);
  }
  async function deliverRouted(event, result) {
    if (!config.allowedSenderIds.includes(event.senderId) || !config.allowedConversationIds.includes(event.conversationId)) {
      return { status: 'forbidden', receipt: null };
    }
    const retry = { ...result };
    if (retry.delivery === 'pending') delete retry.delivery;
    const delivered = await deliverResult(event, retry);
    store.set('routed-result:' + event.id, { event, result: delivered });
    return delivered;
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
    tickReview() {return enqueue(()=>reviewSchedule.tick());},
    recover() { return enqueue(async () => {
      const results = capture ? await capture.recover() : [];
      for(const [,plan]of (modules.includes('gtd') ? store.entries('maintenance:') : []).filter(([,p])=>p.state==='running').slice(0,1)) {
        const event=plan.executionEvent;
        if(!config.allowedSenderIds.includes(event.senderId)||!config.allowedConversationIds.includes(event.conversationId))continue;
        const result=await executeTaskPlan({planId:plan.planId,event,control:'confirm',reminders,config,store,signal:options().signal});
        store.set('routed-result:'+event.id,{event,result});results.push(await deliverRouted(event,result));
      }
      for (const [, record] of (modules.includes('gtd') ? store.entries('completion:') : []).filter(([,r])=>r.state==='write_started').slice(0,10)) {
        if(!config.allowedSenderIds.includes(record.event.senderId)||!config.allowedConversationIds.includes(record.event.conversationId))continue;
        const result=await completeTask({event:record.event,reminders,config,store,signal:options().signal});
        store.set('routed-result:'+record.event.id,{event:record.event,result});
        results.push(await deliverRouted(record.event,result));
      }
      for (const [, cached] of store.entries('routed-result:')) {
        if (cached.result.delivery !== 'sent') results.push(await deliverRouted(cached.event, cached.result));
      }
      return results;
    }); },
    async close() { if (closed) return; closed = true; await queue; await capture?.close(); await okr?.close(); await review?.close(); store.close(); },
  };
}

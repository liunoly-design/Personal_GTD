import { activationLength } from './activation.js';

// Parsing is separate from the trusted event; never rewrite its text or ID.
export function explicitEntry(text, activation) {
  for (const module of ['gtd', 'okr', 'review']) {
    const prefix = activationLength(text, `小婕 ${module}`);
    if (prefix) return { module, prefix, instruction: text.slice(prefix).replace(/^[\s，,:：]+/u, '') };
  }
  const prefix = activationLength(text, activation);
  return prefix ? { module: 'gtd', prefix, instruction: text.slice(prefix).replace(/^[\s，,:：]+/u, '') } : null;
}

export function okrInstruction(instruction) {
  if (gtdGuard(instruction)) return {};
  if (instruction === '确认定稿') return { action: 'confirm', text: '' };
  if (/^(暂停|先停一下)$/u.test(instruction)) return { action: 'pause', text: '' };
  if (/^(讨论|聊聊|一起想想|梳理目标|续接|继续|接着聊)(?=$|[\s，,:：])/u.test(instruction)) return { action: 'open', text: '' };
  const record = instruction.match(/^(?:请)?(?:帮我)?(?:收集|记录|记一下|记下|记|保存|存一下)(?:一下)?[\s，,:：]+([\s\S]+)$/u);
  if (record?.[1].trim()) return { action: 'record', text: record[1] };
  return {};
}

// These are bounded command shapes, not general natural-language intent inference.
export function gtdGuard(instruction) {
  const text = instruction.trim();
  const unquoted = text.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/gu, '');
  if (/^(?:请)?(?:别|不要|不用|不需要|不想|禁止)|^(?:如果|假如|假设|例如|比如|引用|他说|她说|[“"'「『>])/u.test(text)
    || /^小婕\s*(?:gtd|okr|review)(?=$|[\s，,:：])/iu.test(text)
    || /(?:并|然后|同时|再)(?:请)?(?:查询|查看|完成任务|新建日程|复盘|规划)/u.test(unquoted)) {
    return { status: 'needs_instruction', receipt: '【模拟】这条表达包含否定、引用或多个/不明确操作，请明确一个要处理的动作；未创建事项。' };
  }
  if (/^(?:请)?(?:帮我)?(?:查询|查一下|查看|看看|看一下|找一下|列出(?:来)?|有哪些|记录过什么|保存过什么|收集过什么|复盘|回顾|规划|计划一下)/u.test(text)
    || /^(?:请)?(?:帮我)?(?:更新|修改|改一下|更正|移动|删除|完成|重开)(?:任务|事项|提醒|日程)(?=$|[\s，,:：])/u.test(text)
    || /^(?:新建|创建|添加)(?:日程|会议|日历事件)(?=$|[\s，,:：])/u.test(text)
    || /^(?:标记完成|将所选任务标记完成|这件事做完了)(?=$|[\s，,:：])/u.test(text)
    || /^(?:整理\s*Inbox|执行计划)(?=$|[\s，,:：])/iu.test(text)) {
    return { status: 'gtd_unsupported', receipt: '【模拟】本入口的查询、任务维护、日历、整理/执行计划及规划/复盘尚未实现；本次未执行或创建事项。可使用收集、记录或提醒。' };
  }
  return null;
}

export function validateEntryActivation(activation = '小婕 GTD') {
  if (typeof activation !== 'string' || !activation.trim() || activation !== activation.trim()) throw new Error('Invalid activation');
  for (const module of ['okr', 'review']) {
    const canonical = `小婕 ${module}`;
    // Both directions matter: a short custom prefix can swallow a namespace.
    if (activationLength(activation, canonical) || activationLength(canonical, activation)
      || activationLength(`小婕${module}`, activation)) {
      throw new Error(`activation conflict with ${module} entry`);
    }
  }
}

export function legacyOkrInstruction(entry) {
  if (entry?.module !== 'gtd' || !/^okr(?=$|[\s，,:：])/iu.test(entry.instruction)) return null;
  const instruction = entry.instruction.slice(3).replace(/^[\s，,:：]+/u, '');
  // An ordinary mention is content, while the old command namespace stays reserved.
  if (/^(?:和|与|的|相关|资料)/u.test(instruction)) return null;
  return instruction;
}

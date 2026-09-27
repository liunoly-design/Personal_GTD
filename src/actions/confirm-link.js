export function confirmLink(waiting, event, save) {
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

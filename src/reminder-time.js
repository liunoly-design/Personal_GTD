import { Temporal } from '@js-temporal/polyfill';

export function validInstant(value) {
  try { Temporal.Instant.from(value); return true; } catch { return false; }
}

export function validTimeZone(value) {
  try { Temporal.Instant.from('2000-01-01T00:00:00Z').toZonedDateTimeISO(value); return true; } catch { return false; }
}

export function resolveReminder(candidate) {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(candidate?.date) || !/^\d{2}:\d{2}$/u.test(candidate?.time)
      || typeof candidate?.timeZone !== 'string' || candidate.timeZone.length > 80) return null;
    const local = Temporal.PlainDateTime.from(`${candidate.date}T${candidate.time}`, { overflow: 'reject' });
    const zoned = local.toZonedDateTime(candidate.timeZone, { disambiguation: 'reject' });
    return { remindAt: zoned.toInstant().toString(), timeZone: candidate.timeZone,
      localTime: local.toString({ smallestUnit: 'minute' }) };
  } catch {
    return null;
  }
}

// This is a small synthetic parser for demos, not an assessment of model quality.
export function simulateReminderTime(content, { sentAt, timeZone, previousReminder, clarification }) {
  timeZone = previousReminder?.timeZone ?? timeZone;
  let text = content.trim();
  const zone = text.match(/^\[([^\]]+)\]\s*/u);
  if (zone) {
    timeZone = zone[1];
    text = text.slice(zone[0].length);
  } else if (text.startsWith('北京时间')) {
    timeZone = 'Asia/Shanghai';
    text = text.slice(4);
  }
  const baseDate = Temporal.Instant.from(sentAt).toZonedDateTimeISO(timeZone).toPlainDate();
  let date = previousReminder?.date ?? null;
  const absolute = text.match(/^(\d{4}-\d{2}-\d{2})[T\s]*/u);
  const relative = text.match(/^(今天|明天|后天)/u);
  if (absolute) {
    date = absolute[1];
    text = text.slice(absolute[0].length);
  } else if (relative) {
    date = baseDate.add({ days: { 今天: 0, 明天: 1, 后天: 2 }[relative[1]] }).toString();
    text = text.slice(relative[0].length);
  }
  text = text.trim();
  const numeric = text.match(/^(\d{1,2}):(\d{2})(?![\d:])/u);
  const chinese = text.match(/^下午(?:三|3)点(半)?(?![\d零一二两三四五六七八九十分])/u);
  const consumed = numeric?.[0] ?? chinese?.[0] ?? '';
  const tail = text.slice(consumed.length).trim();
  let time = numeric ? `${numeric[1].padStart(2, '0')}:${numeric[2]}`
    : chinese ? (chinese[1] ? '15:30' : '15:00') : null;
  if (!text && (absolute || relative)) time = previousReminder?.time ?? null;
  if (/^(?:或|到|至|左右|前后|以前|以后|之前|之后|[-~～—]|Z|\+\d)/u.test(tail)) time = null;
  if (clarification && tail && !/^[。.!！]*$/u.test(tail)) time = null;
  return { date, time, timeZone };
}

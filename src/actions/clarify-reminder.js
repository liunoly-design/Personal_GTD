export function createReminderClarifier({ analyzeMessage, applyTime }) {
  async function clarifyTime(record, event) {
    if (record.result?.status === 'reminder_set' || record.result?.status === 'reminder_result_unknown') return record.result;
    const { analysis, metrics } = await analyzeMessage(event, event.text, true, record.candidate, true);
    record.result = await applyTime(record, analysis?.reminder, metrics);
    return record.result;
  }

  return clarifyTime;
}

export function createMessageAnalyzer({ analyze, config }) {
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

  return analyzeMessage;
}

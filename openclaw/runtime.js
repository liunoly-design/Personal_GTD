import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { callNotes } from '../src/apple-notes.js';
import { openAppleReminders } from '../src/apple-reminders.js';
import { openGeminiAnalyzer } from '../src/gemini.js';
import { openClawGoogleKey } from '../src/openclaw-auth.js';
import { createFeishuClient } from '../src/feishu-http.js';
import { openFeishuCapture, enabledModules } from '../src/feishu-capture.js';

export async function openRuntime({ config, hostConfig, googleKey = openClawGoogleKey }) {
  if (!isAbsolute(config.runtimeConfigPath) || !isAbsolute(config.stateDir)) throw new Error('Absolute private paths required');
  const runtime = JSON.parse(await readFile(config.runtimeConfigPath, 'utf8'));
  const modules = enabledModules({ ...runtime, ...config });
  const needsModel = modules.some(name => name === 'gtd' || name === 'okr');
  if (needsModel && (!isAbsolute(runtime.usagePath ?? '') || !Number.isFinite(runtime.model?.maxBudgetUsd) || !Number.isSafeInteger(runtime.model?.maxCalls))) {
    throw new Error('Explicit shared budget ledger and limits required');
  }
  if (modules.includes('gtd') && !isAbsolute(runtime.remindersHelperPath ?? '')) throw new Error('Absolute Reminders helper path required');
  const channel = hostConfig.channels?.feishu;
  const account = { ...channel, ...channel?.accounts?.[config.accountId] };
  if (account.domain && account.domain !== 'feishu') throw new Error('Only Feishu domain supported');
  if (account.enabled === false) throw new Error('Feishu account disabled');
  const feishu = createFeishuClient({ credentials: () => ({ appId: account.appId, appSecret: account.appSecret }) });
  let model, reminders, capture;
  try {
    if (needsModel) {
      const apiKey = googleKey({ agentId: runtime.authAgent ?? 'gtd', ...(runtime.openclawPackageDir ? { packageDir: runtime.openclawPackageDir } : {}) });
      // The host SDK's cold import can block the event loop beyond the task's
      // analysis deadline. Prepare credentials before starting that deadline.
      let preparationTimer;
      try {
        await Promise.race([Promise.resolve().then(apiKey), new Promise((_, reject) => {
          preparationTimer = setTimeout(() => reject(new Error('Credential preparation timeout')), 30000);
        })]);
      } catch { /* Preserve explicit collection's analysis-failure fallback. */ }
      finally { clearTimeout(preparationTimer); }
      model = openGeminiAnalyzer({ statePath: runtime.usagePath, config: runtime.model,
        apiKey });
    }
    if (modules.includes('gtd')) reminders = openAppleReminders({ sourceId: runtime.sourceId, listId: runtime.listId, helperPath: runtime.remindersHelperPath, statePath: join(config.stateDir, 'adapter.sqlite') });
    capture = openFeishuCapture({ stateDir: config.stateDir, config: { ...runtime, ...config, modelIntents: true },
      reminders, feishu, analyze: model?.analyze, notesBridge: callNotes, okrGuide: model?.discussOkr });
    return { async tickReview(){
      const current=JSON.parse(await readFile(config.runtimeConfigPath,'utf8'));
      if(!enabledModules({...current,...config}).includes('review')||current.review?.readEnabled===false||current.review?.writeEnabled!==true
        ||JSON.stringify(current.review)!==JSON.stringify(runtime.review))return {status:'review_schedule_forbidden'};
      return capture.tickReview();
    },handle: (ctx, options) => capture.handle(ctx, options), recover: () => capture.recover(), async close() {
      await capture.close(); reminders?.close(); await model?.close();
    } };
  } catch (error) { await capture?.close(); reminders?.close(); await model?.close(); throw error; }
}

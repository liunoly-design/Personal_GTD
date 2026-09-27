import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { openAppleReminders } from '../src/apple-reminders.js';
import { openGeminiAnalyzer } from '../src/gemini.js';
import { openClawGoogleKey } from '../src/openclaw-auth.js';
import { createFeishuClient } from '../src/feishu-http.js';
import { openFeishuCapture } from '../src/feishu-capture.js';

export async function openRuntime({ config, hostConfig }) {
  if (!isAbsolute(config.runtimeConfigPath) || !isAbsolute(config.stateDir)) throw new Error('Absolute private paths required');
  const runtime = JSON.parse(await readFile(config.runtimeConfigPath, 'utf8'));
  if (!isAbsolute(runtime.usagePath ?? '') || !Number.isFinite(runtime.model?.maxBudgetUsd) || !Number.isSafeInteger(runtime.model?.maxCalls)) {
    throw new Error('Explicit shared budget ledger and limits required');
  }
  const channel = hostConfig.channels?.feishu;
  const account = { ...channel, ...channel?.accounts?.[config.accountId] };
  if (account.domain && account.domain !== 'feishu') throw new Error('Only Feishu domain supported');
  if (account.enabled === false) throw new Error('Feishu account disabled');
  const feishu = createFeishuClient({ credentials: () => ({ appId: account.appId, appSecret: account.appSecret }) });
  let model, reminders, capture;
  try {
    model = openGeminiAnalyzer({ statePath: runtime.usagePath, config: runtime.model,
      apiKey: openClawGoogleKey({ agentId: runtime.authAgent ?? 'gtd', ...(runtime.openclawPackageDir ? { packageDir: runtime.openclawPackageDir } : {}) }) });
    reminders = openAppleReminders({ sourceId: runtime.sourceId, listId: runtime.listId, statePath: join(config.stateDir, 'adapter.sqlite') });
    capture = openFeishuCapture({ stateDir: config.stateDir, config: { ...runtime, ...config, modelIntents: true },
      reminders, feishu, analyze: model.analyze });
    return { handle: (ctx, options) => capture.handle(ctx, options), recover: () => capture.recover(), async close() {
      await capture.close(); reminders.close(); await model.close();
    } };
  } catch (error) { await capture?.close(); reminders?.close(); await model?.close(); throw error; }
}

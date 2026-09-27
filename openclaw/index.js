import { acceptsFeishuContext, validateFeishuScope } from '../src/feishu-capture.js';
import { openRuntime as defaultOpenRuntime } from './runtime.js';

export function createPlugin({ openRuntime = defaultOpenRuntime } = {}) {
  return {
    id: 'personal-gtd', name: 'Personal GTD',
    register(api) {
      const config = api.pluginConfig ?? {};
      if (config.enabled !== true) return;
      validateFeishuScope(config);
      let runtime;
      api.registerService({ id: 'personal-gtd', start() {}, async stop() {
        if (runtime) { const active = await runtime.catch(() => null); await active?.close(); }
      } });
      api.on('reply_dispatch', async (event, context) => {
        if (!acceptsFeishuContext(event.ctx, config)) return;
        const finish = (status, queuedFinal = false) => {
          context.recordProcessed('completed', { reason: 'personal_gtd_' + status });
          context.markIdle('message_completed');
          return { handled: true, queuedFinal, counts: context.dispatcher.getQueuedCounts() };
        };
        if (event.sendPolicy !== 'allow' || event.suppressUserDelivery || event.suppressReplyLifecycle
          || event.shouldRouteToOriginating || event.isTailDispatch || context.abortSignal?.aborted) return finish('suppressed');
        try {
          const started = performance.now();
          runtime ??= openRuntime({ config, hostConfig: api.config });
          const result = await (await runtime).handle(event.ctx, { signal: context.abortSignal });
          if (result.status === 'not_handled') return;
          if (result.status === 'invalid_source') throw new Error('Unverified source');
          if (['busy', 'budget_exhausted'].includes(result.status) && !result.receipt) {
            return finish(result.status, context.dispatcher.sendFinalReply({
              text: '【PGTD】处理队列或记录容量已满，本次未开始收集；请让管理 agent 检查容量后重试。',
            }));
          }
          api.logger.info('personal-gtd: ' + JSON.stringify({ status: result.status, delivery: result.delivery ?? 'none',
            latencyMs: Math.round(performance.now() - started), calls: result.analysis?.calls ?? 0,
            inputTokens: result.analysis?.inputTokens ?? null, outputTokens: result.analysis?.outputTokens ?? null,
            estimatedCostUsd: result.analysis?.estimatedCostUsd ?? null, failureReason: result.analysis?.failureReason ?? null }));
          return finish(result.status);
        } catch {
          api.logger.warn('personal-gtd: request_unconfirmed; inspect private state before retry');
          const queued = !context.abortSignal?.aborted && context.dispatcher.sendFinalReply({
            text: '【PGTD】请求未确认完成，请让管理 agent 核对配置及恢复记录；请勿用新消息重复提交。', isError: true,
          });
          return finish('unconfirmed', queued);
        }
      }, { priority: 100, eligibleDispatchKinds: ['agent'] });
    },
  };
}
export default createPlugin();

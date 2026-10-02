import { readFile } from 'node:fs/promises';
import { callApple } from '../src/apple-reminders.js';
import { queryTasks, validateQueryConfig } from '../src/actions/query-tasks.js';

// Explicit opt-in; no authorization prompt, adapter DB, model, Feishu or Apple writes.
const args = process.argv.slice(2);
const path = args[args.indexOf('--config') + 1];
if (!args.includes('--read-inbox') || !args.includes('--config') || !path) {
  throw new Error('Usage: npm run verify:query -- --read-inbox --config /absolute/private/config.json');
}
const config = JSON.parse(await readFile(path, 'utf8'));
if (!config.sourceId || !config.listId) throw new Error('Explicit authorized sourceId and listId required');
validateQueryConfig(config);
const result = await queryTasks({ config, page: 1, reminders: {
  queryTasks: (page, options) => callApple({ command: 'queryTasks', sourceId: config.sourceId, listId: config.listId, ...page }, options),
} });
// Avoid printing private task titles; inspect them via the trusted user query after deployment.
console.log(JSON.stringify({ status: result.status, code: result.code, scope: result.scope, readAt: result.readAt,
  total: result.total, hasMore: result.hasMore, references: result.items?.map(({ id, listId, sourceId }) => ({ id, listId, sourceId })) }));
if (!['tasks_found', 'tasks_empty'].includes(result.status)) process.exitCode = 1;

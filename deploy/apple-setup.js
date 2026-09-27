import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { callApple } from '../src/apple-reminders.js';

const path = 'runtime/apple/config.json';
if (existsSync(path)) throw new Error('Existing Apple binding preserved; inspect the private configuration before changing it');
const catalog = await callApple({ command: 'catalog' });
if (!catalog.defaultSourceId) throw new Error('No default reminder account available');
const candidates = catalog.lists.filter(list => list.sourceId === catalog.defaultSourceId && list.name === 'Inbox');
if (candidates.length > 1) throw new Error('Multiple Inbox lists in default account; select a list ID explicitly');
mkdirSync('runtime/apple', { recursive: true, mode: 0o700 });
writeFileSync(path, JSON.stringify({ sourceId: catalog.defaultSourceId, ...(candidates[0] ? { listId: candidates[0].id } : {}),
  allowedSenderIds: ['demo-user'], allowedConversationIds: ['demo-chat'], externalTimeoutMs: 15000 }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ configured: true, account: 'system-default', inbox: candidates.length ? 'existing-bound-by-id' : 'will-create' }));

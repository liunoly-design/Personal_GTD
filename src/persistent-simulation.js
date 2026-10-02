import { randomUUID, createHash } from 'node:crypto';
import { openOperationStore } from './operation-store.js';

// Separate database represents the external authority in restart tests. No network or Apple access.
export function openPersistentSimulation({ path, afterWrite = () => {} }) {
  const store = openOperationStore(path);
  function write(kind, input, operationId, apply) {
    if (!operationId) throw new Error('Operation ID required');
    const hash = createHash('sha256').update(JSON.stringify([kind, input])).digest('hex');
    const value = store.transaction(() => {
      const old = store.get('operation:' + operationId);
      if (old) {
        if (old.hash !== hash) throw new Error('Operation conflict');
        return old.value;
      }
      const value = apply();
      store.set('operation:' + operationId, { hash, value });
      return value;
    });
    afterWrite(kind);
    return value;
  }
  const service = {
    async getOperation(id) {
      const record = store.get('operation:' + id);
      return record ? { state: 'applied', value: record.value } : { state: 'absent' };
    },
    async queryTasks({ limit, offset }) {
      const binding = store.get('query-binding');
      const lists = store.entries('list:').map(([, value]) => value);
      if (!binding) return { state: 'needs_list', candidates: lists };
      const list = lists.find(list => list.id === binding);
      if (!list) throw new Error('List unavailable');
      const all = store.entries('item:').map(([, value]) => value).filter(item => item.listId === list.id);
      if (all.length > 10000) throw new Error('Query capacity');
      const items = all.filter(item => item.listId === list.id && !item.completed)
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      return { state: 'ok', list: { ...list, sourceId: 'sim-source' }, total: items.length, hasMore: offset + limit < items.length,
        items: items.slice(offset, offset + limit).map(item => ({ id: item.id, listId: item.listId, title: item.title, completed: false })) };
    },
    async listLists() { return store.entries('list:').map(([, value]) => value); },
    async listItems() { return store.entries('item:').map(([, value]) => value); },
    async listReceipts() { return store.entries('receipt:').map(([, value]) => value); },
    async getItem(id) { return store.get('item:' + id); },
    async createList(name, operationId) {
      return write('list', name, operationId, () => {
        const value = { id: 'sim-list-' + randomUUID(), name };
        store.set('list:' + value.id, value);
        return value;
      });
    },
    async createItem(input, operationId) {
      return write('item', input, operationId, () => {
        if (!store.get('list:' + input.listId)) throw new Error('Missing list');
        const value = { ...input, id: 'sim-item-' + randomUUID(), remindAt: null };
        store.set('item:' + value.id, value);
        store.set('query-binding', input.listId);
        return value;
      });
    },
    async setReminder(id, input, operationId) {
      return write('reminder', { id, ...input }, operationId, () => {
        const old = store.get('item:' + id);
        if (!old) throw Object.assign(new Error('Missing item'), { code: 'WRITE_REJECTED' });
        const value = { ...old, ...input };
        store.set('item:' + id, value);
        return value;
      });
    },
    async send(input, operationId) {
      return write('receipt', input, operationId, () => {
        const value = { ...input, id: 'sim-receipt-' + randomUUID() };
        store.set('receipt:' + value.id, value);
        return value;
      });
    },
    close() { store.close(); },
  };
  return service;
}

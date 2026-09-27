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

import { randomUUID } from 'node:crypto';
import { simulateReminderTime } from './reminder-time.js';

// Only an in-memory external-service substitute. Never accesses Apple or the network.
export function createSimulatedReminders({ rejectWrites = false, rejectReminders = false, loseReminderResponse = false, loseCreateResponse = false } = {}) {
  const lists = new Map();
  const items = new Map();
  const operations = new Map();
  function checkWrite() {
    if (rejectWrites) throw Object.assign(new Error('Synthetic write rejection'), { code: 'WRITE_REJECTED' });
  }
  return {
    async listLists() { return structuredClone([...lists.values()]); },
    async getOperation(id) { return operations.has(id) ? { state: 'applied', value: structuredClone(operations.get(id)) } : { state: 'absent' }; },
    async createList(name, operationId) {
      if (operationId && operations.has(operationId)) return structuredClone(operations.get(operationId));
      checkWrite();
      const list = { id: `sim-list-${randomUUID()}`, name };
      lists.set(list.id, list);
      if (operationId) operations.set(operationId, structuredClone(list));
      return structuredClone(list);
    },
    async createItem(input, operationId) {
      if (operationId && operations.has(operationId)) return structuredClone(operations.get(operationId));
      checkWrite();
      if (!lists.has(input.listId)) throw new Error('List does not exist');
      const item = { ...input, id: `sim-item-${randomUUID()}`, remindAt: null };
      items.set(item.id, structuredClone(item));
      if (operationId) operations.set(operationId, structuredClone(item));
      if (loseCreateResponse) throw new Error('Synthetic create response lost');
      return structuredClone(item);
    },
    async getItem(id) { return structuredClone(items.get(id)); },
    async setReminder(id, { remindAt, timeZone }, operationId) {
      if (operationId && operations.has(operationId)) return structuredClone(operations.get(operationId));
      checkWrite();
      if (rejectReminders) throw Object.assign(new Error('Synthetic reminder rejection'), { code: 'WRITE_REJECTED' });
      const item = items.get(id);
      if (!item) throw Object.assign(new Error('Missing item'), { code: 'WRITE_REJECTED' });
      item.remindAt = remindAt;
      item.timeZone = timeZone;
      if (operationId) operations.set(operationId, structuredClone(item));
      if (loseReminderResponse) throw new Error('Synthetic response lost after writing');
      return structuredClone(item);
    },
    async listItems() { return structuredClone([...items.values()]); },
  };
}

// Fixed synthetic analysis demonstrates the boundary, not model understanding.
export async function simulatedAnalysis({ content, reminderRequest, sentAt, timeZone, previousReminder, clarification }) {
  return { title: [...content.replace(/\s+/gu, ' ')].slice(0, 80).join(''), suggestion: '明确这件事的下一步处理方式。',
    ...(reminderRequest ? { reminder: simulateReminderTime(content, { sentAt, timeZone, previousReminder, clarification }) } : {}) };
}

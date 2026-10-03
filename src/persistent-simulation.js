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
  const revision = item => createHash('sha256').update(JSON.stringify(item)).digest('hex');
  const fieldsRevision = ({completed,completionDate,...fields}) => revision(fields);
  const contentRevision = ({id,listId,...fields}) => revision(fields);
  const service = {
    async getOperation(id) {
      const record = store.get('operation:' + id);
      return record ? { state: 'applied', value: record.value } : { state: 'absent' };
    },
    async queryTasks({ limit, offset, listName }) {
      const binding = store.get('query-binding');
      const lists = store.entries('list:').map(([, value]) => value);
      const matches = listName === undefined ? null : lists.filter(list => list.name.toLowerCase() === listName.toLowerCase());
      if (matches?.length === 0) return { state: 'list_not_found' };
      if (matches?.length > 1) return { state: 'ambiguous_list', candidates: matches };
      if (listName === undefined && !binding) return { state: 'needs_list', candidates: lists };
      const list = matches ? matches[0] : lists.find(list => list.id === binding);
      if (!list) throw new Error('List unavailable');
      const all = store.entries('item:').map(([, value]) => value).filter(item => item.listId === list.id);
      if (all.length > 10000) throw new Error('Query capacity');
      const items = all.filter(item => item.listId === list.id && !item.completed)
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      return { state: 'ok', list: { ...list, sourceId: 'sim-source' }, total: items.length, hasMore: offset + limit < items.length,
        items: items.slice(offset, offset + limit).map(item => ({ id: item.id, listId: item.listId, title: item.title, completed: false, revision:revision(item), fieldsRevision:fieldsRevision(item),contentRevision:contentRevision(item) })) };
    },
    async readTasks({items}) {
      return {items:items.map(({id,listId}) => {
        const item=store.get('item:' + id);
        return !item || item.listId !== listId ? {id,state:'unavailable'} : {id,state:'ok',value:{id,listId,sourceId:'sim-source',title:item.title,completed:Boolean(item.completed),revision:revision(item),fieldsRevision:fieldsRevision(item),contentRevision:contentRevision(item)}};
      })};
    },
    async resolveTaskTarget({name,sourceListId,sourceOnly=false}) {
      if(!store.get('list:'+sourceListId))throw new Error('Source unavailable');
      if(sourceOnly)return {state:'ok',list:{...store.get('list:'+sourceListId),sourceId:'sim-source',writable:true}};
      const lists=store.entries('list:').map(([,v])=>v).filter(v=>v.name.toLowerCase()===name.toLowerCase());
      return {state:lists.length===1?'ok':lists.length?'ambiguous_list':'list_not_found',...(lists.length===1?{list:{...lists[0],sourceId:'sim-source',writable:true}}:{})};
    },
    async moveTask(input,operationId) {
      return write('move',input,operationId,()=>{
        const item=store.get('item:'+input.id);
        if(!item||item.listId!==input.listId||!store.get('list:'+input.targetListId))throw Object.assign(new Error('Item unavailable'),{code:'WRITE_REJECTED',reason:'ITEM_UNAVAILABLE'});
        if(revision(item)!==input.expectedRevision||contentRevision(item)!==input.contentRevision)throw Object.assign(new Error('Item changed'),{code:'WRITE_REJECTED',reason:'ITEM_CHANGED'});
        const value={...item,listId:input.targetListId};store.set('item:'+item.id,value);return value;
      });
    },
    async completeTask(input,operationId) {
      return write('complete',input,operationId,()=>{
        const item=store.get('item:'+input.id);
        if(!item || item.listId!==input.listId)throw Object.assign(new Error('Item unavailable'),{code:'WRITE_REJECTED',reason:'ITEM_UNAVAILABLE'});
        if(revision(item)!==input.expectedRevision)throw Object.assign(new Error('Item changed'),{code:'WRITE_REJECTED',reason:'ITEM_CHANGED'});
        const value={...item,completed:true};store.set('item:'+item.id,value);return value;
      });
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

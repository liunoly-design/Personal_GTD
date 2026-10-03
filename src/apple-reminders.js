import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { openOperationStore } from './operation-store.js';

const binary = fileURLToPath(new URL('../runtime/bin/pgtd-reminders', import.meta.url));
export function callApple(input, { signal, timeoutMs = 15000, helperPath = binary } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath, [], { stdio: ['pipe', 'pipe', 'ignore'], signal });
    let output = ''; let settled = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error('Apple timeout')); }, timeoutMs);
    function finish(error, value) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    }
    child.on('error', () => finish(new Error('Apple bridge unavailable')));
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      output += data.toString();
      if (output.length > 1_000_000) { child.kill(); finish(new Error('Apple response too large')); }
    });
    child.on('close', () => {
      try {
        const response = JSON.parse(output);
        if (!response.ok) {
          const denied = ['PERMISSION_DENIED', 'SOURCE_UNAVAILABLE', 'LIST_UNAVAILABLE', 'ITEM_UNAVAILABLE', 'PAST_TIME', 'INVALID_INPUT', 'ITEM_CHANGED', 'UNSUPPORTED_FIELDS'];
          const reason = denied.includes(response.code) ? response.code : 'APPLE_FAILURE';
          finish(Object.assign(new Error(reason), { code: denied.includes(response.code) ? 'WRITE_REJECTED' : 'RESULT_UNKNOWN', reason }));
        } else finish(null, response.value);
      } catch { finish(new Error('Apple result unknown')); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

export function openAppleReminders({ statePath, sourceId, listId, helperPath, bridge = (input, options) => callApple(input, { ...options, helperPath }) }) {
  if (helperPath !== undefined && !isAbsolute(helperPath)) throw new Error('Absolute Apple helper path required');
  if (typeof sourceId !== 'string' || !sourceId) throw new Error('Apple source ID required');
  const store = openOperationStore(statePath);
  const saved = store.get('binding');
  if (saved && (saved.sourceId !== sourceId || (listId && saved.listId && saved.listId !== listId))) {
    store.close(); throw new Error('Apple binding changed; keep the original operation directory');
  }
  store.set('binding', { ...(saved ?? { sourceId }), ...(listId ? { listId } : {}) });
  function remember(value) {
    if (value?.id && value.listId) store.set('item:' + value.id, { listId: value.listId });
    return value;
  }
  async function write(input, operationId, options) {
    if (!/^[a-f0-9]{64}$/u.test(operationId ?? '')) throw new Error('Operation ID required');
    const request = { ...input, sourceId, operationId };
    const old = store.get('operation:' + operationId);
    if (old && JSON.stringify(old) !== JSON.stringify(request)) throw new Error('Operation conflict');
    // Descriptor is for external reconciliation only, not proof a write succeeded.
    store.set('operation:' + operationId, request);
    return remember(await bridge(request, options));
  }
  return {
    async queryTasks({ limit, offset, listName, keyword }, options) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset < 0 || offset > 4950) {
        throw new Error('Invalid query pagination');
      }
      if (keyword !== undefined && (typeof keyword !== 'string' || !keyword.trim() || [...keyword].length > 200 || /[\x00-\x1f\x7f-\x9f]/u.test(keyword))) throw new Error('Invalid query keyword');
      const filter = keyword !== undefined ? { keyword } : {};
      if (listName !== undefined) {
        if (typeof listName !== 'string' || !listName.trim() || [...listName].length > 200 || /[\r\n\x00-\x1f]/u.test(listName)) throw new Error('Invalid query list name');
        return bridge({ command: 'queryTasks', sourceId, listName, limit, offset, ...filter }, options);
      }
      const binding = store.get('binding');
      const boundId = binding.listId ?? listId;
      if (!boundId) return { state: 'needs_list', candidates: (await bridge({ command: 'lists', sourceId }, options)).lists };
      return bridge({ command: 'queryTasks', sourceId, listId: boundId, limit, offset, ...filter }, options);
    },
    async completeTask({id,listId,expectedRevision,fieldsRevision},operationId,options) {
      const validId=v=>typeof v==='string'&&v.length>0&&v.length<=1024&&!/[\r\n\x00-\x1f]/u.test(v);
      if(!validId(id)||!validId(listId)||![expectedRevision,fieldsRevision,operationId].every(v=>/^[a-f0-9]{64}$/u.test(v??'')))throw new Error('Invalid completion input');
      const request={command:'completeTask',sourceId,operationId,itemId:id,listId,expectedRevision,fieldsRevision};
      const old=store.get('operation:'+operationId);
      if(old&&JSON.stringify(old)!==JSON.stringify(request))throw new Error('Operation conflict');
      store.set('operation:'+operationId,request);
      return bridge(request,options);
    },
    async resolveTaskTarget({name,sourceListId,sourceOnly=false},options) {
      if((!sourceOnly&&(typeof name!=='string'||!name.trim()||[...name].length>200||/[\x00-\x1f]/u.test(name)))
        ||typeof sourceListId!=='string'||!sourceListId||sourceListId.length>1024||/[\x00-\x1f]/u.test(sourceListId))throw new Error('Invalid target input');
      return bridge({command:'resolveTaskTarget',sourceId,listId:sourceListId,...(sourceOnly?{sourceOnly:true}:{listName:name})},options);
    },
    async moveTask({id,listId,targetListId,expectedRevision,contentRevision},operationId,options) {
      if([id,listId,targetListId].some(v=>typeof v!=='string'||!v||v.length>1024||/[\x00-\x1f]/u.test(v))
        ||![expectedRevision,contentRevision,operationId].every(v=>/^[a-f0-9]{64}$/u.test(v??'')))throw new Error('Invalid move input');
      const request={command:'moveTask',sourceId,operationId,itemId:id,listId,targetListId,expectedRevision,contentRevision};
      const old=store.get('operation:'+operationId);
      if(old&&JSON.stringify(old)!==JSON.stringify(request))throw new Error('Operation conflict');
      store.set('operation:'+operationId,request);return bridge(request,options);
    },
    async readTasks({ items }, options) {
      const safeId = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\r\n\x00-\x1f]/u.test(value);
      if (!Array.isArray(items) || items.length < 1 || items.length > 10
        || items.some(item => !safeId(item?.id) || !safeId(item?.listId)) || new Set(items.map(item=>item.id)).size !== items.length) throw new Error('Invalid task references');
      return bridge({ command:'readTasks', sourceId, items:items.map(({id,listId})=>({id,listId})) }, options);
    },
    async listLists(options) {
      const binding = store.get('binding');
      if (binding.listId) {
        const value = await bridge({ command: 'boundList', sourceId, listId: binding.listId }, options);
        return [{ ...value, name: 'Inbox' }];
      }
      return (await bridge({ command: 'lists', sourceId }, options)).lists;
    },
    async createList(name, operationId, options) {
      if (name !== 'Inbox') throw new Error('Only Inbox creation supported');
      const value = await write({ command: 'createList' }, operationId, options);
      store.set('binding', { sourceId, listId: value.id });
      return value;
    },
    async createItem(input, operationId, options) {
      const binding = store.get('binding');
      if (binding.listId && binding.listId !== input.listId) throw new Error('Outside bound list');
      store.set('binding', { sourceId, listId: input.listId });
      return write({ command: 'createItem', ...input }, operationId, options);
    },
    async setReminder(itemId, input, operationId, options) {
      const item = store.get('item:' + itemId);
      if (!item) throw new Error('Unknown PGTD item');
      return write({ command: 'setReminder', itemId, listId: item.listId, ...input }, operationId, options);
    },
    async getItem(itemId, options) {
      const item = store.get('item:' + itemId);
      if (!item) throw new Error('Unknown PGTD item');
      return bridge({ command: 'getItem', sourceId, itemId, listId: item.listId }, options);
    },
    async getOperation(operationId, options) {
      const request = store.get('operation:' + operationId);
      if (!request) return { state: 'unknown' };
      if(request.command==='moveTask') {
        const row=(await bridge({command:'readTasks',sourceId,items:[{id:request.itemId,listId:request.targetListId}]},options)).items?.[0];
        return row?.state==='ok'&&row.value?.id===request.itemId&&row.value.listId===request.targetListId&&row.value.sourceId===sourceId&&row.value.contentRevision===request.contentRevision?{state:'applied',value:row.value}:{state:'unknown'};
      }
      if(request.command==='completeTask') {
        const row=(await bridge({command:'readTasks',sourceId,items:[{id:request.itemId,listId:request.listId}]},options)).items?.[0];
        return row?.state==='ok'&&row.value?.id===request.itemId&&row.value.listId===request.listId&&row.value.sourceId===sourceId&&row.value.completed===true&&row.value.fieldsRevision===request.fieldsRevision ? {state:'applied',value:row.value} : {state:'unknown'};
      }
      if (request.command === 'createList') {
        const lists = (await bridge({ command: 'lists', sourceId }, options)).lists;
        if (lists.length !== 1) return { state: 'unknown' };
        store.set('binding', { sourceId, listId: lists[0].id });
        return { state: 'applied', value: lists[0] };
      }
      const result = await bridge({ ...request, command: request.command === 'createItem' ? 'findCreate' : 'findReminder' }, options);
      if (result.state === 'applied') remember(result.value);
      // EventKit absence does not establish that an interrupted request never applied.
      return result.state === 'applied' ? result : { state: 'unknown' };
    },
    close() { store.close(); },
  };
}

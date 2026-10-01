import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { callNotesScript } from './apple-notes-script.js';

const helper = fileURLToPath(new URL('../native/notes-tags.swift', import.meta.url));
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\n', '<br>');
const snapshot = (id, value) => ({ id, ...value, body: `<div>${escape(value.plaintext.replace(/\n$/, ''))}</div>`,
  tagsComplete: [...value.plaintext.matchAll(/(?<![\p{L}\p{N}_])#(?:O|KR)[0-9]+(?![\p{L}\p{N}_-])/gu)]
    .every(match => value.nativeTags.includes(match[0])) });
let queue = Promise.resolve();

function ui(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/swift', [helper], { detached: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '', oversized = false, timedOut = false;
    const stop = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (Buffer.byteLength(output) > 262144) { oversized = true; stop(); }
    });
    child.on('error', () => { clearTimeout(timer); reject(new Error('BRIDGE_UNAVAILABLE')); });
    child.on('close', () => {
      clearTimeout(timer);
      if (timedOut || oversized) return reject(new Error(timedOut ? 'APPLE_TIMEOUT' : 'RESPONSE_TOO_LARGE'));
      try {
        const response = JSON.parse(output);
        if (!response.ok) {
          const allowed = /^(CONFLICT|PERMISSION_DENIED|ACCESSIBILITY_DENIED|UNSUPPORTED_NOTE|CAPACITY_EXCEEDED|INVALID_INPUT|EDITOR_UNAVAILABLE|UI_FOCUS_CHANGED|AX_SELECTION_FAILED|HEADING_FORMAT_FAILED|TAG_READ_FAILED|TAG_WRITE_FAILED|TAG_DELIMITER_REQUIRED|WRITE_RESULT_UNKNOWN)$/;
          throw new Error(allowed.test(response.code) ? response.code : 'APPLE_RESULT_UNKNOWN');
        }
        resolve(response.value);
      } catch (error) { reject(error instanceof SyntaxError ? new Error('APPLE_RESULT_UNKNOWN') : error); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

// A shared desktop is a single writer. A stale lock is deliberately not reclaimed
// automatically: another process may still be reconciling an uncertain UI write.
async function withDesktop(fn) {
  const path = join(tmpdir(), `pgtd-notes-ui-${process.getuid()}.lock`);
  let lock;
  try { lock = await open(path, 'wx', 0o600); }
  catch { throw new Error('NOTES_UI_BUSY'); }
  try { await lock.writeFile(String(process.pid)); return await fn(); }
  finally { await lock.close(); await unlink(path); }
}

export function createNotesBridge({ script: scriptBridge = callNotesScript, editor = ui } = {}) {
  return async function execute(request, { timeoutMs = 15000 } = {}) {
    if (request.command === 'bind') return scriptBridge(request, { timeoutMs });
    const deadline = Date.now() + timeoutMs;
    const remaining = () => { const n = deadline - Date.now(); if (n <= 0) throw new Error('APPLE_TIMEOUT'); return n; };
    const script = input => scriptBridge(input, { timeoutMs: remaining() });
    const scope = { accountId: request.accountId, folderId: request.folderId };
    async function read(id, command = 'read', extra = {}) {
      let value;
      for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await script({ ...scope, command: 'show', noteId: id });
        try {
          value = await editor({ command, rawPlaintext: raw.plaintext, ...extra }, remaining());
          break;
        } catch (error) {
          // A just-selected editor can lag behind the scripting snapshot.
          // Refresh only reads, under the original deadline; never replay writes.
          if (command !== 'read' || error.message !== 'CONFLICT' || attempt === 1) throw error;
        }
      }
      const result = snapshot(id, value);
      if (command !== 'read' && !result.tagsComplete) throw new Error('TAG_WRITE_INCOMPLETE');
      if (command !== 'read' && result.headingsComplete === false) throw new Error('HEADING_FORMAT_FAILED');
      return result;
    }
    if (request.command === 'find') {
      const found = await script(request);
      const values = [];
      for (const note of found) values.push(await read(note.id));
      return values;
    }
    if (request.command === 'create') {
      const created = await script(request);
      return read(created.id, 'formatCreated', { expectedPlaintext: created.plaintext });
    }
    if (request.command === 'append' && typeof request.addition !== 'string') throw new Error('INVALID_INPUT');
    if (request.command === 'replace' && typeof request.body !== 'string') throw new Error('INVALID_INPUT');
    if (!['read', 'append', 'replace', 'ensureTags'].includes(request.command)) throw new Error('INVALID_INPUT');
    const before = await read(request.noteId);
    if (request.command === 'read') return before;
    if (request.command !== 'ensureTags' && before.body !== request.expectedBody) throw new Error('CONFLICT');
    return read(request.noteId, request.command, { expectedPlaintext: before.plaintext,
      html: request.command === 'append' ? request.addition : request.body,
      preserveTags: request.command === 'replace' ? before.nativeTags.filter(tag => !/^#(?:O|KR)[0-9]+$/.test(tag)) : before.nativeTags });
  };
}
const execute = createNotesBridge();

export function callNotes(request, options) {
  const pending = queue.then(() => withDesktop(() => execute(request, options)));
  queue = pending.catch(() => {});
  return pending;
}

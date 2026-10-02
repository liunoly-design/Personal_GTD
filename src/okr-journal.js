import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync, chmodSync, lstatSync, unlinkSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const hash = text => createHash('sha256').update(text).digest('hex');
const maximum = 16 * 1024 * 1024;
function read(path) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw new Error('JOURNAL_UNAVAILABLE');
    return readFileSync(path, 'utf8');
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function atomic(path, text) {
  if (Buffer.byteLength(text) > maximum) throw new Error('CAPACITY_EXCEEDED');
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temp, text, { mode: 0o600, flag: 'wx' });
    const fd = openSync(temp, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, path);
    const directory = openSync(join(path, '..'), 'r'); try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { try { unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
// Markdown is a private durable record. Expected hashes prevent silently
// recreating a deleted journal or overwriting human edits after a crash.
export function openOkrJournal({ directory, store }) {
  if (!isAbsolute(directory)) throw new Error('INVALID_LOCATION');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  mkdirSync(join(directory, 'archive'), { recursive: true, mode: 0o700 });
  for (const path of [directory, join(directory, 'archive')]) {
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) throw new Error('INVALID_LOCATION');
    chmodSync(path, 0o700);
  }
  const path = join(directory, 'journal.md');
  const recover = () => {
    const pending = store.get('journal-write');
    if (!pending) return;
    const actual = read(path);
    if (hash(actual ?? '') === pending.beforeHash) atomic(path, pending.text);
    else if (hash(actual ?? '') !== pending.afterHash) throw new Error('CONFLICT');
    store.transaction(() => { store.set('journal-hash', pending.afterHash); store.set('journal-write', null); });
  };
  return {
    path,
    append(marker, text) {
      recover();
      const current = read(path);
      const known = store.get('journal-hash');
      if (known && (current === null || hash(current) !== known)) throw new Error('CONFLICT');
      if (!known && current !== null) throw new Error('CONFLICT');
      if (current?.includes(`<!-- ${marker} -->`)) return;
      const target = (current ?? '# OKR 讨论完整记录\n') + `\n<!-- ${marker} -->\n${text}\n`;
      if (Buffer.byteLength(target) > maximum) throw new Error('CAPACITY_EXCEEDED');
      store.set('journal-write', { beforeHash: hash(current ?? ''), afterHash: hash(target), text: target });
      recover();
    },
    archive(id, text) {
      const path = join(directory, 'archive', hash(id) + '.md');
      const existing = read(path);
      if (existing !== null && existing !== text) throw new Error('CONFLICT');
      if (existing === null) atomic(path, text);
      return path;
    },
    recent() {
      recover();
      const current = read(path), known = store.get('journal-hash');
      if (!known || current === null || hash(current) !== known) throw new Error('CONFLICT');
      return { text: current.slice(-3000), truncated: current.length > 3000 };
    },
    verify() {
      recover();
      const current = read(path), known = store.get('journal-hash');
      if (!known || current === null || hash(current) !== known) throw new Error('CONFLICT');
    },
  };
}

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, closeSync, openSync } from 'node:fs';
import { dirname } from 'node:path';

// Private local operation data. Not a second source of task completion state.
export function openOperationStore(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  closeSync(openSync(path, 'a', 0o600));
  chmodSync(path, 0o600);
  const db = new DatabaseSync(path, { timeout: 1000 });
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const get = db.prepare('SELECT value FROM records WHERE key = ?');
  const set = db.prepare('INSERT INTO records VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  return {
    get(key) { const row = get.get(key); return row ? JSON.parse(row.value) : undefined; },
    set(key, value) { set.run(key, JSON.stringify(value)); },
    entries(prefix) {
      return db.prepare('SELECT key, value FROM records WHERE substr(key, 1, ?) = ? ORDER BY rowid')
        .all(prefix.length, prefix).map(row => [row.key, JSON.parse(row.value)]);
    },
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const result = fn(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close() { db.close(); },
  };
}

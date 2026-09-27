import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'pgtd-recovery-demo-'));
const started = performance.now();
try {
  const crash = spawnSync(process.execPath, ['examples/recovery-worker.js', dir, 'crash'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(crash.signal, 'SIGKILL');
  const recovery = spawnSync(process.execPath, ['examples/recovery-worker.js', dir, 'recover'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(recovery.status, 0);
  const result = JSON.parse(recovery.stdout);
  assert.equal(result.items, 1);
  assert.equal(result.receipts, 1);
  assert.equal(result.results[0].delivery, 'sent');
  console.log(JSON.stringify({ mode: 'simulation', crash: crash.signal, items: result.items,
    receipts: result.receipts, recovered: result.results[0].status, elapsedMs: Math.round(performance.now() - started) }));
} finally { rmSync(dir, { recursive: true, force: true }); }

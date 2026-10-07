import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doplFixture } from './review-dopl-fixture.js';

const directory = mkdtempSync(join(tmpdir(), 'pgtd-command-help-'));
const f = doplFixture(directory);
try {
  const start = performance.now();
  const menus = [];
  for (const [i, text] of ['小婕 帮助', '小婕 gtd', '小婕 okr 帮助', '小婕 review', '小婕 gtd okr help'].entries()) {
    const result = await f.send('om_menu_' + i, text);
    assert.equal(result.status, 'commands_help');
    assert.equal(result.delivery, 'sent');
    assert.equal(result.modelCalls, 0);
    assert.ok([...result.receipt].length <= 4000);
    menus.push({ text, module: result.module, chars: [...result.receipt].length });
  }
  const sends = f.sent.length;
  await f.restart();
  await f.send('om_menu_0', '小婕 帮助');
  assert.equal(f.sent.length, sends);
  assert.equal(f.operations.length, 0);
  assert.equal(f.notes.length, 0);
  assert.equal((await f.recover()).length, 0);
  console.log(JSON.stringify({ mode: 'simulation', menus, processes: 1, restarts: 1,
    modelCalls: 0, businessAdapterCalls: 0, liveWrites: 0, elapsedMs: Math.round(performance.now() - start) }));
} finally { await f.close(); rmSync(directory, { recursive: true, force: true }); }

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('CLI 从本地配置激活，逐条输出回执和模拟条目，重启读取配置', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pgtd-test-'));
  try {
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify({ activation: '收件助手' }));
    const input = ['小婕 GTD，收集：旧词', '收件助手，收集：新词'].map((text, i) => JSON.stringify({
      id: `cli-${i}`, senderId: 'demo-user', conversationId: 'demo-chat',
      sentAt: '2026-09-27T10:00:00+08:00', type: 'text', text,
    })).join('\n');
    const run = spawnSync(process.execPath, ['src/cli.js', '--config', path], { input, encoding: 'utf8', timeout: 5000 });
    assert.equal(run.status, 0, run.stderr);
    const outputs = run.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(outputs[0].result.status, 'not_handled');
    assert.equal(outputs[1].result.status, 'collected');
    assert.equal(outputs[1].mode, 'simulation');
    assert.equal(outputs[1].item.title, '新词');
    assert.equal(outputs[1].item.id, outputs[1].result.itemId);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

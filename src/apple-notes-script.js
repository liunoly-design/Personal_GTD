import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../native/notes.js', import.meta.url));
export function callNotesScript(request, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/osascript', ['-l', 'JavaScript', script], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    let settled = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('APPLE_TIMEOUT')); }, timeoutMs);
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    }
    child.on('error', () => finish(new Error('BRIDGE_UNAVAILABLE')));
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (Buffer.byteLength(output) > 262144) { child.kill('SIGKILL'); finish(new Error('RESPONSE_TOO_LARGE')); }
    });
    child.on('close', () => {
      try {
        const result = JSON.parse(output);
        const codes = ['LOCATION_NOT_UNIQUE', 'UNSUPPORTED_NOTE', 'UNSUPPORTED_FOLDER', 'CAPACITY_EXCEEDED', 'CONFLICT', 'INVALID_INPUT', 'PERMISSION_DENIED'];
        if (!result.ok) finish(new Error(codes.includes(result.code) ? result.code : 'APPLE_RESULT_UNKNOWN'));
        else finish(null, result.value);
      } catch { finish(new Error('APPLE_RESULT_UNKNOWN')); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

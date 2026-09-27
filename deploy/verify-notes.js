import { parseArgs } from 'node:util';
import { verifyNotes } from '../src/notes-probe.js';
import { callNotes } from '../src/apple-notes.js';

try {
  const { values } = parseArgs({ options: {
    'write-synthetic': { type: 'boolean' }, account: { type: 'string' }, folder: { type: 'string' },
    'state-path': { type: 'string', default: 'runtime/notes/probe.sqlite' },
  } });
  if (!values['write-synthetic']) throw new Error('WRITE_OPT_IN_REQUIRED');
  const result = await verifyNotes({ statePath: values['state-path'], account: values.account, folder: values.folder, bridge: callNotes });
  console.log(JSON.stringify({ mode: 'real-apple-notes', ...result }));
} catch (error) {
  const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'PROBE_FAILED';
  console.error(JSON.stringify({ status: 'stopped', code }));
  process.exitCode = 1;
}

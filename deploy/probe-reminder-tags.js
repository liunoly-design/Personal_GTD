import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Static interface inventory only: never opens an Apple event store or runs a shortcut.
const run = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 262144 });
try {
  if (process.platform !== 'darwin') throw new Error('MACOS_REQUIRED');
  const sdk = run('/usr/bin/xcrun', ['--show-sdk-path']).trim();
  const headers = join(sdk, 'System/Library/Frameworks/EventKit.framework/Headers');
  const paths = [
    ...['EKReminder.h', 'EKCalendarItem.h', 'EKObject.h', 'EKEventStore.h'].map(name => join(headers, name)),
    '/System/Applications/Reminders.app/Contents/Resources/Reminders.sdef',
    '/System/Applications/Notes.app/Contents/Resources/Notes.sdef',
  ];
  const sources = paths.map(path => {
    const bytes = readFileSync(path);
    if (bytes.length > 1048576) throw new Error('SOURCE_TOO_LARGE');
    const content = bytes.toString('utf8');
    const declarations = path.endsWith('.sdef')
      ? [...content.matchAll(/<(?:property|element|class|command)\b[^>]*>/gu)].map(m => m[0])
      : content.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '').split('\n').map(line => line.trim()).filter(Boolean);
    return { path, sha256: createHash('sha256').update(bytes).digest('hex'),
      tagDeclarations: declarations.filter(line => /tag|categor/iu.test(line)),
      ...(path.endsWith('.sdef') ? { properties: [...content.matchAll(/<property\s+name="([^"]+)"/gu)].map(m => m[1]) } : {}),
    };
  });
  const help = run('/usr/bin/shortcuts', ['--help']);
  console.log(JSON.stringify({ feature: 'F102', status: 'inventory_complete',
    macOS: run('/usr/bin/sw_vers', ['-productVersion']).trim(), sdk, sources,
    shortcutsHelp: help.trim(), liveTagVerification: 'not_run', appleDataReads: 0, appleWrites: 0, modelCalls: 0,
    conclusion: 'Static declarations are evidence only. Native tag write/read/query and object identity require a separate real Shortcuts verification.',
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ feature: 'F102', status: 'inventory_failed',
    code: /^[A-Z_]+$/u.test(error.message) ? error.message : 'SOURCE_OR_TOOL_UNAVAILABLE', liveTagVerification: 'not_run' }));
  process.exitCode = 1;
}

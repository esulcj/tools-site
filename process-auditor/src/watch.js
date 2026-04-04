import { watch as fsWatch, readdirSync, statSync, appendFileSync, mkdirSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { SESSIONS_DIR, VIOLATIONS_PATH } from './constants.js';
import { analyzeSession } from './analyzer.js';

export async function watch({ logPath } = {}) {
  const latest = getLatestSession();
  if (!latest) {
    console.error('No active session found.');
    process.exit(1);
  }

  console.log(`Watching: ${latest}`);
  console.log('Press Ctrl+C to stop.\n');

  let lastSize = statSync(latest).size;
  let scanTimeout = null;

  const doScan = async () => {
    try {
      const violations = await analyzeSession(latest);
      if (violations.length > 0) {
        mkdirSync(dirname(VIOLATIONS_PATH), { recursive: true });
        for (const v of violations) {
          const line = `[${new Date().toISOString()}] [${v.severity}] ${v.rule}: ${v.description}`;
          if (logPath) {
            appendFileSync(logPath, line + '\n');
          } else {
            console.log(line);
          }
          appendFileSync(VIOLATIONS_PATH, JSON.stringify(v) + '\n');
        }
      }
    } catch (err) {
      console.error('Scan error:', err.message);
    }
  };

  // Initial scan
  await doScan();

  // Watch for changes
  const watcher = fsWatch(latest, () => {
    // Debounce: re-scan 500ms after last change
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(doScan, 500);
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    watcher.close();
    console.log('\nStopped watching.');
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

function getLatestSession() {
  try {
    const files = readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ path: join(SESSIONS_DIR, f), mtime: statSync(join(SESSIONS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files[0]?.path || null;
  } catch {
    return null;
  }
}

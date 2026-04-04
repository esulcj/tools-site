import { readdirSync, statSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { SESSIONS_DIR, VIOLATIONS_PATH } from './constants.js';
import { analyzeSession } from './analyzer.js';

export async function scan({ sessionPath, all, json = false } = {}) {
  const files = getSessionFiles({ sessionPath, all });

  if (files.length === 0) {
    console.error('No session files found.');
    process.exit(1);
  }

  let allViolations = [];

  for (const file of files) {
    try {
      const violations = await analyzeSession(file);
      allViolations.push(...violations);
    } catch (err) {
      if (!json) console.error(`Error scanning ${file}: ${err.message}`);
    }
  }

  // Persist violations
  if (allViolations.length > 0) {
    mkdirSync(dirname(VIOLATIONS_PATH), { recursive: true });
    for (const v of allViolations) {
      appendFileSync(VIOLATIONS_PATH, JSON.stringify(v) + '\n');
    }
  }

  // Output
  if (json) {
    console.log(JSON.stringify({ sessionsScanned: files.length, violations: allViolations }, null, 2));
  } else {
    console.log(`\nScanned ${files.length} session(s)\n`);
    if (allViolations.length === 0) {
      console.log('✅ No violations found.');
    } else {
      console.log(`⚠️  ${allViolations.length} violation(s) found:\n`);
      const grouped = groupBy(allViolations, 'rule');
      for (const [rule, items] of Object.entries(grouped)) {
        console.log(`[${items[0].severity}] ${rule} — ${items.length} violation(s)`);
        for (const v of items.slice(0, 5)) {
          console.log(`  • ${v.description}`);
          if (v.evidence) console.log(`    Evidence: ${v.evidence.substring(0, 120)}...`);
        }
        if (items.length > 5) console.log(`  ... and ${items.length - 5} more`);
        console.log();
      }
    }
  }
}

function getSessionFiles({ sessionPath, all }) {
  if (sessionPath) return [sessionPath];

  try {
    const files = readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => join(SESSIONS_DIR, f));

    if (all) return files;

    // Default: most recent session
    return files
      .map(f => ({ path: f, mtime: statSync(f).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 1)
      .map(f => f.path);
  } catch {
    return [];
  }
}

function groupBy(arr, key) {
  const result = {};
  for (const item of arr) {
    (result[item[key]] ||= []).push(item);
  }
  return result;
}

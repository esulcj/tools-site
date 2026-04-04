#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { CONFIG_PATH } from '../lib/config.js';
import { loadConfig, readJSON, readHistory, listBackups, hashJSON, storeHash, red, green, yellow, cyan, bold, dim } from '../lib/utils.js';
import { validateConfig, printValidation } from '../lib/validate.js';
import { previewPatch, printDiff, computeDiff } from '../lib/diff.js';
import { applyPatch } from '../lib/apply.js';
import { rollback } from '../lib/rollback.js';
import { watchConfig } from '../lib/watch.js';

const args = process.argv.slice(2);
const command = args[0];
const jsonMode = args.includes('--json');
const dryRun = args.includes('--dry-run');
const positionalArgs = args.filter(a => !a.startsWith('--'));

function usage() {
  console.log(`
${bold('config-guardian')} — Safe OpenClaw config management

${bold('Commands:')}
  ${cyan('validate')} [file]          Deep-validate config (default: live config)
  ${cyan('diff')} <patch.json>        Preview what a patch would change
  ${cyan('apply')} <patch.json>       Validate, backup, and apply a patch
  ${cyan('rollback')} [backup.json]   Restore from latest (or specified) backup
  ${cyan('history')} [--limit N]      Show recent config changes
  ${cyan('watch')} [--interval N]     Monitor for config drift
  ${cyan('backups')}                  List available backups
  ${cyan('hash')}                    Show/update config hash baseline

${bold('Flags:')}
  --json        Machine-readable JSON output
  --dry-run     Preview apply without writing (use with apply)
  --limit N     Limit history entries (default: 20)
  --interval N  Watch poll interval in ms (default: 5000)

${bold('Exit codes:')}
  0 = success, 1 = validation failure, 2 = application failure
`);
}

function loadPatch(path) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    console.error(red(`File not found: ${resolved}`));
    process.exit(2);
  }
  try {
    return readJSON(resolved);
  } catch (e) {
    console.error(red(`Invalid JSON in ${resolved}: ${e.message}`));
    process.exit(1);
  }
}

async function main() {
  switch (command) {
    case 'validate': {
      const file = positionalArgs[1] ? resolve(positionalArgs[1]) : CONFIG_PATH;
      let config;
      try {
        config = readJSON(file);
      } catch (e) {
        console.error(red(`Cannot read ${file}: ${e.message}`));
        process.exit(1);
      }
      const opts = {};
      // If validating a different file, compare against live config
      if (file !== CONFIG_PATH && existsSync(CONFIG_PATH)) {
        try { opts.currentConfig = loadConfig(); } catch {}
      }
      const result = validateConfig(config, opts);
      printValidation(result, jsonMode);
      process.exit(result.ok ? 0 : 1);
    }

    case 'diff': {
      if (!positionalArgs[1]) {
        console.error(red('Usage: config-guardian diff <patch.json>'));
        process.exit(2);
      }
      const patch = loadPatch(positionalArgs[1]);
      let current;
      try { current = loadConfig(); } catch (e) {
        console.error(red(`Cannot read live config: ${e.message}`));
        process.exit(2);
      }
      const changes = previewPatch(current, patch);
      if (!jsonMode) console.log(bold('\n📋 Patch preview:'));
      printDiff(changes, jsonMode);
      process.exit(0);
    }

    case 'apply': {
      if (!positionalArgs[1]) {
        console.error(red('Usage: config-guardian apply <patch.json>'));
        process.exit(2);
      }
      const patch = loadPatch(positionalArgs[1]);
      const result = await applyPatch(patch, { jsonMode, dryRun, skipHealth: dryRun });
      process.exit(result.ok ? 0 : (result.errors?.length ? 1 : 2));
    }

    case 'rollback': {
      const target = positionalArgs[1] ? resolve(positionalArgs[1]) : null;
      const ok = rollback({ jsonMode, target });
      process.exit(ok ? 0 : 2);
    }

    case 'history': {
      const limitIdx = args.indexOf('--limit');
      const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 20 : 20;
      const entries = readHistory(limit);

      if (jsonMode) {
        console.log(JSON.stringify(entries, null, 2));
      } else {
        if (entries.length === 0) {
          console.log(dim('\n  No history entries yet.\n'));
        } else {
          console.log(bold(`\n📜 Last ${entries.length} config changes:\n`));
          for (const e of entries) {
            const ts = dim(e.timestamp);
            const action = e.action === 'rollback' ? yellow('rollback') : cyan(e.action);
            console.log(`  ${ts}  ${action}`);
            if (e.changes) {
              for (const c of e.changes.slice(0, 5)) {
                const symbol = c.type === 'added' ? green('+') : c.type === 'removed' ? red('-') : yellow('~');
                console.log(`    ${symbol} ${c.path}`);
              }
              if (e.changes.length > 5) console.log(dim(`    ... and ${e.changes.length - 5} more`));
            }
            if (e.backup) console.log(dim(`    backup: ${e.backup}`));
          }
          console.log('');
        }
      }
      process.exit(0);
    }

    case 'backups': {
      const backups = listBackups();
      if (jsonMode) {
        console.log(JSON.stringify(backups, null, 2));
      } else {
        if (backups.length === 0) {
          console.log(dim('\n  No backups found.\n'));
        } else {
          console.log(bold(`\n📦 ${backups.length} backup(s):\n`));
          for (const b of backups) {
            console.log(`  ${dim(b.time.toISOString())}  ${b.file}`);
          }
          console.log('');
        }
      }
      process.exit(0);
    }

    case 'hash': {
      try {
        const config = loadConfig();
        const hash = hashJSON(config);
        storeHash(hash);
        if (jsonMode) {
          console.log(JSON.stringify({ hash, path: CONFIG_PATH }));
        } else {
          console.log(green(`\n  Hash baseline set: ${hash.slice(0, 16)}...\n`));
        }
      } catch (e) {
        console.error(red(`Cannot read config: ${e.message}`));
        process.exit(2);
      }
      process.exit(0);
    }

    case 'watch': {
      const intIdx = args.indexOf('--interval');
      const interval = intIdx >= 0 ? parseInt(args[intIdx + 1]) || 5000 : 5000;
      watchConfig({ jsonMode, interval });
      break; // Don't exit — watch is persistent
    }

    case 'help':
    case '--help':
    case '-h':
    case undefined:
      usage();
      process.exit(0);

    default:
      console.error(red(`Unknown command: ${command}`));
      usage();
      process.exit(2);
  }
}

main().catch(e => {
  console.error(red(`Fatal: ${e.message}`));
  process.exit(2);
});

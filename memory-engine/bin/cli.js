#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { status } from '../lib/status.js';
import { scan } from '../lib/scan.js';
import { distill } from '../lib/distill.js';
import { prune } from '../lib/prune.js';
import { search } from '../lib/search.js';
import { buildIndex } from '../lib/index-builder.js';

const USAGE = `memory-engine — structured memory management for OpenClaw

Commands:
  status              Overview of memory files, sizes, staleness
  scan                Analyze for duplicates, stale entries, contradictions, orphans
  distill [--dry-run] Extract insights from daily files into MEMORY.md
  prune [--dry-run]   Trim MEMORY.md (dedup, consolidate, compress)
  search <query>      Search all memory files with relevance scoring
  index               Build/rebuild the fact index

Options:
  --json              Output as JSON
  --dry-run           Preview changes without modifying files
  --help              Show this help`;

const command = process.argv[2];
if (!command || command === '--help' || command === '-h') {
  console.log(USAGE);
  process.exit(0);
}

const args = process.argv.slice(3);
const { values: flags } = parseArgs({
  args,
  options: {
    json: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: true,
  strict: false,
});

const positionals = args.filter(a => !a.startsWith('--'));
const jsonMode = flags.json;
const dryRun = flags['dry-run'];

function output(data) {
  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2));
  } else if (typeof data === 'string') {
    console.log(data);
  } else {
    console.log(data);
  }
}

try {
  switch (command) {
    case 'status':
      output(await status({ jsonMode }));
      break;
    case 'scan':
      output(await scan({ jsonMode }));
      break;
    case 'distill':
      output(await distill({ dryRun, jsonMode }));
      break;
    case 'prune':
      output(await prune({ dryRun, jsonMode }));
      break;
    case 'search':
      if (!positionals.length) {
        console.error('Usage: memory-engine search <query>');
        process.exit(1);
      }
      output(await search(positionals.join(' '), { jsonMode }));
      break;
    case 'index':
      output(await buildIndex({ jsonMode }));
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      process.exit(1);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
}

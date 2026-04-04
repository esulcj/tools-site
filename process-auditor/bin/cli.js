#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { scan } from '../src/scan.js';
import { report } from '../src/report.js';
import { watch } from '../src/watch.js';
import { listRules } from '../src/rules.js';

const command = process.argv[2];
const rest = process.argv.slice(3);

function usage() {
  console.log(`process-auditor — Agent process compliance checker

Commands:
  scan [--session <path>] [--all] [--json]   Scan session(s) for violations
  report [--days N] [--json]                 Aggregate violation stats
  watch [--log <path>]                       Tail active session, flag violations
  rules [--json]                             List enforced process gates

Options:
  --json    Output in JSON format
  --help    Show this help`);
}

async function main() {
  if (!command || command === '--help' || command === '-h') {
    usage();
    process.exit(0);
  }

  const jsonFlag = rest.includes('--json');

  switch (command) {
    case 'scan': {
      const sessionIdx = rest.indexOf('--session');
      const sessionPath = sessionIdx !== -1 ? rest[sessionIdx + 1] : null;
      const all = rest.includes('--all');
      await scan({ sessionPath, all, json: jsonFlag });
      break;
    }
    case 'report': {
      const daysIdx = rest.indexOf('--days');
      const days = daysIdx !== -1 ? parseInt(rest[daysIdx + 1], 10) : 7;
      await report({ days, json: jsonFlag });
      break;
    }
    case 'watch': {
      const logIdx = rest.indexOf('--log');
      const logPath = logIdx !== -1 ? rest[logIdx + 1] : null;
      await watch({ logPath });
      break;
    }
    case 'rules': {
      listRules({ json: jsonFlag });
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      usage();
      process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});

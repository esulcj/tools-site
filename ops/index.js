#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, renameSync, unlinkSync, rmdirSync, copyFileSync } from 'fs';
import { resolve, join, basename, dirname } from 'path';
import { execSync } from 'child_process';
import { homedir } from 'os';

const HOME = homedir();
const OC_DIR = join(HOME, '.openclaw');
const CONFIG_PATH = join(OC_DIR, 'openclaw.json');
const AGENTS_DIR = join(OC_DIR, 'agents');
const LOGS_DIR = join(OC_DIR, 'logs');
const BACKUPS_DIR = join(OC_DIR, 'backups');
const WORKSPACE = join(HOME, '.openclaw', 'workspace');

const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];
const flags = new Set(args.filter(a => a.startsWith('--')));
const positional = args.filter(a => !a.startsWith('--'));
const jsonMode = flags.has('--json');

// Colors
const bold = s => `\x1b[1m${s}\x1b[0m`;
const red = s => `\x1b[31m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const cyan = s => `\x1b[36m${s}\x1b[0m`;
const dim = s => `\x1b[2m${s}\x1b[0m`;

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function dirSize(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) total += dirSize(p);
      else try { total += statSync(p).size; } catch {}
    }
  } catch {}
  return total;
}

function findSessionFiles() {
  const files = [];
  if (!existsSync(AGENTS_DIR)) return files;
  for (const agent of readdirSync(AGENTS_DIR)) {
    const sessDir = join(AGENTS_DIR, agent, 'sessions');
    if (!existsSync(sessDir)) continue;
    try {
      for (const f of readdirSync(sessDir)) {
        if (f.endsWith('.jsonl')) {
          files.push({ path: join(sessDir, f), agent, key: f.replace('.jsonl', '') });
        }
      }
    } catch {}
  }
  return files;
}

function lineCount(filePath) {
  try {
    return execSync(`wc -l < "${filePath}"`, { encoding: 'utf8' }).trim();
  } catch { return '?'; }
}

function timestamp() {
  const d = new Date();
  return d.toISOString().replace(/[-:T]/g, (m) => m === 'T' ? '-' : m === ':' ? '' : m).slice(0, 17).replace(/\.\d+Z/, '');
}

function backupTimestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// ─── HEALTH ───

function cmdHealth() {
  const quick = flags.has('--quick');
  const checks = [];

  // 1. Gateway running
  let gwRunning = false;
  try {
    const out = execSync('pgrep -f "openclaw" 2>/dev/null', { encoding: 'utf8' }).trim();
    gwRunning = out.length > 0;
  } catch { gwRunning = false; }
  checks.push({ name: 'Gateway', status: gwRunning ? 'ok' : 'warn', detail: gwRunning ? 'running' : 'not detected' });

  // 4. Config valid
  let configOk = false;
  let configDetail = '';
  try {
    JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    configOk = true;
    configDetail = 'valid JSON';
  } catch (e) {
    configDetail = existsSync(CONFIG_PATH) ? `parse error: ${e.message}` : 'file not found';
  }
  checks.push({ name: 'Config', status: configOk ? 'ok' : 'fail', detail: configDetail });

  // 5. Sessions
  const sessions = findSessionFiles();
  const bloated = sessions.filter(s => { try { return statSync(s.path).size > 100 * 1024; } catch { return false; } });
  checks.push({ name: 'Sessions', status: bloated.length > 0 ? 'warn' : 'ok', detail: `${sessions.length} active, ${bloated.length} bloated (>100KB)` });

  if (!quick) {
    // 2. Node version
    let nodeVer = '';
    try { nodeVer = execSync('node --version', { encoding: 'utf8' }).trim(); } catch {}
    const major = parseInt(nodeVer.replace('v', ''));
    checks.push({ name: 'Node.js', status: major >= 20 ? 'ok' : 'warn', detail: nodeVer || 'not found' });

    // 3. Disk space
    let diskDetail = '';
    let diskStatus = 'ok';
    try {
      const df = execSync('df -h /', { encoding: 'utf8' });
      const lines = df.trim().split('\n');
      if (lines[1]) {
        const parts = lines[1].split(/\s+/);
        const usePct = parseInt(parts[4]);
        diskDetail = `${parts[3]} available (${parts[4]} used)`;
        if (usePct > 90) diskStatus = 'warn';
      }
    } catch { diskDetail = 'unable to check'; diskStatus = 'warn'; }
    checks.push({ name: 'Disk', status: diskStatus, detail: diskDetail });

    // 6. Log size
    const logBytes = dirSize(LOGS_DIR);
    checks.push({ name: 'Logs', status: logBytes > 500 * 1024 * 1024 ? 'warn' : 'ok', detail: humanSize(logBytes) });
  }

  if (jsonMode) {
    console.log(JSON.stringify({ checks }, null, 2));
  } else {
    console.log(bold('\n🏥 Health Check') + (quick ? dim(' (quick)') : '') + '\n');
    for (const c of checks) {
      const icon = c.status === 'ok' ? green('✓') : c.status === 'warn' ? yellow('⚠') : red('✗');
      console.log(`  ${icon} ${bold(c.name)}: ${c.detail}`);
    }
    console.log();
  }
}

// ─── BACKUP ───

function cmdBackup() {
  if (subcommand === 'list') return cmdBackupList();
  if (subcommand === 'restore') return cmdBackupRestore();

  const full = flags.has('--full');
  const ts = backupTimestamp();
  const backupDir = join(BACKUPS_DIR, ts);
  mkdirSync(backupDir, { recursive: true });

  // Always backup config
  if (existsSync(CONFIG_PATH)) {
    copyFileSync(CONFIG_PATH, join(backupDir, 'openclaw.json'));
  }

  // Backup workspace config files
  const wsConfigs = ['AGENTS.md', 'SOUL.md', 'USER.md', 'IDENTITY.md', 'TOOLS.md', 'MEMORY.md', 'ASSETS.md', 'HEARTBEAT.md'];
  const wsBackupDir = join(backupDir, 'workspace');
  mkdirSync(wsBackupDir, { recursive: true });
  for (const f of wsConfigs) {
    const src = join(WORKSPACE, f);
    if (existsSync(src)) copyFileSync(src, join(wsBackupDir, f));
  }

  if (full) {
    // Copy entire workspace
    try { execSync(`cp -a "${WORKSPACE}" "${join(backupDir, 'workspace-full')}"`, { stdio: 'pipe' }); } catch {}
    // Copy sessions
    if (existsSync(AGENTS_DIR)) {
      try { execSync(`cp -a "${AGENTS_DIR}" "${join(backupDir, 'agents')}"`, { stdio: 'pipe' }); } catch {}
    }
  }

  const size = dirSize(backupDir);
  if (jsonMode) {
    console.log(JSON.stringify({ path: backupDir, size: humanSize(size), full }));
  } else {
    console.log(`\n${green('✓')} Backup created: ${cyan(backupDir)}`);
    console.log(`  Size: ${humanSize(size)}${full ? ' (full)' : ''}\n`);
  }
}

function cmdBackupList() {
  if (!existsSync(BACKUPS_DIR)) {
    console.log(jsonMode ? '[]' : 'No backups found.');
    return;
  }
  const entries = readdirSync(BACKUPS_DIR)
    .filter(d => { try { return statSync(join(BACKUPS_DIR, d)).isDirectory(); } catch { return false; } })
    .sort().reverse()
    .map(d => ({ id: d, path: join(BACKUPS_DIR, d), size: humanSize(dirSize(join(BACKUPS_DIR, d))) }));

  if (jsonMode) { console.log(JSON.stringify(entries, null, 2)); return; }
  if (entries.length === 0) { console.log('No backups found.'); return; }
  console.log(bold('\n📦 Backups\n'));
  for (const e of entries) {
    console.log(`  ${cyan(e.id)}  ${dim(e.size)}`);
  }
  console.log();
}

function cmdBackupRestore() {
  const id = positional[2];
  if (!id) { console.error('Usage: ops backup restore <id> [--confirm]'); process.exit(1); }
  const backupDir = join(BACKUPS_DIR, id);
  if (!existsSync(backupDir)) { console.error(`Backup not found: ${id}`); process.exit(1); }

  const configSrc = join(backupDir, 'openclaw.json');
  const wsSrc = join(backupDir, 'workspace');
  const toRestore = [];
  if (existsSync(configSrc)) toRestore.push({ from: configSrc, to: CONFIG_PATH });
  if (existsSync(wsSrc)) {
    for (const f of readdirSync(wsSrc)) {
      toRestore.push({ from: join(wsSrc, f), to: join(WORKSPACE, f) });
    }
  }

  if (!flags.has('--confirm')) {
    console.log(bold('\n🔄 Would restore:\n'));
    for (const r of toRestore) console.log(`  ${r.from} → ${r.to}`);
    console.log(yellow('\n  Add --confirm to actually restore.\n'));
    return;
  }

  for (const r of toRestore) copyFileSync(r.from, r.to);
  console.log(green(`\n✓ Restored ${toRestore.length} files from ${id}\n`));
}

// ─── SESSIONS ───

function cmdSessions() {
  if (subcommand === 'rotate') return cmdSessionRotate();

  const sessions = findSessionFiles().map(s => {
    let size = 0, mtime = null;
    try { const st = statSync(s.path); size = st.size; mtime = st.mtime; } catch {}
    return { ...s, size, sizeHuman: humanSize(size), mtime, lines: lineCount(s.path), bloated: size > 100 * 1024 };
  });

  if (jsonMode) { console.log(JSON.stringify(sessions, null, 2)); return; }
  console.log(bold(`\n📋 Sessions (${sessions.length})\n`));
  for (const s of sessions) {
    const flag = s.bloated ? red(' [BLOATED]') : '';
    const modified = s.mtime ? dim(` (${s.mtime.toISOString().slice(0, 16).replace('T', ' ')})`) : '';
    console.log(`  ${s.agent}/${cyan(s.key)}  ${s.sizeHuman}  ${dim(s.lines + ' lines')}${modified}${flag}`);
  }
  console.log();
}

function cmdSessionRotate() {
  const keyOrPath = positional[2];
  if (!keyOrPath) { console.error('Usage: ops sessions rotate <key-or-path>'); process.exit(1); }

  // Find the session
  const sessions = findSessionFiles();
  const match = sessions.find(s => s.key === keyOrPath || s.path === keyOrPath);
  if (!match) { console.error(`Session not found: ${keyOrPath}`); process.exit(1); }

  const content = readFileSync(match.path, 'utf8');
  const lines = content.trim().split('\n');
  const summary = lines.slice(-5).join('\n');

  const archiveDir = join(dirname(match.path), 'archive');
  mkdirSync(archiveDir, { recursive: true });
  const archiveName = `${backupTimestamp()}-${match.key}.jsonl`;
  const archivePath = join(archiveDir, archiveName);

  renameSync(match.path, archivePath);
  writeFileSync(match.path, summary + '\n');

  console.log(green(`\n✓ Rotated ${match.key}`));
  console.log(`  Archived: ${archivePath} (${lines.length} lines)`);
  console.log(`  New file: ${match.path} (5 lines summary)\n`);
}

// ─── QUEUE ───

function cmdQueue() {
  if (subcommand === 'drain') return cmdQueueDrain();
  const queuePath = join(WORKSPACE, 'task-queue.json');
  if (!existsSync(queuePath)) { console.log(jsonMode ? '{"error":"no queue file found"}' : 'No queue file found.'); return; }
  try {
    const tasks = JSON.parse(readFileSync(queuePath, 'utf8'));
    if (jsonMode) { console.log(JSON.stringify(tasks, null, 2)); return; }
    const items = Array.isArray(tasks) ? tasks : tasks.tasks || [];
    console.log(bold(`\n📝 Task Queue (${items.length})\n`));
    for (const t of items) {
      console.log(`  • ${t.task || t.description || JSON.stringify(t)}`);
    }
    console.log();
  } catch (e) { console.error(`Error reading queue: ${e.message}`); }
}

function cmdQueueDrain() {
  const queuePath = join(WORKSPACE, 'task-queue.json');
  if (!existsSync(queuePath)) { console.log('No queue file found.'); return; }
  try {
    const tasks = JSON.parse(readFileSync(queuePath, 'utf8'));
    const items = Array.isArray(tasks) ? tasks : tasks.tasks || [];
    console.log(bold(`\n🚀 Drain Plan (${items.length} tasks)\n`));
    for (const t of items) {
      const task = t.task || t.description || JSON.stringify(t);
      const model = t.model || 'opus';
      console.log(`  sessions_spawn { task: "${task}", model: "${model}" }`);
    }
    console.log();
  } catch (e) { console.error(`Error: ${e.message}`); }
}

// ─── DISK ───

function cmdDisk() {
  if (subcommand === 'clean') return cmdDiskClean();

  const totals = [
    { name: '~/.openclaw/ (total)', size: dirSize(OC_DIR) },
    { name: 'Sessions', size: 0 },
    { name: 'Logs', size: dirSize(LOGS_DIR) },
    { name: 'Workspace', size: dirSize(WORKSPACE) },
    { name: 'Backups', size: dirSize(BACKUPS_DIR) },
  ];

  // Sessions across all agents
  if (existsSync(AGENTS_DIR)) {
    for (const agent of readdirSync(AGENTS_DIR)) {
      const sd = join(AGENTS_DIR, agent, 'sessions');
      if (existsSync(sd)) totals[1].size += dirSize(sd);
    }
  }

  if (jsonMode) { console.log(JSON.stringify(totals.map(t => ({ ...t, sizeHuman: humanSize(t.size) })), null, 2)); return; }

  console.log(bold('\n💾 Disk Usage\n'));
  for (const t of totals) {
    console.log(`  ${t.name.padEnd(30)} ${humanSize(t.size)}`);
  }

  // Top 5 largest dirs in ~/.openclaw
  if (existsSync(OC_DIR)) {
    const subdirs = [];
    try {
      for (const d of readdirSync(OC_DIR)) {
        const p = join(OC_DIR, d);
        try { if (statSync(p).isDirectory()) subdirs.push({ name: d, size: dirSize(p) }); } catch {}
      }
    } catch {}
    subdirs.sort((a, b) => b.size - a.size);
    console.log(dim('\n  Top directories in ~/.openclaw:'));
    for (const d of subdirs.slice(0, 5)) {
      console.log(`    ${d.name.padEnd(28)} ${humanSize(d.size)}`);
    }
  }
  console.log();
}

function cmdDiskClean() {
  const dryRun = flags.has('--dry-run');
  const now = Date.now();
  const DAY = 86400000;
  const toDelete = [];

  // Session archives > 30 days
  if (existsSync(AGENTS_DIR)) {
    for (const agent of readdirSync(AGENTS_DIR)) {
      const archDir = join(AGENTS_DIR, agent, 'sessions', 'archive');
      if (!existsSync(archDir)) continue;
      for (const f of readdirSync(archDir)) {
        const p = join(archDir, f);
        try {
          const st = statSync(p);
          if (now - st.mtimeMs > 30 * DAY) toDelete.push({ path: p, reason: 'archive >30d', size: st.size });
        } catch {}
      }
    }
  }

  // Log files > 14 days
  if (existsSync(LOGS_DIR)) {
    const walkLogs = (dir) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, f.name);
        if (f.isDirectory()) { walkLogs(p); continue; }
        try {
          const st = statSync(p);
          if (now - st.mtimeMs > 14 * DAY) toDelete.push({ path: p, reason: 'log >14d', size: st.size });
        } catch {}
      }
    };
    walkLogs(LOGS_DIR);
  }

  const totalSize = toDelete.reduce((s, f) => s + f.size, 0);

  if (jsonMode) { console.log(JSON.stringify({ files: toDelete.length, size: humanSize(totalSize), dryRun, items: toDelete })); return; }

  if (toDelete.length === 0) { console.log('\n✨ Nothing to clean.\n'); return; }

  console.log(bold(`\n🧹 Cleanup${dryRun ? ' (dry run)' : ''}\n`));
  for (const f of toDelete) {
    console.log(`  ${dryRun ? dim('would delete') : red('deleting')} ${f.path} ${dim(`(${humanSize(f.size)}, ${f.reason})`)}`);
    if (!dryRun) try { unlinkSync(f.path); } catch {}
  }
  console.log(`\n  ${dryRun ? 'Would free' : 'Freed'}: ${humanSize(totalSize)} (${toDelete.length} files)\n`);
}

// ─── MAIN ───

function usage() {
  console.log(`
${bold('ops')} — OpenClaw operational toolkit

${bold('Commands:')}
  ${cyan('health')} [--quick] [--json]     System health check
  ${cyan('backup')} [--full]               Backup config & workspace
  ${cyan('backup list')} [--json]          List available backups
  ${cyan('backup restore')} <id>           Restore from backup (needs --confirm)
  ${cyan('sessions')} [--json]             List active sessions
  ${cyan('sessions rotate')} <key>         Rotate a session file
  ${cyan('queue')}                         Show task queue
  ${cyan('queue drain')}                   Print spawn plan for queue
  ${cyan('disk')} [--json]                 Disk usage breakdown
  ${cyan('disk clean')} [--dry-run]        Clean old archives & logs
`);
}

switch (command) {
  case 'health': cmdHealth(); break;
  case 'backup': cmdBackup(); break;
  case 'sessions': cmdSessions(); break;
  case 'queue': cmdQueue(); break;
  case 'disk': cmdDisk(); break;
  case '--help': case '-h': case undefined: usage(); break;
  default: console.error(`Unknown command: ${command}`); usage(); process.exit(1);
}

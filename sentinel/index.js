#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, appendFileSync } from 'fs';
import { resolve, join, basename } from 'path';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { homedir } from 'os';

// ── Paths ──
const HOME = homedir();
const WORKSPACE = resolve(HOME, '.openclaw/workspace');
const CONFIG_PATH = resolve(HOME, '.openclaw/openclaw.json');
const BASELINES_DIR = resolve(WORKSPACE, 'security/baselines');
const LOG_PATH = resolve(WORKSPACE, 'security/sentinel-log.jsonl');
const AGENTS_DIR = resolve(HOME, '.openclaw/agents');

// ── Colors ──
const red = s => `\x1b[31m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const cyan = s => `\x1b[36m${s}\x1b[0m`;
const bold = s => `\x1b[1m${s}\x1b[0m`;
const dim = s => `\x1b[2m${s}\x1b[0m`;

// ── Finding helpers ──
function finding(severity, category, check, message) {
  return { severity, category, check, message, timestamp: new Date().toISOString() };
}

const severityColor = { P0: red, P1: red, P2: yellow, P3: dim };
const severityLabel = { P0: '🔴 P0', P1: '🟠 P1', P2: '🟡 P2', P3: '⚪ P3' };

function printFindings(findings, jsonMode) {
  if (jsonMode) {
    console.log(JSON.stringify(findings, null, 2));
    return;
  }
  if (findings.length === 0) {
    console.log(green('✓ No findings.'));
    return;
  }
  for (const f of findings) {
    const color = severityColor[f.severity] || (s => s);
    console.log(`${color(severityLabel[f.severity] || f.severity)} [${f.check}] ${f.message}`);
  }
  const counts = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  console.log(`\n${bold('Summary:')} ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
}

function logFindings(findings) {
  if (findings.length === 0) return;
  const dir = resolve(WORKSPACE, 'security');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const lines = findings.map(f => JSON.stringify(f)).join('\n') + '\n';
  appendFileSync(LOG_PATH, lines);
}

function ensureBaselines() {
  if (!existsSync(BASELINES_DIR)) mkdirSync(BASELINES_DIR, { recursive: true });
}

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 10000 });
  } catch (e) {
    return e.stdout || e.stderr || e.message;
  }
}

function fileHash(path) {
  const data = readFileSync(path);
  return createHash('sha256').update(data).digest('hex');
}

// ── Checks ──

function checkConfig() {
  const findings = [];
  if (!existsSync(CONFIG_PATH)) {
    findings.push(finding('P0', 'config', 'config', 'openclaw.json not found'));
    return findings;
  }
  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    findings.push(finding('P0', 'config', 'config', 'openclaw.json is invalid JSON'));
    return findings;
  }
  // Check for model configuration — OpenClaw uses agents.defaults.model.primary, not top-level defaultModel
  const primaryModel = config.agents?.defaults?.model?.primary;
  if (!primaryModel) {
    findings.push(finding('P1', 'config', 'config', 'Missing agents.defaults.model.primary (no default model configured)'));
  }
  if (!config.agents?.list || !Array.isArray(config.agents.list)) {
    findings.push(finding('P1', 'config', 'config', 'Missing or invalid agents.list'));
  }
  // Hash comparison — auto-updates baseline when drift is explained by config.patch writes
  const hashFile = resolve(BASELINES_DIR, 'config-hash.txt');
  if (existsSync(hashFile)) {
    const stored = readFileSync(hashFile, 'utf8').trim();
    const current = fileHash(CONFIG_PATH);
    if (stored !== current) {
      // Check gateway log for config.patch writes that explain the drift
      const GATEWAY_LOG = resolve(HOME, '.openclaw/logs/gateway.log');
      let patchExplained = false;
      let patchCount = 0;
      let patchPaths = [];
      if (existsSync(GATEWAY_LOG)) {
        try {
          const logContent = readFileSync(GATEWAY_LOG, 'utf8');
          const patchLines = logContent.split('\n').filter(l => l.includes('config.patch write'));
          // Get baseline file mtime as cutoff
          const baselineMtime = statSync(hashFile).mtime;
          for (const line of patchLines) {
            // Extract timestamp from log line (ISO format at start or in brackets)
            const tsMatch = line.match(/(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
            if (tsMatch) {
              const patchTime = new Date(tsMatch[1]);
              if (patchTime >= baselineMtime) {
                patchCount++;
                const pathMatch = line.match(/changedPaths=([^\s]+)/);
                if (pathMatch) patchPaths.push(pathMatch[1]);
              }
            }
          }
          if (patchCount > 0) patchExplained = true;
        } catch {}
      }

      if (patchExplained) {
        // Drift explained by legitimate config.patch writes — auto-update baseline
        writeFileSync(hashFile, current + '\n');
        // Also sync memory/config-hash.txt if it exists
        const memHashFile = resolve(WORKSPACE, 'memory/config-hash.txt');
        if (existsSync(memHashFile)) {
          writeFileSync(memHashFile, `${current} ${new Date().toISOString()}\n`);
        }
        findings.push(finding('P3', 'config', 'config',
          `Config drift auto-resolved: ${patchCount} config.patch write(s) since baseline (paths: ${patchPaths.join('; ') || 'unknown'}). Baseline updated.`));
      } else {
        // UNEXPLAINED drift — genuine P1
        findings.push(finding('P1', 'config', 'config', `Config hash drift: expected ${stored.slice(0, 12)}… got ${current.slice(0, 12)}… (no config.patch writes found to explain change)`));
      }
    } else {
      findings.push(finding('P3', 'config', 'config', 'Config hash matches baseline'));
    }
  } else {
    findings.push(finding('P3', 'config', 'config', 'No config baseline. Run `sentinel baseline update`'));
  }
  return findings;
}

function checkPermissions() {
  const findings = [];
  const sensitiveFiles = [CONFIG_PATH];
  // Add session dirs
  if (existsSync(AGENTS_DIR)) {
    for (const agent of readdirSync(AGENTS_DIR)) {
      const sessDir = resolve(AGENTS_DIR, agent, 'sessions');
      if (existsSync(sessDir)) sensitiveFiles.push(sessDir);
    }
  }
  sensitiveFiles.push(WORKSPACE);

  for (const fp of sensitiveFiles) {
    if (!existsSync(fp)) continue;
    try {
      const stat = statSync(fp);
      const mode = stat.mode & 0o777;
      const worldRead = mode & 0o004;
      const worldWrite = mode & 0o002;
      if (worldRead || worldWrite) {
        findings.push(finding('P2', 'permissions', 'permissions', `${fp} is world-${worldRead ? 'readable' : ''}${worldWrite ? 'writable' : ''} (${mode.toString(8)})`));
      }
    } catch {}
  }
  if (findings.length === 0) {
    findings.push(finding('P3', 'permissions', 'permissions', 'All checked files have safe permissions'));
  }
  return findings;
}

function checkFirewall() {
  const findings = [];
  const out = run('/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate');
  if (out.includes('enabled')) {
    findings.push(finding('P3', 'firewall', 'firewall', 'macOS firewall is enabled'));
  } else if (out.includes('disabled')) {
    findings.push(finding('P0', 'firewall', 'firewall', 'macOS firewall is DISABLED'));
  } else {
    findings.push(finding('P2', 'firewall', 'firewall', `Could not determine firewall state: ${out.trim().slice(0, 100)}`));
  }
  return findings;
}

function checkPorts() {
  const findings = [];
  const out = run('lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null');
  const lines = out.split('\n').filter(l => l && !l.startsWith('COMMAND'));
  const current = lines.map(l => {
    const parts = l.split(/\s+/);
    return { command: parts[0], pid: parts[1], name: parts[8] || parts[7] || '' };
  }).filter(p => p.name);

  const baselineFile = resolve(BASELINES_DIR, 'ports-baseline.json');
  if (existsSync(baselineFile)) {
    let baseline;
    try {
      baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
    } catch {
      findings.push(finding('P2', 'ports', 'ports', 'ports-baseline.json is invalid JSON'));
      return findings;
    }
    const baselineNames = new Set(baseline.map(p => p.name));
    const currentNames = new Set(current.map(p => p.name));
    for (const p of current) {
      if (!baselineNames.has(p.name)) {
        findings.push(finding('P1', 'ports', 'ports', `New listener: ${p.command} on ${p.name}`));
      }
    }
    for (const p of baseline) {
      if (!currentNames.has(p.name)) {
        findings.push(finding('P3', 'ports', 'ports', `Baseline listener gone: ${p.command} on ${p.name}`));
      }
    }
    if (findings.length === 0) {
      findings.push(finding('P3', 'ports', 'ports', `${current.length} listeners match baseline`));
    }
  } else {
    findings.push(finding('P3', 'ports', 'ports', `${current.length} listening ports. No baseline. Run \`sentinel baseline update\``));
  }
  return findings;
}

function checkSessions() {
  const findings = [];
  if (!existsSync(AGENTS_DIR)) {
    findings.push(finding('P3', 'sessions', 'sessions', 'No agents directory found'));
    return findings;
  }
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const SIZE_LIMIT = 100 * 1024;

  for (const agent of readdirSync(AGENTS_DIR)) {
    const sessDir = resolve(AGENTS_DIR, agent, 'sessions');
    if (!existsSync(sessDir)) continue;
    for (const file of readdirSync(sessDir)) {
      if (!file.endsWith('.jsonl')) continue;
      const fp = resolve(sessDir, file);
      try {
        const stat = statSync(fp);
        if (stat.size > SIZE_LIMIT) {
          findings.push(finding('P2', 'sessions', 'sessions', `Large session (${(stat.size / 1024).toFixed(0)}KB): ${agent}/${file}`));
        }
        if (now - stat.mtimeMs > SEVEN_DAYS) {
          findings.push(finding('P2', 'sessions', 'sessions', `Stale session (>7d): ${agent}/${file}`));
        }
        // Credential-then-send pattern detection
        if (stat.size < 5 * 1024 * 1024) { // only parse files < 5MB
          const content = readFileSync(fp, 'utf8');
          const lines = content.split('\n').filter(Boolean);
          let sawCredRead = false;
          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              const text = JSON.stringify(entry).toLowerCase();
              if (text.includes('find-generic-password') || text.includes('keychain') || text.includes('api_key') || text.includes('api-key') || text.includes('secret_key')) {
                sawCredRead = true;
              }
              if (sawCredRead && (text.includes('curl') || text.includes('fetch(') || text.includes('web_fetch') || text.includes('http.request'))) {
                findings.push(finding('P1', 'sessions', 'sessions', `Credential-read-then-external-send pattern: ${agent}/${file}`));
                break;
              }
            } catch {}
          }
        }
      } catch {}
    }
  }
  if (findings.length === 0) {
    findings.push(finding('P3', 'sessions', 'sessions', 'No session anomalies detected'));
  }
  return findings;
}

function checkCredentials() {
  const findings = [];
  // Scan workspace for plaintext credentials
  const patterns = [
    /sk-[a-zA-Z0-9]{20,}/,
    /ghp_[a-zA-Z0-9]{36}/,
    /gho_[a-zA-Z0-9]{36}/,
    /xoxb-[0-9]+-[a-zA-Z0-9]+/,
    /AKIA[0-9A-Z]{16}/,
    /AIza[0-9A-Za-z_-]{35}/,
  ];
  const patternNames = ['OpenAI key', 'GitHub PAT', 'GitHub OAuth', 'Slack bot token', 'AWS access key', 'Google API key'];

  function scanDir(dir, depth = 0) {
    if (depth > 4) return;
    if (!existsSync(dir)) return;
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith('.') || entry === 'node_modules' || entry === 'security') continue;
        const fp = resolve(dir, entry);
        try {
          const stat = statSync(fp);
          if (stat.isDirectory()) {
            scanDir(fp, depth + 1);
          } else if (stat.isFile() && stat.size < 1024 * 1024) {
            const ext = entry.split('.').pop();
            if (['json', 'js', 'md', 'txt', 'yaml', 'yml', 'env', 'sh', 'toml'].includes(ext) || entry === '.env') {
              const content = readFileSync(fp, 'utf8');
              for (let i = 0; i < patterns.length; i++) {
                if (patterns[i].test(content)) {
                  findings.push(finding('P0', 'credentials', 'credentials', `Possible ${patternNames[i]} in ${fp}`));
                }
              }
            }
          }
        } catch {}
      }
    } catch {}
  }
  scanDir(WORKSPACE);

  // Check keychain integration
  const out = run('security find-generic-password -a "tycho" -s "tycho/test" 2>&1');
  if (out.includes('could not be found') || out.includes('SecKeychainSearchCopyNext')) {
    findings.push(finding('P3', 'credentials', 'credentials', 'Keychain integration working (test entry correctly not found)'));
  } else if (out.includes('error') || out.includes('Error')) {
    findings.push(finding('P1', 'credentials', 'credentials', `Keychain integration issue: ${out.trim().slice(0, 100)}`));
  } else {
    findings.push(finding('P3', 'credentials', 'credentials', `Keychain responded: ${out.trim().slice(0, 80)}`));
  }

  if (findings.filter(f => f.severity === 'P0').length === 0) {
    findings.push(finding('P3', 'credentials', 'credentials', 'No plaintext credentials found in workspace'));
  }
  return findings;
}

function checkAgents() {
  const findings = [];
  if (!existsSync(CONFIG_PATH)) {
    findings.push(finding('P1', 'agents', 'agents', 'Cannot check agents: openclaw.json not found'));
    return findings;
  }
  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    findings.push(finding('P1', 'agents', 'agents', 'Cannot check agents: invalid config'));
    return findings;
  }
  const agents = config.agents?.list;
  if (!Array.isArray(agents)) {
    findings.push(finding('P1', 'agents', 'agents', 'agents.list is not an array'));
    return findings;
  }
  for (const agent of agents) {
    const name = agent.name || agent.id || 'unknown';
    if (!agent.workspaceAccess) {
      findings.push(finding('P2', 'agents', 'agents', `Agent "${name}" has no workspaceAccess setting`));
    }
    if (agent.workspaceAccess === 'full' && agent.sandbox !== true) {
      findings.push(finding('P2', 'agents', 'agents', `Agent "${name}" has full workspace access without sandbox`));
    }
  }
  if (findings.length === 0) {
    findings.push(finding('P3', 'agents', 'agents', `${agents.length} agents checked, configurations look reasonable`));
  }
  return findings;
}

// ── Check dispatcher ──
const CHECKS = {
  config: checkConfig,
  permissions: checkPermissions,
  firewall: checkFirewall,
  ports: checkPorts,
  sessions: checkSessions,
  credentials: checkCredentials,
  agents: checkAgents,
};
const QUICK_CHECKS = ['config', 'permissions', 'firewall', 'ports'];

// ── Baseline commands ──

function baselineUpdate() {
  ensureBaselines();
  // Config hash — sync all baseline locations
  if (existsSync(CONFIG_PATH)) {
    const hash = fileHash(CONFIG_PATH);
    const now = new Date().toISOString();
    writeFileSync(resolve(BASELINES_DIR, 'config-hash.txt'), hash + '\n');
    // Sync memory/config-hash.txt
    const memHashFile = resolve(WORKSPACE, 'memory/config-hash.txt');
    writeFileSync(memHashFile, `${hash} ${now}\n`);
    // Sync data/config-baseline.json
    const dataDir = resolve(WORKSPACE, 'data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    writeFileSync(resolve(dataDir, 'config-baseline.json'), JSON.stringify({
      hash,
      set_at: now,
      set_by: 'sentinel baseline update',
    }, null, 2) + '\n');
    console.log(green('✓') + ' Config hash saved (all 3 baseline locations synced)');
  }
  // Ports
  const out = run('lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null');
  const lines = out.split('\n').filter(l => l && !l.startsWith('COMMAND'));
  const ports = lines.map(l => {
    const parts = l.split(/\s+/);
    return { command: parts[0], pid: parts[1], name: parts[8] || parts[7] || '' };
  }).filter(p => p.name);
  writeFileSync(resolve(BASELINES_DIR, 'ports-baseline.json'), JSON.stringify(ports, null, 2) + '\n');
  console.log(green('✓') + ` Ports baseline saved (${ports.length} listeners)`);
  // Permissions snapshot
  const permFiles = [CONFIG_PATH, WORKSPACE];
  const perms = {};
  for (const fp of permFiles) {
    if (existsSync(fp)) {
      const stat = statSync(fp);
      perms[fp] = (stat.mode & 0o777).toString(8);
    }
  }
  writeFileSync(resolve(BASELINES_DIR, 'permissions-baseline.json'), JSON.stringify(perms, null, 2) + '\n');
  console.log(green('✓') + ' Permissions baseline saved');
}

function baselineDiff(jsonMode) {
  ensureBaselines();
  const findings = [];

  // Config hash diff
  const hashFile = resolve(BASELINES_DIR, 'config-hash.txt');
  if (existsSync(hashFile) && existsSync(CONFIG_PATH)) {
    const stored = readFileSync(hashFile, 'utf8').trim();
    const current = fileHash(CONFIG_PATH);
    if (stored !== current) {
      findings.push(finding('P1', 'baseline', 'baseline-diff', 'Config hash has drifted from baseline'));
    }
  }

  // Ports diff
  const portsFile = resolve(BASELINES_DIR, 'ports-baseline.json');
  if (existsSync(portsFile)) {
    const baseline = JSON.parse(readFileSync(portsFile, 'utf8'));
    const out = run('lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null');
    const lines = out.split('\n').filter(l => l && !l.startsWith('COMMAND'));
    const current = lines.map(l => {
      const parts = l.split(/\s+/);
      return { command: parts[0], name: parts[8] || parts[7] || '' };
    }).filter(p => p.name);
    const baseNames = new Set(baseline.map(p => p.name));
    const curNames = new Set(current.map(p => p.name));
    for (const p of current) {
      if (!baseNames.has(p.name)) findings.push(finding('P1', 'baseline', 'baseline-diff', `New listener: ${p.command} on ${p.name}`));
    }
    for (const p of baseline) {
      if (!curNames.has(p.name)) findings.push(finding('P3', 'baseline', 'baseline-diff', `Gone: ${p.command} on ${p.name}`));
    }
  }

  // Permissions diff
  const permFile = resolve(BASELINES_DIR, 'permissions-baseline.json');
  if (existsSync(permFile)) {
    const baseline = JSON.parse(readFileSync(permFile, 'utf8'));
    for (const [fp, expectedMode] of Object.entries(baseline)) {
      if (!existsSync(fp)) continue;
      const current = (statSync(fp).mode & 0o777).toString(8);
      if (current !== expectedMode) {
        findings.push(finding('P2', 'baseline', 'baseline-diff', `${fp}: permissions changed ${expectedMode} → ${current}`));
      }
    }
  }

  if (findings.length === 0) {
    findings.push(finding('P3', 'baseline', 'baseline-diff', 'No drift from baseline'));
  }
  printFindings(findings, jsonMode);
}

// ── Report ──

function report(days, jsonMode) {
  if (!existsSync(LOG_PATH)) {
    console.log('No findings log yet. Run `sentinel sweep` first.');
    return;
  }
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const lines = readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (new Date(e.timestamp).getTime() >= cutoff) entries.push(e);
    } catch {}
  }
  if (jsonMode) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  console.log(bold(`Sentinel Report — last ${days} days (${entries.length} findings)\n`));
  const bySev = {};
  for (const e of entries) {
    bySev[e.severity] = (bySev[e.severity] || 0) + 1;
  }
  for (const s of ['P0', 'P1', 'P2', 'P3']) {
    if (bySev[s]) console.log(`  ${s}: ${bySev[s]}`);
  }
  console.log('');
  // Show P0/P1 details
  const critical = entries.filter(e => e.severity === 'P0' || e.severity === 'P1');
  if (critical.length > 0) {
    console.log(bold('Critical/High findings:'));
    for (const f of critical.slice(-20)) {
      const color = severityColor[f.severity];
      console.log(`  ${color(f.severity)} [${f.check}] ${f.message} ${dim(f.timestamp)}`);
    }
  }
}

// ── Main ──

const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];
const jsonMode = args.includes('--json');
const quickMode = args.includes('--quick');

function usage() {
  console.log(`
${bold('sentinel')} — Security scanner for OpenClaw

${bold('Commands:')}
  ${cyan('sweep')}                  Run all checks
    --quick                Only config, permissions, firewall, ports
    --json                 Output as JSON
  ${cyan('check')} <subsystem>      Run a specific check
    Subsystems: ${Object.keys(CHECKS).join(', ')}
  ${cyan('baseline update')}        Capture current state as baseline
  ${cyan('baseline diff')}          Compare current state to baseline
  ${cyan('report')} [--days N]      Aggregated findings (default: 7 days)

${bold('Severities:')}
  P0 = immediate threat, P1 = high risk, P2 = medium, P3 = info
`);
}

if (!command || command === 'help' || command === '--help') {
  usage();
} else if (command === 'sweep') {
  const checks = quickMode ? QUICK_CHECKS : Object.keys(CHECKS);
  const allFindings = [];
  for (const name of checks) {
    const results = CHECKS[name]();
    allFindings.push(...results);
  }
  logFindings(allFindings);
  printFindings(allFindings, jsonMode);
  if (!jsonMode) console.log(dim(`\nLogged ${allFindings.length} findings to sentinel-log.jsonl`));
} else if (command === 'check') {
  if (!subcommand || !CHECKS[subcommand]) {
    console.error(`Unknown subsystem: ${subcommand}. Available: ${Object.keys(CHECKS).join(', ')}`);
    process.exit(1);
  }
  const results = CHECKS[subcommand]();
  printFindings(results, jsonMode);
} else if (command === 'baseline') {
  if (subcommand === 'update') {
    baselineUpdate();
  } else if (subcommand === 'diff') {
    baselineDiff(jsonMode);
  } else {
    console.error('Usage: sentinel baseline <update|diff>');
    process.exit(1);
  }
} else if (command === 'report') {
  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) || 7 : 7;
  report(days, jsonMode);
} else {
  console.error(`Unknown command: ${command}`);
  usage();
  process.exit(1);
}

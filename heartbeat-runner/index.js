#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { homedir } from 'os';

// ── Config ──────────────────────────────────────────────────────────
const WORKSPACE = resolve(homedir(), '.openclaw/workspace');
const LOG_FILE = resolve(WORKSPACE, 'heartbeat-log.jsonl');
const FOCUS_FILE = resolve(WORKSPACE, 'self-improvement/focus.md');
const PROPOSALS_FILE = resolve(WORKSPACE, 'architecture/proposals.jsonl');
const PROPOSAL_TRACKER = resolve(WORKSPACE, 'scripts/proposal-tracker.sh');

// ── CLI Colors ──────────────────────────────────────────────────────
const bold = s => `\x1b[1m${s}\x1b[0m`;
const dim = s => `\x1b[2m${s}\x1b[0m`;
const red = s => `\x1b[31m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const cyan = s => `\x1b[36m${s}\x1b[0m`;

// ── Args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const command = args[0];
const flags = {
  json: args.includes('--json'),
  quick: args.includes('--quick'),
  verbose: args.includes('--verbose'),
  days: (() => {
    const i = args.indexOf('--days');
    return i !== -1 && args[i + 1] ? parseInt(args[i + 1], 10) : 3;
  })(),
};

// ── Helpers ─────────────────────────────────────────────────────────
function tryExec(cmd) {
  try {
    return { ok: true, stdout: execSync(cmd, { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }).trim() };
  } catch (e) {
    if (e.status === 127 || (e.message && e.message.includes('not found')) || (e.stderr && e.stderr.includes('not found'))) {
      return { ok: false, skipped: true, error: 'tool not found' };
    }
    // Tool exists but errored
    const stdout = e.stdout ? e.stdout.toString().trim() : '';
    return { ok: false, skipped: false, error: e.message, stdout };
  }
}

function tryParseJSON(str) {
  try { return JSON.parse(str); } catch { return null; }
}

// ── Step runners ────────────────────────────────────────────────────
function runSecurity() {
  const result = tryExec('sentinel sweep --quick --json 2>/dev/null');
  if (result.skipped) return { ok: true, findings: 0, p0: 0, p1: 0, skipped: true, raw: null };
  const data = tryParseJSON(result.stdout);
  if (!data) {
    // Try to parse even on error
    const fallback = result.stdout ? tryParseJSON(result.stdout) : null;
    if (fallback) {
      const findings = fallback.findings || fallback.issues || [];
      const p0 = findings.filter(f => f.priority === 'P0' || f.severity === 'P0').length;
      const p1 = findings.filter(f => f.priority === 'P1' || f.severity === 'P1').length;
      return { ok: p0 === 0 && p1 === 0, findings: findings.length, p0, p1, details: findings, raw: fallback };
    }
    return { ok: !result.ok ? false : true, findings: 0, p0: 0, p1: 0, error: result.error, raw: result.stdout };
  }
  const findings = data.findings || data.issues || data.results || [];
  const arr = Array.isArray(findings) ? findings : [];
  const p0 = arr.filter(f => (f.priority || f.severity || '') === 'P0').length;
  const p1 = arr.filter(f => (f.priority || f.severity || '') === 'P1').length;
  return { ok: p0 === 0 && p1 === 0, findings: arr.length, p0, p1, details: arr.slice(0, 10), raw: data };
}

function runHealth() {
  const result = tryExec('ops health --quick --json 2>/dev/null');
  if (result.skipped) return { ok: true, warnings: 0, skipped: true, raw: null };
  const data = tryParseJSON(result.stdout || result.stdout);
  if (!data) return { ok: !result.ok ? false : true, warnings: 0, error: result.error, raw: result.stdout };
  const warnings = data.warnings || data.issues || [];
  const arr = Array.isArray(warnings) ? warnings : [];
  const failures = (data.failures || []);
  return { ok: arr.length === 0 && failures.length === 0, warnings: arr.length + failures.length, details: [...arr, ...failures].slice(0, 10), raw: data };
}

function runProcess() {
  const result = tryExec('process-auditor scan --all --json 2>/dev/null');
  if (result.skipped) return { ok: true, violations: 0, skipped: true, raw: null };
  const data = tryParseJSON(result.stdout);
  if (!data) return { ok: true, violations: 0, error: result.error, raw: result.stdout };
  const violations = data.violations || data.issues || [];
  const arr = Array.isArray(violations) ? violations : [];
  return { ok: arr.length === 0, violations: arr.length, details: arr.slice(0, 10), raw: data };
}

function runMemory() {
  const result = tryExec('memory-engine scan --json 2>/dev/null');
  if (result.skipped) return { ok: true, items: 0, skipped: true, raw: null };
  const data = tryParseJSON(result.stdout);
  if (!data) return { ok: true, items: 0, error: result.error, raw: result.stdout };
  const items = data.items || data.attention || data.issues || [];
  const arr = Array.isArray(items) ? items : [];
  return { ok: arr.length === 0, items: arr.length, details: arr.slice(0, 10), raw: data };
}

function readFocus() {
  if (!existsSync(FOCUS_FILE)) return [];
  const lines = readFileSync(FOCUS_FILE, 'utf8').split('\n');
  return lines
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('<!--') && !l.startsWith('//'))
    .slice(0, 5);
}

function readProposals() {
  if (!existsSync(PROPOSALS_FILE)) return { suggested: 0, building: 0, stale: 0, staleItems: [] };
  const lines = readFileSync(PROPOSALS_FILE, 'utf8').split('\n').filter(Boolean);
  let suggested = 0, building = 0, stale = 0;
  const staleItems = [];
  const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;

  for (const line of lines) {
    const p = tryParseJSON(line);
    if (!p) continue;
    const status = (p.status || '').toLowerCase();
    if (status === 'suggested') {
      suggested++;
      const ts = p.timestamp || p.created || p.date;
      if (ts && new Date(ts).getTime() < sixHoursAgo) {
        stale++;
        staleItems.push(p.title || p.name || p.id || 'unknown');
      }
    } else if (status === 'building' || status === 'in-progress') {
      building++;
    }
  }
  return { suggested, building, stale, staleItems };
}

function runProposalTracker() {
  if (!existsSync(PROPOSAL_TRACKER)) return null;
  const result = tryExec(`bash "${PROPOSAL_TRACKER}" digest 2>/dev/null`);
  if (result.skipped || !result.ok) return null;
  return result.stdout;
}

// ── Commands ────────────────────────────────────────────────────────
function cmdRun() {
  const start = Date.now();
  const timestamp = new Date().toISOString();

  // Steps 1-2 always run
  const security = runSecurity();
  const health = runHealth();

  // Steps 3-7 only in full mode
  let process_ = { ok: true, violations: 0, skipped: true };
  let memory = { ok: true, items: 0, skipped: true };
  let focus = [];
  let proposals = { suggested: 0, building: 0, stale: 0, staleItems: [] };
  let proposalDigest = null;

  if (!flags.quick) {
    process_ = runProcess();
    memory = runMemory();
    focus = readFocus();
    proposals = readProposals();
    if (proposals.stale > 0) {
      proposalDigest = runProposalTracker();
    }
  }

  const duration_ms = Date.now() - start;

  // Build action items
  const action_needed = [];
  if (security.p0 > 0 || security.p1 > 0) {
    (security.details || []).forEach(f => {
      const sev = f.priority || f.severity || '?';
      if (sev === 'P0' || sev === 'P1') action_needed.push(`[${sev}] ${f.title || f.message || f.description || 'security finding'}`);
    });
  }
  if (health.warnings > 0) {
    (health.details || []).forEach(w => action_needed.push(`Health: ${w.message || w.title || w.description || 'warning'}`));
  }
  if (proposals.stale > 0) {
    proposals.staleItems.forEach(s => action_needed.push(`Stale proposal: ${s}`));
  }

  // Log entry
  const logEntry = {
    timestamp,
    duration_ms,
    security: { ok: security.ok, findings: security.findings, p0: security.p0, p1: security.p1 },
    health: { ok: health.ok, warnings: health.warnings },
    process: { ok: process_.ok, violations: process_.violations },
    memory: { ok: memory.ok, items: memory.items },
    focus,
    proposals: { suggested: proposals.suggested, building: proposals.building, stale: proposals.stale },
    action_needed,
  };

  // Ensure log dir exists and append
  const logDir = dirname(LOG_FILE);
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  appendFileSync(LOG_FILE, JSON.stringify(logEntry) + '\n');

  // Output
  if (flags.json) {
    const jsonOut = { ...logEntry };
    if (flags.verbose) {
      jsonOut.raw = { security: security.raw, health: health.raw, process: process_.raw, memory: memory.raw, proposalDigest };
    }
    console.log(JSON.stringify(jsonOut, null, 2));
    return;
  }

  // Human-readable output
  const ts = timestamp.replace(/\.\d+Z$/, '').replace('T', 'T');
  console.log(`\n🫀 HEARTBEAT — ${ts}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Security
  const secLabel = security.skipped ? dim('skipped — tool not found')
    : security.ok ? green('OK')
    : red(`${security.findings} findings (${security.p0} P0, ${security.p1} P1)`);
  console.log(`🔒 Security: ${secLabel}`);

  // Health
  const hlLabel = health.skipped ? dim('skipped — tool not found')
    : health.ok ? green('OK')
    : yellow(`${health.warnings} warnings`);
  console.log(`🏥 Health: ${hlLabel}`);

  // Process
  const prLabel = process_.skipped ? dim('skipped — tool not found')
    : process_.ok ? green('OK')
    : yellow(`${process_.violations} violations`);
  console.log(`📋 Process: ${prLabel}`);

  // Memory
  const memLabel = memory.skipped ? dim('skipped')
    : memory.ok ? green('OK')
    : yellow(`${memory.items} items need attention`);
  console.log(`🧠 Memory: ${memLabel}`);

  // Focus
  const topFocus = focus.length > 0 ? focus[0] : dim('none');
  console.log(`🎯 Focus: ${topFocus}`);

  // Proposals
  console.log(`📝 Proposals: ${proposals.suggested} suggested, ${proposals.building} building, ${proposals.stale} stale`);

  // Action needed
  if (action_needed.length > 0) {
    console.log(`\n⚠️  ${bold('ACTION NEEDED:')}`);
    action_needed.forEach(a => console.log(`  - ${a}`));
  } else {
    console.log(`\n✅ ALL CLEAR`);
  }

  // Verbose raw output
  if (flags.verbose) {
    console.log(`\n${dim('─── Verbose Output ───')}`);
    if (security.raw) console.log(`\n${bold('Security raw:')}\n${typeof security.raw === 'string' ? security.raw : JSON.stringify(security.raw, null, 2)}`);
    if (health.raw) console.log(`\n${bold('Health raw:')}\n${typeof health.raw === 'string' ? health.raw : JSON.stringify(health.raw, null, 2)}`);
    if (process_.raw) console.log(`\n${bold('Process raw:')}\n${typeof process_.raw === 'string' ? process_.raw : JSON.stringify(process_.raw, null, 2)}`);
    if (memory.raw) console.log(`\n${bold('Memory raw:')}\n${typeof memory.raw === 'string' ? memory.raw : JSON.stringify(memory.raw, null, 2)}`);
    if (proposalDigest) console.log(`\n${bold('Proposal digest:')}\n${proposalDigest}`);
  }

  console.log(`\n${dim(`Completed in ${duration_ms}ms`)}\n`);
}

function cmdStatus() {
  if (!existsSync(LOG_FILE)) {
    console.log(flags.json ? JSON.stringify({ error: 'no heartbeat log found' }) : 'No heartbeat log found. Run `heartbeat-runner run` first.');
    return;
  }
  const lines = readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
  const last = tryParseJSON(lines[lines.length - 1]);
  if (!last) {
    console.log('Could not parse last heartbeat entry.');
    return;
  }

  if (flags.json) {
    console.log(JSON.stringify(last, null, 2));
    return;
  }

  const ago = Math.round((Date.now() - new Date(last.timestamp).getTime()) / 1000);
  const agoStr = ago < 60 ? `${ago}s ago` : ago < 3600 ? `${Math.round(ago / 60)}m ago` : `${Math.round(ago / 3600)}h ago`;

  console.log(`\n${bold('Last Heartbeat')}`);
  console.log(`  Timestamp: ${last.timestamp} (${agoStr})`);
  console.log(`  Duration:  ${last.duration_ms}ms`);
  console.log(`  Security:  ${last.security.ok ? green('OK') : red(`${last.security.findings} findings`)}`);
  console.log(`  Health:    ${last.health.ok ? green('OK') : yellow(`${last.health.warnings} warnings`)}`);
  console.log(`  Process:   ${last.process.ok ? green('OK') : yellow(`${last.process.violations} violations`)}`);
  console.log(`  Memory:    ${last.memory.ok ? green('OK') : yellow(`${last.memory.items} items`)}`);
  if (last.action_needed.length > 0) {
    console.log(`  Actions:   ${last.action_needed.length} items`);
    last.action_needed.forEach(a => console.log(`    - ${a}`));
  } else {
    console.log(`  Actions:   ${green('none')}`);
  }
  console.log();
}

function cmdHistory() {
  if (!existsSync(LOG_FILE)) {
    console.log(flags.json ? JSON.stringify({ error: 'no heartbeat log found' }) : 'No heartbeat log found.');
    return;
  }
  const lines = readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
  const cutoff = Date.now() - flags.days * 24 * 60 * 60 * 1000;
  const entries = lines.map(l => tryParseJSON(l)).filter(e => e && new Date(e.timestamp).getTime() >= cutoff);

  if (entries.length === 0) {
    console.log(flags.json ? JSON.stringify({ entries: 0 }) : `No heartbeats in last ${flags.days} days.`);
    return;
  }

  const totalFindings = entries.reduce((s, e) => s + (e.security.findings || 0) + (e.health.warnings || 0), 0);
  const avgFindings = (totalFindings / entries.length).toFixed(1);

  // Most common issues
  const issueCounts = {};
  entries.forEach(e => (e.action_needed || []).forEach(a => { issueCounts[a] = (issueCounts[a] || 0) + 1; }));
  const topIssues = Object.entries(issueCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Trend: compare first half vs second half findings
  const mid = Math.floor(entries.length / 2);
  let trend = 'stable';
  if (entries.length >= 4) {
    const firstHalf = entries.slice(0, mid).reduce((s, e) => s + (e.security.findings || 0) + (e.health.warnings || 0), 0) / mid;
    const secondHalf = entries.slice(mid).reduce((s, e) => s + (e.security.findings || 0) + (e.health.warnings || 0), 0) / (entries.length - mid);
    if (secondHalf < firstHalf * 0.7) trend = 'improving';
    else if (secondHalf > firstHalf * 1.3) trend = 'worsening';
  }

  if (flags.json) {
    console.log(JSON.stringify({ days: flags.days, entries: entries.length, avgFindings: parseFloat(avgFindings), topIssues, trend }, null, 2));
    return;
  }

  console.log(`\n${bold(`Heartbeat History — last ${flags.days} days`)}`);
  console.log(`  Heartbeats: ${entries.length}`);
  console.log(`  Avg findings: ${avgFindings}`);
  console.log(`  Trend: ${trend === 'improving' ? green(trend) : trend === 'worsening' ? red(trend) : yellow(trend)}`);
  if (topIssues.length > 0) {
    console.log(`  Top issues:`);
    topIssues.forEach(([issue, count]) => console.log(`    ${count}x ${issue}`));
  } else {
    console.log(`  Top issues: ${green('none')}`);
  }
  console.log();
}

function usage() {
  console.log(`
${bold('heartbeat-runner')} — Orchestrated health/security/memory heartbeat

${bold('Commands:')}
  ${cyan('run')}                Full heartbeat sequence
  ${cyan('status')}             Last heartbeat summary
  ${cyan('history')} [--days N]  Heartbeat trends (default: 3 days)

${bold('Flags:')}
  --quick      Only security + health (steps 1-2)
  --json       Machine-readable JSON output
  --verbose    Include full tool outputs
  --days N     History window (default: 3)
`);
}

// ── Main ────────────────────────────────────────────────────────────
switch (command) {
  case 'run':    cmdRun(); break;
  case 'status': cmdStatus(); break;
  case 'history': cmdHistory(); break;
  default:       usage(); break;
}

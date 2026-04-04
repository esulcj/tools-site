#!/usr/bin/env node

import { createReadStream, appendFileSync, existsSync, readdirSync, statSync } from 'fs';
import { createInterface } from 'readline';
import { resolve, join } from 'path';
import { homedir } from 'os';

// ── Colors ──
const red = s => `\x1b[31m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const cyan = s => `\x1b[36m${s}\x1b[0m`;
const bold = s => `\x1b[1m${s}\x1b[0m`;
const dim = s => `\x1b[2m${s}\x1b[0m`;

// ── Rules ──
const RULES = [
  { id: 'sensitive-data', description: 'Scan message sends for API keys, tokens, passwords, credit card numbers', severity: 'P0', checks: 'message tool calls with sensitive patterns in content' },
  { id: 'config-safety', description: 'Config apply/patch without preceding config-guardian validate', severity: 'P0', checks: 'config.apply or config.patch calls without prior validation' },
  { id: 'delivery-completion', description: 'Sub-agent completion without message delivery within 5 turns', severity: 'P1', checks: 'sub-agent completion events followed by message send' },
  { id: 'unbounded-external', description: 'Booking/purchase/payment without user confirmation', severity: 'P1', checks: 'external action tool calls without preceding user message' },
  { id: 'memory-integrity', description: 'Agent says "noted"/"I\'ll remember" without file write within 3 turns', severity: 'P2', checks: 'assistant promises to remember, followed by file write/edit' },
  { id: 'channel-verify', description: 'Message tool calls without explicit channel/target', severity: 'P2', checks: 'message tool calls missing target or channel parameter' },
];

const SEVERITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };

const SENSITIVE_PATTERNS = [
  /(?:sk|pk|ak|rk)[-_][a-zA-Z0-9]{20,}/,                // API keys (sk-xxx, pk-xxx)
  /(?:ghp|gho|ghs|ghr)_[A-Za-z0-9_]{30,}/,              // GitHub tokens
  /xox[bpars]-[A-Za-z0-9-]{10,}/,                        // Slack tokens
  /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\./,     // JWTs
  /(?:password|passwd|pwd)\s*[:=]\s*\S{6,}/i,             // password assignments
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,                       // AWS access keys
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,         // Credit card numbers
  /(?:Bearer|token|api[_-]?key)\s+[A-Za-z0-9_.-]{20,}/i, // Bearer/token patterns
];

const MEMORY_PROMISE_PATTERNS = [
  /\bnoted\b/i,
  /\bi['']ll remember\b/i,
  /\bgot it\b/i,
];

const EXTERNAL_ACTION_PATTERNS = [
  /\bboo(?:k|king)\b/i,
  /\bpurchase\b/i,
  /\bpayment\b/i,
  /\bcheckout\b/i,
  /\border\b/i,
  /\bbuy\b/i,
];

const WORKSPACE = process.env.GUARDIAN_WORKSPACE || join(homedir(), '.openclaw', 'workspace');
const LOG_PATH = join(WORKSPACE, 'guardian-log.jsonl');

// ── Parse args ──
const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const severityFilter = (() => {
  const idx = args.indexOf('--severity');
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
})();
const limitFlag = (() => {
  const idx = args.indexOf('--limit');
  return idx >= 0 && args[idx + 1] ? parseInt(args[idx + 1], 10) : null;
})();
const daysFlag = (() => {
  const idx = args.indexOf('--days');
  return idx >= 0 && args[idx + 1] ? parseInt(args[idx + 1], 10) : 7;
})();
const positionalArgs = args.filter(a => !a.startsWith('--'));

// ── Helpers ──
function filterBySeverity(violations) {
  if (!severityFilter) return violations;
  const threshold = SEVERITY_ORDER[severityFilter];
  if (threshold === undefined) return violations;
  return violations.filter(v => SEVERITY_ORDER[v.severity] <= threshold);
}

function logViolations(violations, sessionPath) {
  if (violations.length === 0) return;
  const ts = new Date().toISOString();
  for (const v of violations) {
    const entry = { ...v, session: sessionPath || 'unknown', timestamp: ts };
    try { appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n'); } catch {}
  }
}

function extractToolCalls(entry) {
  // Look for tool_use in assistant content, or tool calls in various formats
  const calls = [];
  if (entry.role === 'assistant' && Array.isArray(entry.content)) {
    for (const block of entry.content) {
      if (block.type === 'tool_use') calls.push(block);
    }
  }
  // Also check for tool_calls array
  if (Array.isArray(entry.tool_calls)) {
    for (const tc of entry.tool_calls) calls.push(tc);
  }
  return calls;
}

function getAssistantText(entry) {
  if (entry.role !== 'assistant') return '';
  if (typeof entry.content === 'string') return entry.content;
  if (Array.isArray(entry.content)) {
    return entry.content.filter(b => b.type === 'text').map(b => b.text).join(' ');
  }
  return '';
}

function isMessageSend(tc) {
  return tc.name === 'message' && tc.input?.action === 'send';
}

function isFileWrite(tc) {
  return tc.name === 'write' || tc.name === 'edit';
}

function isConfigChange(tc) {
  const name = tc.name || '';
  const input = tc.input || {};
  return name === 'config' && (input.action === 'apply' || input.action === 'patch');
}

function isConfigValidate(tc) {
  const name = tc.name || '';
  return name === 'config-guardian' || (name === 'config' && (tc.input?.action === 'validate'));
}

function isExternalAction(tc) {
  const name = (tc.name || '').toLowerCase();
  const inputStr = JSON.stringify(tc.input || {}).toLowerCase();
  return EXTERNAL_ACTION_PATTERNS.some(p => p.test(name) || p.test(inputStr));
}

function isUserMessage(entry) {
  return entry.role === 'user' || entry.role === 'human';
}

function isSubagentCompletion(entry) {
  // Check for sub-agent completion patterns
  const text = typeof entry.content === 'string' ? entry.content :
    (Array.isArray(entry.content) ? entry.content.map(b => b.text || '').join(' ') : '');
  return /sub-?agent.*(?:completed?|finished|done)/i.test(text) ||
    entry.type === 'subagent_completion' ||
    (entry.role === 'tool' && /completion|finished|done/i.test(text));
}

// ── Check session (streaming) ──
async function checkSession(filePath) {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    console.error(red(`File not found: ${resolved}`));
    process.exit(1);
  }

  const violations = [];
  const window = []; // sliding window of recent entries
  let turnNum = 0;
  let pendingMemoryPromises = []; // [{turn, deadline}]
  let pendingDeliveries = []; // [{turn, deadline}]
  let lastConfigValidate = -Infinity;
  let lastUserConfirmation = -Infinity;

  const rl = createInterface({ input: createReadStream(resolved), crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    turnNum++;

    const toolCalls = extractToolCalls(entry);
    const assistantText = getAssistantText(entry);

    // Track user messages as confirmations
    if (isUserMessage(entry)) {
      lastUserConfirmation = turnNum;
    }

    // Track config-guardian validate
    for (const tc of toolCalls) {
      if (isConfigValidate(tc)) lastConfigValidate = turnNum;
    }

    // Check sub-agent completion
    if (isSubagentCompletion(entry)) {
      pendingDeliveries.push({ turn: turnNum, deadline: turnNum + 5 });
    }

    // Check memory promises
    if (entry.role === 'assistant' && MEMORY_PROMISE_PATTERNS.some(p => p.test(assistantText))) {
      pendingMemoryPromises.push({ turn: turnNum, deadline: turnNum + 3 });
    }

    // Process tool calls
    for (const tc of toolCalls) {
      // Rule: channel-verify
      if (tc.name === 'message' && tc.input) {
        if (!tc.input.target && !tc.input.channel && !tc.input.channelId) {
          violations.push({ turn: turnNum, rule: 'channel-verify', severity: 'P2',
            message: 'Message tool call without explicit channel/target',
            evidence: `tool: message, action: ${tc.input.action || 'unknown'}` });
        }

        // Rule: sensitive-data (on message sends)
        if (tc.input.action === 'send') {
          const msgContent = JSON.stringify(tc.input);
          for (const pat of SENSITIVE_PATTERNS) {
            if (pat.test(msgContent)) {
              violations.push({ turn: turnNum, rule: 'sensitive-data', severity: 'P0',
                message: 'Potential sensitive data in outbound message',
                evidence: `Pattern match: ${pat.source.slice(0, 40)}...` });
              break;
            }
          }
        }
      }

      // Rule: config-safety
      if (isConfigChange(tc)) {
        if (turnNum - lastConfigValidate > 5) {
          violations.push({ turn: turnNum, rule: 'config-safety', severity: 'P0',
            message: 'Config change without preceding config-guardian validate',
            evidence: `tool: ${tc.name}, action: ${tc.input?.action}` });
        }
      }

      // Rule: unbounded-external
      if (isExternalAction(tc) && (turnNum - lastUserConfirmation > 3)) {
        violations.push({ turn: turnNum, rule: 'unbounded-external', severity: 'P1',
          message: 'External action without recent user confirmation',
          evidence: `tool: ${tc.name}, input: ${JSON.stringify(tc.input).slice(0, 80)}` });
      }

      // Clear pending deliveries on message send
      if (isMessageSend(tc)) {
        pendingDeliveries = pendingDeliveries.filter(d => d.turn >= turnNum);
      }

      // Clear pending memory promises on file write
      if (isFileWrite(tc)) {
        pendingMemoryPromises = pendingMemoryPromises.filter(d => d.turn >= turnNum);
      }
    }

    // Check expired deadlines
    pendingDeliveries = pendingDeliveries.filter(d => {
      if (turnNum > d.deadline) {
        violations.push({ turn: d.turn, rule: 'delivery-completion', severity: 'P1',
          message: 'Sub-agent completed but no message delivery within 5 turns',
          evidence: `Completion at turn ${d.turn}, no send by turn ${d.deadline}` });
        return false;
      }
      return true;
    });

    pendingMemoryPromises = pendingMemoryPromises.filter(d => {
      if (turnNum > d.deadline) {
        violations.push({ turn: d.turn, rule: 'memory-integrity', severity: 'P2',
          message: 'Memory promise without file write within 3 turns',
          evidence: `Promise at turn ${d.turn}, no write by turn ${d.deadline}` });
        return false;
      }
      return true;
    });
  }

  // Check any remaining pending items
  for (const d of pendingDeliveries) {
    violations.push({ turn: d.turn, rule: 'delivery-completion', severity: 'P1',
      message: 'Sub-agent completed but no message delivery before session end',
      evidence: `Completion at turn ${d.turn}` });
  }
  for (const d of pendingMemoryPromises) {
    violations.push({ turn: d.turn, rule: 'memory-integrity', severity: 'P2',
      message: 'Memory promise without file write before session end',
      evidence: `Promise at turn ${d.turn}` });
  }

  return { violations: filterBySeverity(violations), totalTurns: turnNum };
}

// ── Check single turn ──
function checkTurn(turnJson) {
  let entry;
  try { entry = JSON.parse(turnJson); } catch (e) {
    console.error(red(`Invalid JSON: ${e.message}`));
    process.exit(1);
  }

  const violations = [];
  const toolCalls = extractToolCalls(entry);
  const assistantText = getAssistantText(entry);

  for (const tc of toolCalls) {
    if (tc.name === 'message' && tc.input) {
      if (!tc.input.target && !tc.input.channel && !tc.input.channelId) {
        violations.push({ turn: 0, rule: 'channel-verify', severity: 'P2',
          message: 'Message tool call without explicit channel/target',
          evidence: `action: ${tc.input.action || 'unknown'}` });
      }
      if (tc.input.action === 'send') {
        const msgContent = JSON.stringify(tc.input);
        for (const pat of SENSITIVE_PATTERNS) {
          if (pat.test(msgContent)) {
            violations.push({ turn: 0, rule: 'sensitive-data', severity: 'P0',
              message: 'Potential sensitive data in outbound message',
              evidence: `Pattern: ${pat.source.slice(0, 40)}` });
            break;
          }
        }
      }
    }
    if (isConfigChange(tc)) {
      violations.push({ turn: 0, rule: 'config-safety', severity: 'P0',
        message: 'Config change (no context to verify preceding validate)',
        evidence: `tool: ${tc.name}` });
    }
  }

  if (entry.role === 'assistant' && MEMORY_PROMISE_PATTERNS.some(p => p.test(assistantText))) {
    violations.push({ turn: 0, rule: 'memory-integrity', severity: 'P2',
      message: 'Memory promise detected (verify file write follows)',
      evidence: assistantText.slice(0, 80) });
  }

  return filterBySeverity(violations);
}

// ── Report ──
async function report() {
  if (!existsSync(LOG_PATH)) {
    if (jsonMode) { console.log(JSON.stringify({ error: 'No log file found' })); }
    else { console.log(yellow('No guardian-log.jsonl found. Run some checks first.')); }
    return;
  }

  const cutoff = Date.now() - daysFlag * 86400000;
  const byRule = {};
  let total = 0;

  const rl = createInterface({ input: createReadStream(LOG_PATH), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const ts = new Date(entry.timestamp).getTime();
      if (ts < cutoff) continue;
      byRule[entry.rule] = (byRule[entry.rule] || 0) + 1;
      total++;
    } catch {}
  }

  const sorted = Object.entries(byRule).sort((a, b) => b[1] - a[1]);
  const mostCommon = sorted[0] || ['none', 0];

  if (jsonMode) {
    console.log(JSON.stringify({ days: daysFlag, total, byRule, mostCommon: mostCommon[0] }, null, 2));
  } else {
    console.log(bold(`\nGuardian Report — last ${daysFlag} days\n`));
    console.log(`Total violations: ${total}`);
    if (sorted.length) {
      console.log(`\nBy rule:`);
      for (const [rule, count] of sorted) {
        const sev = RULES.find(r => r.id === rule)?.severity || 'P3';
        const color = sev === 'P0' ? red : sev === 'P1' ? yellow : dim;
        console.log(`  ${color(sev)} ${rule}: ${count}`);
      }
      console.log(`\nMost common: ${bold(mostCommon[0])} (${mostCommon[1]})`);
    } else {
      console.log(green('No violations found.'));
    }
  }
}

// ── Scan all ──
async function scanAll() {
  const agentsDir = join(homedir(), '.openclaw', 'agents');
  if (!existsSync(agentsDir)) {
    console.error(red('No agents directory found'));
    process.exit(1);
  }

  // Collect all session files with mtime
  const sessionFiles = [];
  try {
    for (const agent of readdirSync(agentsDir)) {
      const sessDir = join(agentsDir, agent, 'sessions');
      if (!existsSync(sessDir)) continue;
      try {
        for (const f of readdirSync(sessDir)) {
          if (!f.endsWith('.jsonl')) continue;
          const fp = join(sessDir, f);
          try {
            const st = statSync(fp);
            sessionFiles.push({ path: fp, mtime: st.mtimeMs });
          } catch {}
        }
      } catch {}
    }
  } catch {}

  // Sort by most recent
  sessionFiles.sort((a, b) => b.mtime - a.mtime);
  const toScan = limitFlag ? sessionFiles.slice(0, limitFlag) : sessionFiles;

  if (toScan.length === 0) {
    if (jsonMode) console.log(JSON.stringify({ sessions: 0, violations: [] }));
    else console.log(yellow('No session files found.'));
    return;
  }

  const allViolations = [];
  let scanned = 0;

  for (const sf of toScan) {
    scanned++;
    if (!jsonMode) process.stdout.write(`\rScanning ${scanned}/${toScan.length}...`);
    try {
      const { violations } = await checkSession(sf.path);
      for (const v of violations) allViolations.push({ ...v, session: sf.path });
    } catch {}
  }

  logViolations(allViolations, 'scan-all');

  if (jsonMode) {
    console.log(JSON.stringify({ sessions: scanned, totalViolations: allViolations.length, violations: allViolations }, null, 2));
  } else {
    console.log(`\n\n${bold('Scan Complete')}`);
    console.log(`Sessions scanned: ${scanned}`);
    console.log(`Total violations: ${allViolations.length}`);
    if (allViolations.length) {
      const byRule = {};
      for (const v of allViolations) byRule[v.rule] = (byRule[v.rule] || 0) + 1;
      console.log(`\nBy rule:`);
      for (const [rule, count] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
        const sev = RULES.find(r => r.id === rule)?.severity || 'P3';
        const color = sev === 'P0' ? red : sev === 'P1' ? yellow : dim;
        console.log(`  ${color(sev)} ${rule}: ${count}`);
      }
    } else {
      console.log(green('No violations found.'));
    }
  }
}

// ── Rules test ──
async function rulesTest() {
  const syntheticSession = [
    // Turn 1: user message
    { role: 'user', content: 'Do something' },
    // Turn 2: assistant with message send missing target (channel-verify)
    { role: 'assistant', content: [{ type: 'tool_use', name: 'message', input: { action: 'send', message: 'hello' } }] },
    // Turn 3: assistant with sensitive data in message (sensitive-data)
    { role: 'assistant', content: [{ type: 'tool_use', name: 'message', input: { action: 'send', target: 'test', message: 'Here is the key: sk-1234567890abcdefghijklmnop' } }] },
    // Turn 4: config change without validate (config-safety)
    { role: 'assistant', content: [{ type: 'tool_use', name: 'config', input: { action: 'patch', data: {} } }] },
    // Turn 5: assistant says "noted" (memory-integrity — no write follows)
    { role: 'assistant', content: [{ type: 'text', text: 'Noted, I\'ll remember that.' }] },
    // Turn 6: filler
    { role: 'assistant', content: 'Thinking...' },
    // Turn 7: filler
    { role: 'assistant', content: 'Still thinking...' },
    // Turn 8: filler (memory promise should expire here)
    { role: 'assistant', content: 'Done thinking.' },
    // Turn 9: sub-agent completion (delivery-completion)
    { role: 'tool', content: 'Sub-agent completed: research task done', type: 'subagent_completion' },
    // Turns 10-14: no message send (delivery should expire)
    { role: 'assistant', content: 'Ok.' },
    { role: 'assistant', content: 'Processing.' },
    { role: 'assistant', content: 'Almost.' },
    { role: 'assistant', content: 'Hmm.' },
    { role: 'assistant', content: 'Moving on.' },
    // Turn 15: external action without confirmation (unbounded-external) — user message was turn 1, >3 turns ago
    { role: 'assistant', content: [{ type: 'tool_use', name: 'booking', input: { action: 'book', item: 'flight' } }] },
  ];

  // Write temp file
  const tmpPath = '/tmp/guardian-test-session.jsonl';
  const { writeFileSync, unlinkSync } = await import('fs');
  writeFileSync(tmpPath, syntheticSession.map(e => JSON.stringify(e)).join('\n') + '\n');

  const { violations } = await checkSession(tmpPath);
  try { unlinkSync(tmpPath); } catch {}

  const expected = ['channel-verify', 'sensitive-data', 'config-safety', 'memory-integrity', 'delivery-completion', 'unbounded-external'];
  const found = new Set(violations.map(v => v.rule));

  console.log(bold('\nGuardian Rules Test\n'));
  let allPass = true;
  for (const rule of expected) {
    const pass = found.has(rule);
    if (!pass) allPass = false;
    console.log(`  ${pass ? green('PASS') : red('FAIL')} ${rule}`);
  }
  console.log(`\n${allPass ? green('All tests passed!') : red('Some tests failed.')}`);
  if (!allPass) process.exit(1);
}

// ── Print violations ──
function printViolations(violations, totalTurns, sessionPath) {
  if (jsonMode) {
    console.log(JSON.stringify({ session: sessionPath, totalTurns, violations }, null, 2));
    return;
  }
  console.log(bold(`\nSession: ${sessionPath}`));
  console.log(`Turns analyzed: ${totalTurns}`);
  console.log(`Violations: ${violations.length}\n`);

  if (violations.length === 0) {
    console.log(green('No violations found.'));
    return;
  }

  for (const v of violations) {
    const color = v.severity === 'P0' ? red : v.severity === 'P1' ? yellow : dim;
    console.log(`  ${color(v.severity)} [turn ${v.turn}] ${bold(v.rule)}: ${v.message}`);
    console.log(`       ${dim(v.evidence)}`);
  }
}

// ── Usage ──
function usage() {
  console.log(`
${bold('guardian')} — Runtime policy enforcement for OpenClaw sessions

${bold('Commands:')}
  ${cyan('check session')} <path>    Analyze a session JSONL for policy violations
  ${cyan('check turn')} <json>       Check a single turn for violations
  ${cyan('rules')}                   List all enforced policies
  ${cyan('rules test')}              Run synthetic tests against all rules
  ${cyan('report')} [--days N]       Show violation trends (default: 7 days)
  ${cyan('scan-all')}                Scan all active session files

${bold('Flags:')}
  --json              Machine-readable JSON output
  --severity P0|P1|P2 Filter by minimum severity
  --limit N           Limit sessions to scan (scan-all)
  --days N            Report window in days (default: 7)
`);
}

// ── Main ──
async function main() {
  const cmd = positionalArgs[0];
  const sub = positionalArgs[1];

  if (!cmd) { usage(); process.exit(0); }

  if (cmd === 'check' && sub === 'session') {
    const path = positionalArgs[2];
    if (!path) { console.error(red('Usage: guardian check session <path>')); process.exit(1); }
    const { violations, totalTurns } = await checkSession(path);
    logViolations(violations, path);
    printViolations(violations, totalTurns, path);
  } else if (cmd === 'check' && sub === 'turn') {
    let turnJson = positionalArgs.slice(2).join(' ');
    if (!turnJson && !process.stdin.isTTY) {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      turnJson = Buffer.concat(chunks).toString();
    }
    if (!turnJson) { console.error(red('Usage: guardian check turn <json>')); process.exit(1); }
    const violations = checkTurn(turnJson);
    if (jsonMode) console.log(JSON.stringify({ violations }, null, 2));
    else {
      if (violations.length === 0) console.log(green('No violations.'));
      else for (const v of violations) {
        const color = v.severity === 'P0' ? red : v.severity === 'P1' ? yellow : dim;
        console.log(`  ${color(v.severity)} ${bold(v.rule)}: ${v.message}`);
      }
    }
  } else if (cmd === 'rules' && sub === 'test') {
    await rulesTest();
  } else if (cmd === 'rules') {
    if (jsonMode) { console.log(JSON.stringify(RULES, null, 2)); }
    else {
      console.log(bold('\nEnforced Policies\n'));
      for (const r of RULES) {
        const color = r.severity === 'P0' ? red : r.severity === 'P1' ? yellow : dim;
        console.log(`  ${color(r.severity)} ${bold(r.id)}`);
        console.log(`       ${r.description}`);
        console.log(`       ${dim('Checks: ' + r.checks)}\n`);
      }
    }
  } else if (cmd === 'report') {
    await report();
  } else if (cmd === 'scan-all') {
    await scanAll();
  } else {
    usage();
    process.exit(1);
  }
}

main().catch(e => { console.error(red(e.message)); process.exit(1); });

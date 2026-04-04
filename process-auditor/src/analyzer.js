import {
  parseSession, getMessageText, getSenderId,
  getToolCalls, getSpawnInfo, isDiscordSend,
} from './parser.js';
import {
  THEO_SENDER_ID, CORRECTION_PATTERNS, PROPOSAL_PATTERNS,
  MECHANICAL_TASK_PATTERNS, JUDGMENT_TASK_PATTERNS, SEVERITIES,
} from './constants.js';

/**
 * Analyze a single session file for process violations.
 * @param {string} sessionPath
 * @returns {Promise<Array<object>>} violations
 */
export async function analyzeSession(sessionPath) {
  const violations = [];
  const messages = []; // buffer of recent messages for lookahead/lookbehind

  // Collect all message entries (streaming but we need context windows)
  for await (const entry of parseSession(sessionPath)) {
    if (entry.type === 'message') {
      messages.push(entry);
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const entry = messages[i];
    const msg = entry.message;
    if (!msg) continue;

    // === FEEDBACK DETECTION ===
    if (msg.role === 'user') {
      const senderId = getSenderId(entry);
      if (senderId === THEO_SENDER_ID) {
        const text = getMessageText(entry);
        const isCorrection = CORRECTION_PATTERNS.some(p => p.test(text));
        if (isCorrection) {
          // Check next 3 assistant turns for feedback-agent spawn
          const found = checkSpawnInWindow(messages, i, 3, /feedback.agent/i);
          if (!found) {
            violations.push({
              timestamp: entry.timestamp || msg.timestamp,
              session: sessionPath,
              rule: 'feedback',
              severity: SEVERITIES.P0,
              description: 'Theo gave correction but feedback-agent was not spawned within 3 turns',
              evidence: truncate(text, 300),
            });
          }
        }
      }
    }

    // === QA DETECTION ===
    if (msg.role === 'assistant') {
      const toolCalls = getToolCalls(entry);
      const hasFileWrite = toolCalls.some(tc => {
        const name = tc.name || '';
        if (name !== 'write' && name !== 'edit') return false;
        const input = tc.input || {};
        const path = input.path || input.file_path || '';
        // Flag sensitive files
        return /AGENTS\.md|openclaw\.json|scripts\/|config/i.test(path) || path.endsWith('.sh');
      });

      if (hasFileWrite) {
        // Check for qa-agent spawn before next user message
        const found = checkSpawnInWindow(messages, i, 10, /qa.agent/i);
        if (!found) {
          const paths = toolCalls
            .filter(tc => tc.name === 'write' || tc.name === 'edit')
            .map(tc => (tc.input || {}).path || (tc.input || {}).file_path || 'unknown')
            .join(', ');
          violations.push({
            timestamp: entry.timestamp || msg.timestamp,
            session: sessionPath,
            rule: 'qa',
            severity: SEVERITIES.P1,
            description: `Wrote/edited sensitive files without QA agent: ${paths}`,
            evidence: truncate(paths, 300),
          });
        }
      }
    }

    // === COACHING DETECTION ===
    if (msg.role === 'assistant') {
      const text = getMessageText(entry);
      const isProposal = PROPOSAL_PATTERNS.some(p => p.test(text));
      if (isProposal) {
        // Check if coaching-agent was spawned BEFORE this message
        const found = checkSpawnInWindowBefore(messages, i, 10, /coaching.agent/i);
        if (!found) {
          violations.push({
            timestamp: entry.timestamp || msg.timestamp,
            session: sessionPath,
            rule: 'coaching',
            severity: SEVERITIES.P1,
            description: 'Presented proposal/architecture without running coaching agent first',
            evidence: truncate(text, 300),
          });
        }
      }
    }

    // === DELIVERY DETECTION ===
    if (msg.role === 'toolResult' || msg.role === 'tool') {
      const text = getMessageText(entry);
      // Detect sub-agent completion announcements
      const isCompletion = /sub.?agent.*(?:complete|finished|done)|completed.*task/i.test(text) ||
        (entry.toolName === 'sessions_spawn' && text.length > 50);

      if (isCompletion) {
        // Check if Discord message send happens within next 3 turns
        let delivered = false;
        for (let j = i + 1; j < Math.min(i + 6, messages.length); j++) {
          if (isDiscordSend(messages[j])) {
            delivered = true;
            break;
          }
        }
        if (!delivered) {
          violations.push({
            timestamp: entry.timestamp || msg.timestamp || '',
            session: sessionPath,
            rule: 'delivery',
            severity: SEVERITIES.P0,
            description: 'Sub-agent completed but results not posted to Discord',
            evidence: truncate(text, 300),
          });
        }
      }
    }

    // === MODEL COMPLIANCE ===
    if (msg.role === 'assistant') {
      const toolCalls = getToolCalls(entry);
      for (const tc of toolCalls) {
        const spawn = getSpawnInfo(tc);
        if (!spawn) continue;
        if (/sonnet/i.test(spawn.model)) {
          const task = spawn.task || spawn.label || '';
          const isMechanical = MECHANICAL_TASK_PATTERNS.some(p => p.test(task));
          const isJudgment = JUDGMENT_TASK_PATTERNS.some(p => p.test(task));
          if (isJudgment && !isMechanical) {
            violations.push({
              timestamp: entry.timestamp || msg.timestamp,
              session: sessionPath,
              rule: 'model-compliance',
              severity: SEVERITIES.P2,
              description: `Non-mechanical task spawned on Sonnet: "${truncate(task, 100)}"`,
              evidence: `model: ${spawn.model}, task: ${truncate(task, 200)}`,
            });
          }
        }
      }
    }
  }

  return violations;
}

function checkSpawnInWindow(messages, startIdx, window, pattern) {
  for (let j = startIdx + 1; j < Math.min(startIdx + 1 + window * 2, messages.length); j++) {
    const m = messages[j].message;
    if (!m) continue;
    if (m.role === 'assistant') {
      const calls = getToolCalls(messages[j]);
      for (const tc of calls) {
        const spawn = getSpawnInfo(tc);
        if (spawn && (pattern.test(spawn.task) || pattern.test(spawn.label))) return true;
        // Also check raw tool call for playbook references
        const input = tc.input || {};
        if (pattern.test(input.task || '') || pattern.test(JSON.stringify(input).substring(0, 500))) return true;
      }
    }
  }
  return false;
}

function checkSpawnInWindowBefore(messages, endIdx, window, pattern) {
  for (let j = Math.max(0, endIdx - window * 2); j < endIdx; j++) {
    const m = messages[j].message;
    if (!m || m.role !== 'assistant') continue;
    const calls = getToolCalls(messages[j]);
    for (const tc of calls) {
      const spawn = getSpawnInfo(tc);
      if (spawn && (pattern.test(spawn.task) || pattern.test(spawn.label))) return true;
      const input = tc.input || {};
      if (pattern.test(input.task || '') || pattern.test(JSON.stringify(input).substring(0, 500))) return true;
    }
  }
  return false;
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) + '...' : str;
}

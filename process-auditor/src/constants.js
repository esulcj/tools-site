import { homedir } from 'node:os';
import { join } from 'node:path';

export const SESSIONS_DIR = join(homedir(), '.openclaw/agents/main/sessions');
export const VIOLATIONS_PATH = join(homedir(), '.openclaw/workspace/tools/process-auditor/violations.jsonl');
export const THEO_SENDER_ID = '754662205684973601';

// Correction patterns Theo uses
export const CORRECTION_PATTERNS = [
  /you should/i,
  /why don['']t you/i,
  /stop doing/i,
  /that['']s wrong/i,
  /not like that/i,
  /do it this way/i,
  /don['']t do that/i,
  /wrong approach/i,
  /that['']s not right/i,
  /you need to/i,
  /please don['']t/i,
  /instead of doing/i,
];

// Proposal/architecture patterns
export const PROPOSAL_PATTERNS = [
  /here['']s (?:my |the )?(?:proposed |)(?:architecture|approach|plan|design|proposal)/i,
  /I (?:propose|recommend|suggest) (?:we |the following )/i,
  /(?:architecture|system design|implementation plan):/i,
  /here['']s how (?:I['']d|we should|I think we should)/i,
  /the (?:approach|plan|design) (?:is|would be)/i,
];

// Mechanical tasks safe for Sonnet
export const MECHANICAL_TASK_PATTERNS = [
  /format/i, /convert/i, /delivery/i, /upload/i, /cleanup/i,
  /log rotation/i, /health.?check/i, /extract/i, /grep/i,
];

// Non-mechanical tasks requiring Opus
export const JUDGMENT_TASK_PATTERNS = [
  /feedback.agent/i, /coaching/i, /debate/i, /research/i,
  /security/i, /architect/i, /review/i, /qa.agent/i,
  /analysis/i, /synthesis/i, /evaluate/i,
];

export const SEVERITIES = { P0: 'P0', P1: 'P1', P2: 'P2' };

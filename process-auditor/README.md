# process-auditor

CLI tool for tracking and enforcing agent process compliance in OpenClaw.

Scans session transcripts (`.jsonl`) for process gate violations: missed feedback agents, skipped QA, uncoached proposals, failed deliveries, and model misuse.

## Install

```bash
cd tools/process-auditor
npm link
```

## Usage

```bash
# Scan the most recent session
process-auditor scan

# Scan all sessions
process-auditor scan --all

# Scan a specific session
process-auditor scan --session ~/.openclaw/agents/main/sessions/abc123.jsonl

# JSON output
process-auditor scan --json

# Aggregate report for last 7 days
process-auditor report --days 7

# Watch active session in real-time
process-auditor watch
process-auditor watch --log /tmp/audit.log

# List all enforced rules
process-auditor rules
```

## Rules Enforced

| Rule | Severity | Description |
|------|----------|-------------|
| `feedback` | P0 | Theo's corrections must trigger feedback-agent within 3 turns |
| `qa` | P1 | File writes to sensitive paths must trigger qa-agent |
| `coaching` | P1 | Proposals/architecture must be preceded by coaching-agent |
| `delivery` | P0 | Sub-agent completions must be posted to Discord, not just narrated |
| `model-compliance` | P2 | Judgment tasks must not be spawned on Sonnet |

## Violations

Stored in `violations.jsonl` with structure:
```json
{
  "timestamp": "2026-03-08T...",
  "session": "/path/to/session.jsonl",
  "rule": "feedback",
  "severity": "P0",
  "description": "Theo gave correction but feedback-agent was not spawned within 3 turns",
  "evidence": "you should stop doing..."
}
```

## Architecture

- **Stream parsing** — `.jsonl` files parsed line-by-line, not loaded into memory
- **Zero dependencies** — Node.js built-ins only
- **Context-window analysis** — violations detected by examining surrounding turns (lookbehind/lookahead)

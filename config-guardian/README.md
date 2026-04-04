# config-guardian

Safe configuration management for OpenClaw gateway. Prevents the footguns that have bricked the gateway 3+ times.

## Install

```bash
cd ~/.openclaw/workspace/tools/config-guardian
npm link
```

## Commands

### `config-guardian validate [file]`
Deep schema validation beyond JSON syntax:
- Checks model IDs against known-good list
- Verifies agent array completeness (detects silently dropped agents)
- Validates required fields and structure
- Flags property changes on existing agents

```bash
config-guardian validate                    # validate live config
config-guardian validate ./my-config.json   # validate a file
config-guardian validate --json             # machine-readable output
```

### `config-guardian diff <patch.json>`
Preview exactly what a patch would change before applying:
- Shows added/removed/modified fields
- ID-aware array diffing (detects dropped agents by name)
- Highlights property changes on existing items

```bash
config-guardian diff my-patch.json
```

### `config-guardian apply <patch.json>`
Full safety pipeline: validate → backup → apply → health check.

```bash
config-guardian apply my-patch.json           # full apply
config-guardian apply my-patch.json --dry-run  # preview only, no writes
config-guardian apply my-patch.json --json     # machine output
```

### `config-guardian rollback [backup.json]`
Restore from the latest backup (or a specific one):

```bash
config-guardian rollback                              # latest backup
config-guardian rollback ~/.openclaw/workspace/config-backups/openclaw-2026-03-08T12-00-00.json
```

### `config-guardian history [--limit N]`
Show recent config changes with timestamps and change summaries.

### `config-guardian watch [--interval N]`
Monitor for unexpected config changes (drift detection). Validates new config on every change.

```bash
config-guardian watch                  # poll every 5s
config-guardian watch --interval 2000  # poll every 2s
config-guardian watch --json           # machine-readable events
```

### `config-guardian backups`
List available backups with timestamps.

### `config-guardian hash`
Set/update the config hash baseline for drift detection.

## Flags

| Flag | Description |
|------|-------------|
| `--json` | Machine-readable JSON output |
| `--dry-run` | Preview apply without writing |
| `--limit N` | Limit history entries (default: 20) |
| `--interval N` | Watch poll interval in ms (default: 5000) |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Validation failure |
| 2 | Application/runtime failure |

## Known Models

Edit `known-models.json` to update the list of valid model IDs. Always verify model IDs exist before adding them.

## How It Works

**The array replacement problem:** `config.patch` with arrays REPLACES the entire array. If you patch `agents.list` with 4 agents, the 5th silently disappears. config-guardian detects this by comparing agent IDs before/after.

**Model ID validation:** Wrong model IDs brick all channels. config-guardian checks every model reference against a known-good list.

**Automatic backups:** Every `apply` creates a timestamped backup in `~/.openclaw/workspace/config-backups/`. Rollback is one command away.

## Storage

- Backups: `~/.openclaw/workspace/config-backups/`
- History: `~/.openclaw/workspace/config-backups/history.jsonl`
- Hash baseline: `~/.openclaw/workspace/config-backups/.config-hash`
- Known models: `known-models.json` (in tool directory)

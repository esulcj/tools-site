# memory-engine

Structured memory management CLI for OpenClaw agents.

## Install

```bash
cd tools/memory-engine
npm link
```

## Commands

| Command | Description |
|---------|-------------|
| `memory-engine status` | Overview: file count, size, staleness |
| `memory-engine scan` | Find duplicates, stale files, orphans, bloat |
| `memory-engine distill [--dry-run]` | Extract insights from daily files → MEMORY.md |
| `memory-engine prune [--dry-run]` | Deduplicate and trim MEMORY.md |
| `memory-engine search <query>` | Relevance-scored search across all memory |
| `memory-engine index` | Build fact index (JSON) |

## Options

- `--json` — JSON output
- `--dry-run` — Preview changes without modifying files

## How it works

- **Similarity:** Cosine similarity on term-frequency vectors (no external APIs)
- **Non-destructive:** `--dry-run` default mentality; distill archives files, never deletes
- **Index:** Stored at `tools/memory-engine/index.json`

## Memory structure

```
~/.openclaw/workspace/
├── MEMORY.md              # Long-term memory (target: <200 lines)
└── memory/
    ├── 2026-03-05.md      # Daily files
    ├── infra-lessons.md   # Topic files
    └── archive/           # Archived daily files
```

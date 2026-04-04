import { homedir } from 'node:os';
import { join } from 'node:path';

export const WORKSPACE = join(homedir(), '.openclaw', 'workspace');
export const MEMORY_FILE = join(WORKSPACE, 'MEMORY.md');
export const MEMORY_DIR = join(WORKSPACE, 'memory');
export const ARCHIVE_DIR = join(MEMORY_DIR, 'archive');
export const INDEX_FILE = join(WORKSPACE, 'tools', 'memory-engine', 'index.json');
export const DAILY_PATTERN = /^\d{4}-\d{2}-\d{2}/;
export const STALE_DAYS = 7;
export const MAX_MEMORY_LINES = 200;

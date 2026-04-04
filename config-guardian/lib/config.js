import { homedir } from 'os';
import { join } from 'path';

export const OPENCLAW_DIR = join(homedir(), '.openclaw');
export const CONFIG_PATH = join(OPENCLAW_DIR, 'openclaw.json');
export const BACKUP_DIR = join(homedir(), '.openclaw', 'workspace', 'config-backups');
export const KNOWN_MODELS_PATH = new URL('../known-models.json', import.meta.url).pathname;
export const HISTORY_PATH = join(BACKUP_DIR, 'history.jsonl');
export const HASH_PATH = join(BACKUP_DIR, '.config-hash');
export const GATEWAY_PORT = 18789;

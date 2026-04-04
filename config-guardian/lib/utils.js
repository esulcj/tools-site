import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { BACKUP_DIR, CONFIG_PATH, KNOWN_MODELS_PATH, HISTORY_PATH, HASH_PATH } from './config.js';

// ── Colors (no dependencies) ──
const c = (code) => (s) => process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s;
export const red = c('31');
export const green = c('32');
export const yellow = c('33');
export const cyan = c('36');
export const dim = c('2');
export const bold = c('1');

// ── File I/O ──
export function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadConfig() {
  return readJSON(CONFIG_PATH);
}

export function loadKnownModels() {
  return readJSON(KNOWN_MODELS_PATH);
}

export function ensureBackupDir() {
  mkdirSync(BACKUP_DIR, { recursive: true });
}

// ── Hashing ──
export function hashJSON(obj) {
  return createHash('sha256').update(JSON.stringify(obj, null, 2)).digest('hex');
}

// ── Backup ──
export function createBackup(config, reason = 'manual') {
  ensureBackupDir();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `${BACKUP_DIR}/openclaw-${ts}.json`;
  writeFileSync(path, JSON.stringify(config, null, 2));
  return path;
}

export function getLatestBackup() {
  ensureBackupDir();
  const files = readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('openclaw-') && f.endsWith('.json'))
    .sort()
    .reverse();
  return files.length ? `${BACKUP_DIR}/${files[0]}` : null;
}

export function listBackups() {
  ensureBackupDir();
  return readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('openclaw-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .map(f => ({
      file: f,
      path: `${BACKUP_DIR}/${f}`,
      time: statSync(`${BACKUP_DIR}/${f}`).mtime,
    }));
}

// ── History ──
export function appendHistory(entry) {
  ensureBackupDir();
  const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() });
  writeFileSync(HISTORY_PATH, line + '\n', { flag: 'a' });
}

export function readHistory(limit = 20) {
  if (!existsSync(HISTORY_PATH)) return [];
  const lines = readFileSync(HISTORY_PATH, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(-limit).map(l => JSON.parse(l)).reverse();
}

// ── Hash store (for drift detection) ──
export function getStoredHash() {
  if (!existsSync(HASH_PATH)) return null;
  return readFileSync(HASH_PATH, 'utf8').trim();
}

export function storeHash(hash) {
  ensureBackupDir();
  writeFileSync(HASH_PATH, hash);
}

// ── Deep merge (patch semantics — arrays REPLACE, objects merge) ──
export function deepMerge(target, patch) {
  const result = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      result[key] = deepMerge(target[key], value);
    } else {
      result[key] = structuredClone(value);
    }
  }
  return result;
}

// ── Output formatting ──
export function output(data, jsonMode) {
  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2));
  }
  // Human output is handled by callers
}

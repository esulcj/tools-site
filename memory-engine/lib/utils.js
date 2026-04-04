import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { MEMORY_FILE, MEMORY_DIR, DAILY_PATTERN } from './config.js';

/** Recursively find all .md files in memory dir (excluding archive) */
export async function getMemoryFiles() {
  const files = [];
  
  // MEMORY.md
  try {
    const s = await stat(MEMORY_FILE);
    files.push({ path: MEMORY_FILE, name: 'MEMORY.md', stat: s });
  } catch {}

  // memory/*.md (non-recursive, skip archive)
  try {
    const entries = await readdir(MEMORY_DIR, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === 'archive' || e.name.startsWith('.')) continue;
      const p = join(MEMORY_DIR, e.name);
      if (e.isFile() && extname(e.name) === '.md') {
        const s = await stat(p);
        files.push({ path: p, name: e.name, stat: s });
      }
    }
  } catch {}

  return files;
}

/** Get daily files (YYYY-MM-DD*.md pattern) */
export async function getDailyFiles() {
  const all = await getMemoryFiles();
  return all.filter(f => DAILY_PATTERN.test(f.name));
}

/** Read file content */
export async function readContent(filepath) {
  return readFile(filepath, 'utf-8');
}

/** Tokenize text into words for similarity */
export function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

/** Build term frequency vector */
export function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

/** Cosine similarity between two TF maps */
export function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (const [k, v] of a) {
    magA += v * v;
    if (b.has(k)) dot += v * b.get(k);
  }
  for (const [, v] of b) magB += v * v;
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/** Extract bullet points / facts from markdown */
export function extractFacts(content) {
  const facts = [];
  const lines = content.split('\n');
  let currentSection = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#')) {
      currentSection = line.replace(/^#+\s*/, '').trim();
    } else if (line.match(/^\s*[-*]\s+.+/)) {
      facts.push({
        text: line.replace(/^\s*[-*]\s+/, '').trim(),
        section: currentSection,
        line: i + 1,
      });
    }
  }
  return facts;
}

/** Format bytes */
export function fmtBytes(b) {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / (1024 * 1024)).toFixed(1)}MB`;
}

/** Days ago */
export function daysAgo(date) {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

/** Format output for human or JSON mode */
export function formatOutput(data, humanFn, jsonMode) {
  if (jsonMode) return JSON.stringify(data, null, 2);
  return humanFn(data);
}

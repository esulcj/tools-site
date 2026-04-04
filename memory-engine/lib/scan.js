import { readContent, getMemoryFiles, getDailyFiles, extractFacts, tokenize, termFreq, cosineSimilarity, daysAgo, formatOutput } from './utils.js';
import { STALE_DAYS, MEMORY_FILE } from './config.js';
import { access } from 'node:fs/promises';

const DUPE_THRESHOLD = 0.85;

export async function scan({ jsonMode }) {
  const files = await getMemoryFiles();
  const dailyFiles = await getDailyFiles();

  // Load all facts from all files
  const allFacts = [];
  for (const f of files) {
    const content = await readContent(f.path);
    const facts = extractFacts(content);
    for (const fact of facts) {
      allFacts.push({ ...fact, file: f.name, path: f.path });
    }
  }

  // Duplicates: compare all fact pairs
  const duplicates = [];
  const tfCache = allFacts.map(f => termFreq(tokenize(f.text)));
  for (let i = 0; i < allFacts.length; i++) {
    for (let j = i + 1; j < allFacts.length; j++) {
      if (allFacts[i].file === allFacts[j].file && allFacts[i].line === allFacts[j].line) continue;
      const sim = cosineSimilarity(tfCache[i], tfCache[j]);
      if (sim >= DUPE_THRESHOLD) {
        duplicates.push({
          similarity: Math.round(sim * 100),
          a: { file: allFacts[i].file, line: allFacts[i].line, text: allFacts[i].text },
          b: { file: allFacts[j].file, line: allFacts[j].line, text: allFacts[j].text },
        });
      }
    }
  }

  // Stale daily files
  const stale = dailyFiles.filter(f => {
    const m = f.name.match(/^(\d{4}-\d{2}-\d{2})/);
    return m && daysAgo(new Date(m[1])) > STALE_DAYS;
  }).map(f => f.name);

  // Orphan path references
  const orphans = [];
  for (const f of files) {
    const content = await readContent(f.path);
    const refs = content.match(/(?:~\/\.openclaw\/workspace\/|workspace\/)[\w/._-]+/g) || [];
    for (const ref of refs) {
      const resolved = ref.replace('~/.openclaw/workspace/', '/Users/theclaw/.openclaw/workspace/')
        .replace(/^workspace\//, '/Users/theclaw/.openclaw/workspace/');
      try {
        await access(resolved);
      } catch {
        orphans.push({ file: f.name, reference: ref });
      }
    }
  }

  // Bloat: MEMORY.md sections by line count
  const bloat = [];
  try {
    const content = await readContent(MEMORY_FILE);
    const lines = content.split('\n');
    let section = '', start = 0, count = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) {
        if (section && count > 15) bloat.push({ section, lines: count });
        section = lines[i].replace(/^##\s*/, '');
        start = i; count = 0;
      } else { count++; }
    }
    if (section && count > 15) bloat.push({ section, lines: count });
  } catch {}

  const data = { duplicates, stale, orphans, bloat };

  return formatOutput(data, d => {
    const out = ['🔍 Memory Scan Results\n'];
    out.push(`Duplicates: ${d.duplicates.length}`);
    for (const dup of d.duplicates.slice(0, 10)) {
      out.push(`  ${dup.similarity}% | ${dup.a.file}:${dup.a.line} ↔ ${dup.b.file}:${dup.b.line}`);
      out.push(`    "${dup.a.text.slice(0, 80)}"`);
    }
    out.push(`\nStale daily files: ${d.stale.length}`);
    for (const s of d.stale) out.push(`  📅 ${s}`);
    out.push(`\nOrphan references: ${d.orphans.length}`);
    for (const o of d.orphans) out.push(`  ❌ ${o.file}: ${o.reference}`);
    out.push(`\nBloated sections (>15 lines):`);
    for (const b of d.bloat) out.push(`  📏 ${b.section}: ${b.lines} lines`);
    return out.join('\n');
  }, jsonMode);
}

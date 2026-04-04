import { readContent, extractFacts, tokenize, termFreq, cosineSimilarity, formatOutput } from './utils.js';
import { MEMORY_FILE, MAX_MEMORY_LINES } from './config.js';
import { writeFile } from 'node:fs/promises';

const DUPE_THRESHOLD = 0.85;
const CONSOLIDATION_THRESHOLD = 0.6;

export async function prune({ dryRun, jsonMode }) {
  let content;
  try { content = await readContent(MEMORY_FILE); } catch {
    return formatOutput({ error: 'MEMORY.md not found' }, () => '❌ MEMORY.md not found', jsonMode);
  }

  const lines = content.split('\n');
  const facts = extractFacts(content);
  const tfCache = facts.map(f => termFreq(tokenize(f.text)));

  // Find duplicates
  const duplicates = [];
  const removableLines = new Set();
  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      const sim = cosineSimilarity(tfCache[i], tfCache[j]);
      if (sim >= DUPE_THRESHOLD) {
        // Keep the longer (more detailed) one
        const shorter = facts[i].text.length <= facts[j].text.length ? i : j;
        duplicates.push({
          keep: facts[shorter === i ? j : i].text.slice(0, 80),
          remove: facts[shorter].text.slice(0, 80),
          similarity: Math.round(sim * 100),
          removeLine: facts[shorter].line,
        });
        removableLines.add(facts[shorter].line);
      }
    }
  }

  // Find consolidation candidates (moderately similar facts in same section)
  const consolidations = [];
  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      if (facts[i].section !== facts[j].section) continue;
      if (removableLines.has(facts[i].line) || removableLines.has(facts[j].line)) continue;
      const sim = cosineSimilarity(tfCache[i], tfCache[j]);
      if (sim >= CONSOLIDATION_THRESHOLD && sim < DUPE_THRESHOLD) {
        consolidations.push({
          section: facts[i].section,
          a: facts[i].text.slice(0, 80),
          b: facts[j].text.slice(0, 80),
          similarity: Math.round(sim * 100),
        });
      }
    }
  }

  const lineCount = lines.length;
  const overTarget = Math.max(0, lineCount - MAX_MEMORY_LINES);

  // Apply if not dry run
  if (!dryRun && removableLines.size > 0) {
    const newLines = lines.filter((_, i) => !removableLines.has(i + 1));
    await writeFile(MEMORY_FILE, newLines.join('\n'));
  }

  const data = {
    lineCount,
    targetLines: MAX_MEMORY_LINES,
    overTarget,
    duplicates,
    consolidations: consolidations.slice(0, 10),
    linesRemoved: dryRun ? 0 : removableLines.size,
    dryRun,
  };

  return formatOutput(data, d => {
    const out = [`✂️  Prune ${d.dryRun ? '(DRY RUN)' : 'Complete'}\n`];
    out.push(`MEMORY.md: ${d.lineCount} lines (target: ${d.targetLines}, over by ${d.overTarget})`);
    out.push(`\nDuplicates found: ${d.duplicates.length}`);
    for (const dup of d.duplicates.slice(0, 10)) {
      out.push(`  🗑  Remove: "${dup.remove}" (${dup.similarity}% match)`);
    }
    out.push(`\nConsolidation candidates: ${d.consolidations.length}`);
    for (const c of d.consolidations.slice(0, 5)) {
      out.push(`  🔗 [${c.section}] "${c.a}" + "${c.b}"`);
    }
    if (!d.dryRun) out.push(`\n📝 Removed ${d.linesRemoved} duplicate lines`);
    return out.join('\n');
  }, jsonMode);
}

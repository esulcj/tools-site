import { readContent, getDailyFiles, extractFacts, tokenize, termFreq, cosineSimilarity, formatOutput } from './utils.js';
import { MEMORY_FILE, ARCHIVE_DIR } from './config.js';
import { appendFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const MATCH_THRESHOLD = 0.75;

export async function distill({ dryRun, jsonMode }) {
  const dailyFiles = await getDailyFiles();
  if (!dailyFiles.length) {
    return formatOutput({ newInsights: [], alreadyCaptured: [], archived: [] },
      () => '✅ No daily files to distill.', jsonMode);
  }

  // Load MEMORY.md facts
  let memoryContent = '';
  let memoryFacts = [];
  try {
    memoryContent = await readContent(MEMORY_FILE);
    memoryFacts = extractFacts(memoryContent);
  } catch {}
  const memoryTFs = memoryFacts.map(f => termFreq(tokenize(f.text)));

  const newInsights = [];
  const alreadyCaptured = [];
  const archived = [];

  for (const df of dailyFiles) {
    const content = await readContent(df.path);
    const facts = extractFacts(content);

    for (const fact of facts) {
      const factTF = termFreq(tokenize(fact.text));
      let bestSim = 0;
      let bestMatch = null;
      for (let i = 0; i < memoryFacts.length; i++) {
        const sim = cosineSimilarity(factTF, memoryTFs[i]);
        if (sim > bestSim) { bestSim = sim; bestMatch = memoryFacts[i]; }
      }

      if (bestSim >= MATCH_THRESHOLD) {
        alreadyCaptured.push({
          fact: fact.text,
          source: df.name,
          matchedTo: bestMatch.text,
          similarity: Math.round(bestSim * 100),
        });
      } else if (fact.text.length > 10) {
        newInsights.push({
          fact: fact.text,
          source: df.name,
          section: fact.section || 'Uncategorized',
          bestExistingSim: Math.round(bestSim * 100),
        });
      }
    }

    archived.push(df.name);
  }

  // Apply changes if not dry run
  if (!dryRun && newInsights.length) {
    // Group by section and append to MEMORY.md
    const bySection = new Map();
    for (const insight of newInsights) {
      const sec = insight.section || 'Distilled Notes';
      if (!bySection.has(sec)) bySection.set(sec, []);
      bySection.get(sec).push(insight.fact);
    }

    let appendText = '\n\n## Distilled Notes (' + new Date().toISOString().slice(0, 10) + ')\n';
    for (const [section, facts] of bySection) {
      appendText += `\n### ${section}\n`;
      for (const f of facts) appendText += `- ${f}\n`;
    }

    await appendFile(MEMORY_FILE, appendText);

    // Archive daily files
    await mkdir(ARCHIVE_DIR, { recursive: true });
    for (const df of dailyFiles) {
      const dest = join(ARCHIVE_DIR, df.name);
      await rename(df.path, dest);
    }
  }

  const data = { newInsights, alreadyCaptured, archived, dryRun };

  return formatOutput(data, d => {
    const out = [`🧪 Distillation ${d.dryRun ? '(DRY RUN)' : 'Complete'}\n`];
    out.push(`New insights: ${d.newInsights.length}`);
    for (const n of d.newInsights.slice(0, 15)) {
      out.push(`  ✨ [${n.source}] ${n.fact.slice(0, 100)}`);
    }
    out.push(`\nAlready captured: ${d.alreadyCaptured.length}`);
    for (const a of d.alreadyCaptured.slice(0, 5)) {
      out.push(`  ✓ ${a.fact.slice(0, 60)} (${a.similarity}% match)`);
    }
    out.push(`\nFiles to archive: ${d.archived.length}`);
    if (!d.dryRun && d.newInsights.length) out.push(`\n📝 Appended ${d.newInsights.length} insights to MEMORY.md`);
    return out.join('\n');
  }, jsonMode);
}

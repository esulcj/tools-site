import { readContent, getMemoryFiles, tokenize, termFreq, cosineSimilarity, formatOutput } from './utils.js';

export async function search(query, { jsonMode }) {
  const files = await getMemoryFiles();
  const queryTF = termFreq(tokenize(query));
  const queryTokens = new Set(tokenize(query));
  const results = [];

  for (const f of files) {
    const content = await readContent(f.path);
    const lines = content.split('\n');
    let currentSection = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('#')) {
        currentSection = line.replace(/^#+\s*/, '').trim();
        continue;
      }
      if (line.trim().length < 5) continue;

      const lineTF = termFreq(tokenize(line));
      const sim = cosineSimilarity(queryTF, lineTF);
      if (sim < 0.15) continue;

      // Boost exact token matches
      const lineTokens = tokenize(line);
      const exactMatches = lineTokens.filter(t => queryTokens.has(t)).length;
      const score = sim * 0.7 + (exactMatches / Math.max(queryTokens.size, 1)) * 0.3;

      // Context: surrounding lines
      const ctxStart = Math.max(0, i - 1);
      const ctxEnd = Math.min(lines.length - 1, i + 1);
      const context = lines.slice(ctxStart, ctxEnd + 1).join('\n');

      results.push({
        file: f.name,
        line: i + 1,
        section: currentSection,
        text: line.trim(),
        score: Math.round(score * 1000) / 1000,
        context,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, 20);

  return formatOutput(top, items => {
    if (!items.length) return '🔍 No results found.';
    const out = [`🔍 Search: "${query}" — ${items.length} results\n`];
    for (const r of items) {
      out.push(`  [${r.score}] ${r.file}:${r.line} (${r.section})`);
      out.push(`    ${r.text.slice(0, 120)}`);
    }
    return out.join('\n');
  }, jsonMode);
}

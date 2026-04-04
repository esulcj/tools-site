import { readContent, getMemoryFiles, extractFacts, formatOutput } from './utils.js';
import { INDEX_FILE } from './config.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function buildIndex({ jsonMode }) {
  const files = await getMemoryFiles();
  const index = { built: new Date().toISOString(), facts: [], fileMap: {} };

  for (const f of files) {
    const content = await readContent(f.path);
    const facts = extractFacts(content);
    index.fileMap[f.name] = { size: f.stat.size, factCount: facts.length };

    for (const fact of facts) {
      index.facts.push({
        text: fact.text,
        section: fact.section,
        file: f.name,
        line: fact.line,
      });
    }
  }

  await mkdir(dirname(INDEX_FILE), { recursive: true });
  await writeFile(INDEX_FILE, JSON.stringify(index, null, 2));

  const data = {
    totalFacts: index.facts.length,
    totalFiles: files.length,
    indexPath: INDEX_FILE,
  };

  return formatOutput(data, d => {
    return `📇 Index built: ${d.totalFacts} facts from ${d.totalFiles} files\n  Saved to: ${d.indexPath}`;
  }, jsonMode);
}

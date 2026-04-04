import { readContent, getMemoryFiles, getDailyFiles, fmtBytes, daysAgo, formatOutput } from './utils.js';
import { MEMORY_FILE, STALE_DAYS } from './config.js';

export async function status({ jsonMode }) {
  const files = await getMemoryFiles();
  const dailyFiles = await getDailyFiles();
  const totalSize = files.reduce((s, f) => s + f.stat.size, 0);

  let memoryLines = 0;
  try {
    const content = await readContent(MEMORY_FILE);
    memoryLines = content.split('\n').length;
  } catch {}

  const staleDaily = dailyFiles.filter(f => {
    const match = f.name.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!match) return false;
    return daysAgo(new Date(match[1])) > STALE_DAYS;
  });

  const data = {
    fileCount: files.length,
    totalSize,
    totalSizeFormatted: fmtBytes(totalSize),
    memoryLines,
    dailyFileCount: dailyFiles.length,
    staleFileCount: staleDaily.length,
    staleFiles: staleDaily.map(f => f.name),
    files: files.map(f => ({ name: f.name, size: f.stat.size })),
  };

  return formatOutput(data, d => {
    const lines = [
      `📊 Memory Status`,
      `  Files: ${d.fileCount} (${d.totalSizeFormatted} total)`,
      `  MEMORY.md: ${d.memoryLines} lines`,
      `  Daily files: ${d.dailyFileCount} (${d.staleFileCount} stale > ${STALE_DAYS}d)`,
    ];
    if (d.staleFiles.length) {
      lines.push(`  Stale: ${d.staleFiles.join(', ')}`);
    }
    return lines.join('\n');
  }, jsonMode);
}

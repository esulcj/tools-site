import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { VIOLATIONS_PATH } from './constants.js';

export async function report({ days = 7, json = false } = {}) {
  if (!existsSync(VIOLATIONS_PATH)) {
    if (json) {
      console.log(JSON.stringify({ message: 'No violations recorded yet. Run "process-auditor scan" first.' }));
    } else {
      console.log('No violations recorded yet. Run "process-auditor scan" first.');
    }
    return;
  }

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const violations = [];

  const rl = createInterface({
    input: createReadStream(VIOLATIONS_PATH, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (v.timestamp >= cutoff) violations.push(v);
    } catch { /* skip */ }
  }

  // Stats
  const byRule = {};
  const bySeverity = { P0: 0, P1: 0, P2: 0 };
  const byDay = {};

  for (const v of violations) {
    byRule[v.rule] = (byRule[v.rule] || 0) + 1;
    bySeverity[v.severity] = (bySeverity[v.severity] || 0) + 1;
    const day = v.timestamp ? v.timestamp.substring(0, 10) : 'unknown';
    byDay[day] = (byDay[day] || 0) + 1;
  }

  if (json) {
    console.log(JSON.stringify({ days, total: violations.length, byRule, bySeverity, byDay, violations }, null, 2));
  } else {
    console.log(`\nViolation Report — Last ${days} day(s)\n${'='.repeat(45)}`);
    console.log(`Total violations: ${violations.length}\n`);

    console.log('By Severity:');
    for (const [sev, count] of Object.entries(bySeverity)) {
      if (count > 0) console.log(`  ${sev}: ${count}`);
    }

    console.log('\nBy Rule:');
    for (const [rule, count] of Object.entries(byRule)) {
      console.log(`  ${rule}: ${count}`);
    }

    console.log('\nBy Day:');
    for (const [day, count] of Object.entries(byDay).sort()) {
      const bar = '█'.repeat(Math.min(count, 40));
      console.log(`  ${day}: ${bar} ${count}`);
    }

    // Trend
    const days_arr = Object.entries(byDay).sort();
    if (days_arr.length >= 2) {
      const first_half = days_arr.slice(0, Math.floor(days_arr.length / 2));
      const second_half = days_arr.slice(Math.floor(days_arr.length / 2));
      const avg1 = first_half.reduce((s, [, c]) => s + c, 0) / first_half.length;
      const avg2 = second_half.reduce((s, [, c]) => s + c, 0) / second_half.length;
      const trend = avg2 > avg1 ? '📈 Increasing' : avg2 < avg1 ? '📉 Decreasing' : '→ Stable';
      console.log(`\nTrend: ${trend} (${avg1.toFixed(1)} → ${avg2.toFixed(1)} violations/day)`);
    }
  }
}

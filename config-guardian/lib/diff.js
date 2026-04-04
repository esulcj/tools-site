import { red, green, yellow, cyan, dim, bold, deepMerge } from './utils.js';

/**
 * Compute a structured diff between two config objects.
 * Returns { changes: Array<{ path, type, old, new }> }
 */
export function computeDiff(current, patched, prefix = '') {
  const changes = [];

  const allKeys = new Set([
    ...Object.keys(current || {}),
    ...Object.keys(patched || {}),
  ]);

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const a = current?.[key];
    const b = patched?.[key];

    if (a === undefined && b !== undefined) {
      changes.push({ path, type: 'added', old: undefined, new: b });
    } else if (a !== undefined && b === undefined) {
      changes.push({ path, type: 'removed', old: a, new: undefined });
    } else if (Array.isArray(a) && Array.isArray(b)) {
      // Arrays: show item-level diff for agent lists
      const arrayChanges = diffArrays(a, b, path);
      changes.push(...arrayChanges);
    } else if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && !Array.isArray(a)) {
      changes.push(...computeDiff(a, b, path));
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ path, type: 'changed', old: a, new: b });
    }
  }

  return changes;
}

function diffArrays(a, b, path) {
  const changes = [];

  // Try to match by 'id' field (for agents.list etc.)
  const aHasIds = a.every(item => item && typeof item === 'object' && item.id);
  const bHasIds = b.every(item => item && typeof item === 'object' && item.id);

  if (aHasIds && bHasIds) {
    const aMap = new Map(a.map(item => [item.id, item]));
    const bMap = new Map(b.map(item => [item.id, item]));

    for (const [id, item] of aMap) {
      if (!bMap.has(id)) {
        changes.push({ path: `${path}[id=${id}]`, type: 'removed', old: item, new: undefined });
      } else {
        const subChanges = computeDiff(item, bMap.get(id), `${path}[id=${id}]`);
        changes.push(...subChanges);
      }
    }
    for (const [id, item] of bMap) {
      if (!aMap.has(id)) {
        changes.push({ path: `${path}[id=${id}]`, type: 'added', old: undefined, new: item });
      }
    }
  } else {
    // No ID-based matching — compare as whole
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ path, type: 'changed', old: a, new: b });
    }
  }

  return changes;
}

/**
 * Preview what a patch would do to the current config.
 */
export function previewPatch(current, patch) {
  const merged = deepMerge(current, patch);
  return computeDiff(current, merged);
}

export function printDiff(changes, jsonMode) {
  if (jsonMode) {
    console.log(JSON.stringify(changes, null, 2));
    return;
  }

  if (changes.length === 0) {
    console.log(dim('  No changes detected.'));
    return;
  }

  console.log(bold(`\n  ${changes.length} change(s):\n`));

  for (const ch of changes) {
    const path = cyan(ch.path);
    switch (ch.type) {
      case 'added':
        console.log(green(`  + ${ch.path}`));
        console.log(green(`    ${formatValue(ch.new)}`));
        break;
      case 'removed':
        console.log(red(`  - ${ch.path}`));
        console.log(red(`    ${formatValue(ch.old)}`));
        break;
      case 'changed':
        console.log(yellow(`  ~ ${ch.path}`));
        console.log(red(`    - ${formatValue(ch.old)}`));
        console.log(green(`    + ${formatValue(ch.new)}`));
        break;
    }
  }
  console.log('');
}

function formatValue(v) {
  if (v === undefined) return 'undefined';
  if (typeof v === 'object') {
    const s = JSON.stringify(v, null, 2);
    return s.length > 200 ? s.slice(0, 200) + '...' : s;
  }
  return String(v);
}

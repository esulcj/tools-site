import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { CONFIG_PATH, GATEWAY_PORT } from './config.js';
import { loadConfig, createBackup, deepMerge, appendHistory, hashJSON, storeHash, red, green, yellow, bold } from './utils.js';
import { validateConfig, printValidation } from './validate.js';
import { previewPatch, printDiff } from './diff.js';

/**
 * Apply a patch to the config with full safety checks.
 */
export async function applyPatch(patch, opts = {}) {
  const { jsonMode = false, dryRun = false, skipHealth = false } = opts;
  const result = { ok: false, backup: null, errors: [], warnings: [] };

  // 1. Load current config
  let current;
  try {
    current = loadConfig();
  } catch (e) {
    result.errors.push(`Cannot read current config: ${e.message}`);
    return printResult(result, jsonMode);
  }

  // 2. Compute merged result
  const merged = deepMerge(current, patch);

  // 3. Show diff
  const changes = previewPatch(current, patch);
  if (!jsonMode) {
    console.log(bold('\n📋 Changes to apply:'));
    printDiff(changes, false);
  }

  if (changes.length === 0) {
    if (!jsonMode) console.log(green('  No changes to apply.'));
    result.ok = true;
    return printResult(result, jsonMode);
  }

  // 4. Validate merged config
  const validation = validateConfig(merged, { currentConfig: current });
  if (!validation.ok) {
    result.errors = validation.errors;
    result.warnings = validation.warnings;
    if (!jsonMode) {
      console.log(bold(red('\n❌ Validation failed — NOT applying patch:')));
      printValidation(validation, false);
    }
    return printResult(result, jsonMode);
  }
  if (validation.warnings.length && !jsonMode) {
    printValidation(validation, false);
  }

  // 5. Dry run stops here
  if (dryRun) {
    if (!jsonMode) console.log(yellow('\n🔍 Dry run — no changes applied.\n'));
    result.ok = true;
    result.warnings = validation.warnings;
    return printResult(result, jsonMode);
  }

  // 6. Create backup
  const backupPath = createBackup(current, 'pre-apply');
  result.backup = backupPath;
  if (!jsonMode) console.log(green(`  📋 Backup: ${backupPath}`));

  // 7. Write merged config
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2) + '\n');
    if (!jsonMode) console.log(green('  ✅ Config written.'));
  } catch (e) {
    result.errors.push(`Failed to write config: ${e.message}`);
    return printResult(result, jsonMode);
  }

  // 8. Update hash
  storeHash(hashJSON(merged));

  // 9. Record history
  appendHistory({
    action: 'apply',
    changes: changes.map(c => ({ path: c.path, type: c.type })),
    backup: backupPath,
  });

  // 10. Health check (optional)
  if (!skipHealth) {
    if (!jsonMode) console.log(yellow('\n  ⏳ Running post-apply health check...'));
    const healthy = await checkGatewayHealth();
    if (!healthy) {
      result.warnings.push('Gateway health check failed or gateway not reachable — verify manually');
      if (!jsonMode) console.log(yellow('  ⚠️  Gateway health check inconclusive. Config written but verify manually.'));
    } else {
      if (!jsonMode) console.log(green('  ✅ Gateway healthy.'));
    }
  }

  result.ok = true;
  result.warnings = validation.warnings;
  return printResult(result, jsonMode);
}

async function checkGatewayHealth() {
  try {
    const res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    // Try openclaw status as fallback
    try {
      execSync('openclaw status', { timeout: 10000, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}

function printResult(result, jsonMode) {
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  }
  return result;
}

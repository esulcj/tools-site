import { writeFileSync } from 'fs';
import { CONFIG_PATH } from './config.js';
import { getLatestBackup, readJSON, createBackup, appendHistory, hashJSON, storeHash, red, green, yellow, dim } from './utils.js';

export function rollback(opts = {}) {
  const { jsonMode = false, target = null } = opts;

  const backupPath = target || getLatestBackup();

  if (!backupPath) {
    const msg = 'No backup found to rollback to.';
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.log(red(`\n❌ ${msg}\n`));
    return false;
  }

  try {
    const currentConfig = readJSON(CONFIG_PATH);
    const safePath = createBackup(currentConfig, 'pre-rollback');

    const backup = readJSON(backupPath);
    writeFileSync(CONFIG_PATH, JSON.stringify(backup, null, 2) + '\n');
    storeHash(hashJSON(backup));

    appendHistory({ action: 'rollback', from: safePath, to: backupPath });

    if (jsonMode) {
      console.log(JSON.stringify({ ok: true, restoredFrom: backupPath, safetyBackup: safePath }));
    } else {
      console.log(green(`\n✅ Rolled back to: ${backupPath}`));
      console.log(dim(`   Pre-rollback saved to: ${safePath}`));
      console.log(yellow(`\n   ⚠️  Restart the gateway for changes to take effect.\n`));
    }
    return true;
  } catch (e) {
    const msg = `Rollback failed: ${e.message}`;
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.log(red(`\n❌ ${msg}\n`));
    return false;
  }
}

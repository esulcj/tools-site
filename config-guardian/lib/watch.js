import { watchFile, readFileSync } from 'fs';
import { CONFIG_PATH } from './config.js';
import { hashJSON, getStoredHash, storeHash, loadConfig, red, green, yellow, bold, dim } from './utils.js';
import { validateConfig, printValidation } from './validate.js';

export function watchConfig(opts = {}) {
  const { jsonMode = false, interval = 5000 } = opts;

  if (!jsonMode) {
    console.log(bold(`\n👁️  Watching config for drift (every ${interval / 1000}s)...\n`));
    console.log(dim(`   Config: ${CONFIG_PATH}`));
    console.log(dim(`   Press Ctrl+C to stop.\n`));
  }

  // Set initial hash
  let lastHash = getStoredHash();
  if (!lastHash) {
    try {
      lastHash = hashJSON(loadConfig());
      storeHash(lastHash);
    } catch (e) {
      console.error(red(`Cannot read config: ${e.message}`));
      process.exit(2);
    }
  }

  watchFile(CONFIG_PATH, { interval: interval }, () => {
    try {
      const config = loadConfig();
      const currentHash = hashJSON(config);

      if (currentHash !== lastHash) {
        const ts = new Date().toISOString();

        if (jsonMode) {
          const validation = validateConfig(config);
          console.log(JSON.stringify({
            event: 'drift',
            timestamp: ts,
            previousHash: lastHash,
            currentHash,
            valid: validation.ok,
            errors: validation.errors,
            warnings: validation.warnings,
          }));
        } else {
          console.log(yellow(`\n🚨 DRIFT DETECTED at ${ts}`));
          console.log(dim(`   Previous hash: ${lastHash.slice(0, 16)}...`));
          console.log(dim(`   Current hash:  ${currentHash.slice(0, 16)}...`));

          // Validate the new config
          const validation = validateConfig(config);
          if (!validation.ok) {
            console.log(red('\n   ❌ New config has validation errors:'));
            printValidation(validation, false);
          } else {
            console.log(green('   ✅ New config validates OK.'));
          }
        }

        lastHash = currentHash;
        storeHash(currentHash);
      }
    } catch (e) {
      if (jsonMode) {
        console.log(JSON.stringify({ event: 'error', message: e.message }));
      } else {
        console.log(red(`\n❌ Error reading config: ${e.message}`));
      }
    }
  });
}

/**
 * Electron (`rebuild:native` / forge) rebuilds better-sqlite3 for the Electron ABI.
 * That overwrites the shared pnpm copy and breaks Node-based unit tests / pre-commit.
 * Restore the Node prebuild when the current binary cannot open an in-memory DB.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

function canOpenDb() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

if (canOpenDb()) {
  process.exit(0);
}

const pkgRoot = path.dirname(require.resolve('better-sqlite3/package.json'));
console.log(
  `[desktop-storage] better-sqlite3 is not loadable under Node ${process.version} (ABI ${process.versions.modules}); restoring Node prebuild…`,
);

const result = spawnSync('npx', ['--yes', 'prebuild-install'], {
  cwd: pkgRoot,
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

if ((result.status ?? 1) !== 0 || !canOpenDb()) {
  console.error(
    '[desktop-storage] Failed to restore better-sqlite3 for Node.\n' +
      '  After running desktop native rebuild, restore with:\n' +
      '  pnpm --filter @h09a/desktop-storage exec prebuild-install\n' +
      `  (from ${pkgRoot})`,
  );
  process.exit(1);
}

console.log('[desktop-storage] better-sqlite3 restored for Node.');

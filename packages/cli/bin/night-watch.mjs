#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rebuildAttempted = process.env.NIGHT_WATCH_NATIVE_REBUILD_ATTEMPTED === '1';

function isBetterSqliteNativeMismatch(error) {
  const err = error ?? {};
  const parts = [
    err.code,
    err.message,
    err.stack,
    err.cause?.code,
    err.cause?.message,
    err.cause?.stack,
  ];
  const text = parts.filter(Boolean).join('\n');

  return (
    text.includes('better_sqlite3.node') &&
    (text.includes('NODE_MODULE_VERSION') || text.includes('ERR_DLOPEN_FAILED'))
  );
}

function rebuildNativeSqlite() {
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.error(
    `[night-watch] Native SQLite module was built for a different Node.js version (${process.version}).`,
  );
  console.error('[night-watch] Rebuilding better-sqlite3 for the current Node.js runtime...');

  const result = spawnSync(npmBin, ['rebuild', 'better-sqlite3'], {
    cwd: packageRoot,
    env: { ...process.env, NIGHT_WATCH_NATIVE_REBUILD_ATTEMPTED: '1' },
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`[night-watch] Failed to start npm rebuild: ${result.error.message}`);
    process.exit(1);
  }

  if ((result.status ?? 1) !== 0) {
    console.error('[night-watch] Failed to rebuild better-sqlite3. Try reinstalling Night Watch:');
    console.error('  npm install -g @jonit-dev/night-watch-cli');
    process.exit(result.status ?? 1);
  }
}

async function run() {
  try {
    await import('../dist/cli.js');
  } catch (error) {
    if (!isBetterSqliteNativeMismatch(error) || rebuildAttempted) {
      throw error;
    }

    rebuildNativeSqlite();
    process.env.NIGHT_WATCH_NATIVE_REBUILD_ATTEMPTED = '1';
    await import(`../dist/cli.js?native-rebuild=${Date.now()}`);
  }
}

await run();

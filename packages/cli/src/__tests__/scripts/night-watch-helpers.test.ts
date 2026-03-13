import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../../../');
const helpersScript = path.join(repoRoot, 'scripts', 'night-watch-helpers.sh');

describe('night-watch helpers', () => {
  it('resolve_provider_key falls back to empty string when CLI is not found', () => {
    // Call resolve_provider_key with a non-existent project dir; the helper
    // falls back gracefully to an empty string when the CLI binary is missing.
    const result = spawnSync(
      'bash',
      ['-lc', `source "${helpersScript}"; resolve_provider_key /tmp/no-such-project executor`],
      {
        encoding: 'utf-8',
        env: {
          ...process.env,
          // Use a fake PATH so no real CLI binary is found
          PATH: '/usr/bin:/bin',
        },
      },
    );

    // The function always exits 0 (fallback) and writes an empty string
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });
});

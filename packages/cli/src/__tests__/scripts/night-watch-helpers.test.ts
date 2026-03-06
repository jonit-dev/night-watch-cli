import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../../../');
const helpersScript = path.join(repoRoot, 'scripts', 'night-watch-helpers.sh');

describe('night-watch helpers', () => {
  it('uses NIGHT_WATCH_HOME when resolving the queue lock path', () => {
    const result = spawnSync('bash', ['-lc', `source "${helpersScript}"; get_queue_lock_path`], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        NIGHT_WATCH_HOME: '/tmp/night-watch-custom-home',
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('/tmp/night-watch-custom-home/queue.lock');
  });
});

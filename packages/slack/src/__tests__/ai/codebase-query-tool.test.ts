import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetCodebaseQueryStateForTests,
  executeCodebaseQuery,
  getCodebaseQueryAvailability,
} from '../../ai/tools.js';

const MISSING_PROVIDER = '__missing_provider__' as unknown as 'claude' | 'codex';

describe('query_codebase resilience', () => {
  beforeEach(() => {
    __resetCodebaseQueryStateForTests();
    vi.restoreAllMocks();
  });

  it('opens a circuit after failure and fails fast on the next call', async () => {
    const projectPath = process.cwd();
    const env = {
      CODEBASE_QUERY_FAILURE_THRESHOLD: '1',
      CODEBASE_QUERY_COOLDOWN_MS: '60000',
    };

    const first = await executeCodebaseQuery('find auth middleware', projectPath, MISSING_PROVIDER, env);
    expect(first).toContain('Provider query failed');

    const second = await executeCodebaseQuery(
      'find auth middleware',
      projectPath,
      MISSING_PROVIDER,
      env,
    );
    expect(second).toContain('Provider query unavailable');
  });

  it('re-opens availability after cooldown elapses', async () => {
    const projectPath = process.cwd();
    let now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    await executeCodebaseQuery(
      'find scheduler',
      projectPath,
      MISSING_PROVIDER,
      {
        CODEBASE_QUERY_FAILURE_THRESHOLD: '1',
        CODEBASE_QUERY_COOLDOWN_MS: '60000',
      },
    );

    const blocked = getCodebaseQueryAvailability(projectPath, MISSING_PROVIDER);
    expect(blocked.available).toBe(false);

    now += 61_000;
    const reopened = getCodebaseQueryAvailability(projectPath, MISSING_PROVIDER);
    expect(reopened.available).toBe(true);
  });
});

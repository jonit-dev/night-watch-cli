import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fireTelemetryEvent,
  resetTelemetryReporterForTests,
  setCliTelemetryVersion,
  setTelemetryReporterForTests,
  trackCommandCompleted,
  trackCommandStarted,
  trackJobCompletedOrFailed,
  trackJobStarted,
} from '@/cli/commands/shared/telemetry.js';
import type { INightWatchConfig } from '@night-watch/core';

function createConfig(): INightWatchConfig {
  return {
    prdDir: 'docs/prds',
    maxRuntime: 1,
    reviewerMaxRuntime: 1,
    branchPrefix: 'night-watch',
    branchPatterns: ['night-watch/'],
    minReviewScore: 80,
    maxLogSize: 1,
    cronSchedule: '* * * * *',
    reviewerSchedule: '* * * * *',
    provider: 'claude',
    reviewerEnabled: true,
    maxRetries: 3,
    prdPriority: [],
    jobProviders: {},
    boardProvider: { enabled: true, provider: 'github' },
  };
}

describe('telemetry event helpers', () => {
  let reporter: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reporter = vi.fn().mockResolvedValue(undefined);
    setTelemetryReporterForTests(reporter);
    setCliTelemetryVersion('1.2.3');
  });

  afterEach(() => {
    resetTelemetryReporterForTests();
    vi.restoreAllMocks();
  });

  it('should track command started and completed for run without unsafe properties', async () => {
    const config = createConfig();

    await trackCommandStarted('run', config);
    await trackCommandCompleted('run', Date.now() - 10, 0, config);

    expect(reporter).toHaveBeenCalledWith(
      'command_started',
      expect.objectContaining({ command: 'run', cliVersion: '1.2.3' }),
    );
    expect(reporter).toHaveBeenCalledWith(
      'command_completed',
      expect.objectContaining({ command: 'run', exitCode: 0, success: true }),
    );
    const payload = JSON.stringify(reporter.mock.calls);
    expect(payload).not.toContain(process.cwd());
    expect(payload).not.toContain('github.com');
  });

  it('should track pr_opened for successful executor result without pr number or url', () => {
    fireTelemetryEvent('pr_opened', { jobType: 'executor', provider: 'claude', success: true });

    expect(reporter).toHaveBeenCalledWith('pr_opened', {
      jobType: 'executor',
      provider: 'claude',
      success: true,
    });
    expect(JSON.stringify(reporter.mock.calls)).not.toMatch(/pull|prNumber|https?:/);
  });

  it('should track review_completed when reviewer completes successfully', () => {
    fireTelemetryEvent('review_completed', { jobType: 'reviewer', provider: 'codex' });

    expect(reporter).toHaveBeenCalledWith('review_completed', {
      jobType: 'reviewer',
      provider: 'codex',
    });
  });

  it('should track auto_merge_completed without PR identifiers', () => {
    fireTelemetryEvent('auto_merge_completed', { jobType: 'merger', provider: 'claude' });

    expect(reporter).toHaveBeenCalledWith('auto_merge_completed', {
      jobType: 'merger',
      provider: 'claude',
    });
    expect(JSON.stringify(reporter.mock.calls)).not.toMatch(/prNumber|prTitle|prUrl|#12/);
  });

  it('should not alter command exit code when telemetry reporter fails', async () => {
    reporter.mockRejectedValue(new Error('network failure'));

    await expect(trackJobStarted('executor', 'claude', createConfig())).resolves.toBeUndefined();
    await expect(
      trackJobCompletedOrFailed('executor', 'claude', Date.now(), 42, createConfig(), 'timeout'),
    ).resolves.toBeUndefined();
  });
});

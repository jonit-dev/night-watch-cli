/**
 * Tests for install command core logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('child_process', () => ({
  exec: vi.fn(
    (
      _cmd: string,
      _opts: unknown,
      cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      callback?.(null, { stdout: '', stderr: '' });
    },
  ),
  execFile: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock('@night-watch/core/utils/crontab.js', () => ({
  generateMarker: (projectName: string) => `# night-watch-cli: ${projectName}`,
  getEntries: vi.fn(() => []),
  getProjectEntries: vi.fn(() => []),
  readCrontab: vi.fn(() => []),
  writeCrontab: vi.fn(),
}));

import { execSync } from 'child_process';
import { performInstall } from '@/cli/commands/install.js';
import {
  getEntries,
  getProjectEntries,
  readCrontab,
  writeCrontab,
} from '@night-watch/core/utils/crontab.js';
import { INightWatchConfig } from '@night-watch/core/types.js';

function createTestConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  return {
    defaultBranch: '',
    prdDir: 'docs/PRDs/night-watch',
    maxRuntime: 7200,
    reviewerMaxRuntime: 3600,
    branchPrefix: 'night-watch',
    branchPatterns: ['feat/', 'night-watch/'],
    minReviewScore: 80,
    maxLogSize: 524288,
    cronSchedule: '0 0-21 * * *',
    reviewerSchedule: '0 0,3,6,9,12,15,18,21 * * *',
    cronScheduleOffset: 0,
    maxRetries: 3,
    provider: 'claude',
    reviewerEnabled: true,
    providerEnv: {},
    notifications: { webhooks: [] },
    prdPriority: [],
    roadmapScanner: {
      enabled: false,
      roadmapPath: 'ROADMAP.md',
      autoScanInterval: 300,
      slicerSchedule: '0 */6 * * *',
      slicerMaxRuntime: 600,
    },
    templatesDir: '.night-watch/templates',
    boardProvider: { enabled: true, provider: 'github' as const },
    autoMerge: false,
    autoMergeMethod: 'squash' as const,
    fallbackOnRateLimit: false,
    claudeModel: 'sonnet' as const,
    qa: {
      enabled: false,
      schedule: '30 1,7,13,19 * * *',
      maxRuntime: 3600,
      branchPatterns: [],
      artifacts: 'both' as const,
      skipLabel: 'skip-qa',
      autoInstallPlaywright: true,
    },
    audit: {
      enabled: false,
      schedule: '0 2 * * *',
      maxRuntime: 3600,
    },
    analytics: {
      enabled: false,
      schedule: '0 6 * * 1',
      maxRuntime: 900,
      lookbackDays: 7,
      targetColumn: 'Draft' as const,
      analysisPrompt: '',
    },
    prResolver: {
      enabled: false,
      schedule: '15 6,14,22 * * *',
      maxRuntime: 3600,
      branchPatterns: [],
      maxPrsPerRun: 0,
      perPrTimeout: 600,
      aiConflictResolution: true,
      aiReviewResolution: false,
      readyLabel: 'ready-to-merge',
    },
    jobProviders: {
      executor: undefined,
      reviewer: undefined,
      qa: undefined,
      audit: undefined,
      slicer: undefined,
      analytics: undefined,
    },
    queue: {
      enabled: false,
      maxConcurrency: 1,
      maxWaitTime: 7200,
      priority: {
        executor: 50,
        reviewer: 40,
        slicer: 30,
        qa: 20,
        audit: 10,
      },
    },
    ...overrides,
  };
}

describe('install command', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-install-test-'));
    process.env.NIGHT_WATCH_HOME = tempDir;
    vi.mocked(execSync).mockImplementation(((command: string) => {
      if (command === 'npm bin -g') {
        throw new Error('npm bin unavailable');
      }
      if (command === 'which night-watch') {
        return '/opt/night-watch/bin/night-watch\n';
      }
      if (command === 'which node') {
        return '/usr/local/bin/node\n';
      }
      return '';
    }) as unknown as typeof execSync);
    vi.clearAllMocks();
    vi.mocked(getEntries).mockReturnValue([]);
    vi.mocked(getProjectEntries).mockReturnValue([]);
    vi.mocked(readCrontab).mockReturnValue([]);
  });

  afterEach(() => {
    delete process.env.NIGHT_WATCH_HOME;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should export NW_CLI_BIN and include required PATH dirs in entries', () => {
    const config = createTestConfig();
    const result = performInstall(tempDir, config);

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(2);

    const executorEntry = result.entries[0];
    // process.execPath is used to determine the node bin dir (stable across restarts)
    const nodeBinDir = path.dirname(process.execPath);
    expect(executorEntry).toContain(`export PATH="${nodeBinDir}:/opt/night-watch/bin:$PATH" && `);
    expect(executorEntry).toContain("export NW_CLI_BIN='/opt/night-watch/bin/night-watch' && ");

    expect(writeCrontab).toHaveBeenCalledTimes(1);
  });

  it('should replace existing project entries when force is enabled', () => {
    const config = createTestConfig({
      cronSchedule: '30 */3 * * *',
    });
    const existingExecutorEntry = `0 * * * * cd '${tempDir}' && '/opt/night-watch/bin/night-watch' run >> '${tempDir}/logs/executor.log' 2>&1  # night-watch-cli: ${path.basename(tempDir)}`;
    const unrelatedEntry = '15 * * * * echo "keep me"';

    vi.mocked(getEntries).mockReturnValue([existingExecutorEntry]);
    vi.mocked(getProjectEntries).mockReturnValue([existingExecutorEntry]);
    vi.mocked(readCrontab).mockReturnValue([existingExecutorEntry, unrelatedEntry]);

    const result = performInstall(tempDir, config, { force: true });

    expect(result.success).toBe(true);
    expect(writeCrontab).toHaveBeenCalledWith(
      expect.arrayContaining([unrelatedEntry, ...result.entries]),
    );
    expect(writeCrontab).not.toHaveBeenCalledWith(
      expect.arrayContaining([existingExecutorEntry, ...result.entries]),
    );
  });

  it('should add planner crontab entry when scanner enabled', () => {
    const config = createTestConfig({
      roadmapScanner: {
        enabled: true,
        roadmapPath: 'ROADMAP.md',
        autoScanInterval: 300,
        slicerSchedule: '0 */6 * * *',
        slicerMaxRuntime: 600,
      },
    });
    const result = performInstall(tempDir, config);

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(3); // executor, reviewer, planner

    const slicerEntry = result.entries[2];
    expect(slicerEntry).toContain("' planner ");
    expect(slicerEntry).toContain('slicer.log');
    expect(slicerEntry).toContain('0 */6 * * *');
    expect(slicerEntry).toContain('# night-watch-cli:');
  });

  it('should skip executor entry when executor is disabled', () => {
    const config = createTestConfig({
      executorEnabled: false,
      reviewerEnabled: true,
    });
    const result = performInstall(tempDir, config);

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(1); // reviewer only

    const hasExecutorEntry = result.entries.some((entry) => entry.includes("' run "));
    expect(hasExecutorEntry).toBe(false);
  });

  it('should skip slicer entry when scanner disabled', () => {
    const config = createTestConfig({
      roadmapScanner: {
        enabled: false,
        roadmapPath: 'ROADMAP.md',
        autoScanInterval: 300,
        slicerSchedule: '0 */6 * * *',
        slicerMaxRuntime: 600,
      },
    });
    const result = performInstall(tempDir, config);

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(2); // executor and reviewer only

    const hasSlicerEntry = result.entries.some((entry) => entry.includes("' planner "));
    expect(hasSlicerEntry).toBe(false);
  });

  it('should skip slicer entry with --no-slicer flag', () => {
    const config = createTestConfig({
      roadmapScanner: {
        enabled: true,
        roadmapPath: 'ROADMAP.md',
        autoScanInterval: 300,
        slicerSchedule: '0 */6 * * *',
        slicerMaxRuntime: 600,
      },
    });
    const result = performInstall(tempDir, config, { noSlicer: true });

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(2); // executor and reviewer only

    const hasSlicerEntry = result.entries.some((entry) => entry.includes("' planner "));
    expect(hasSlicerEntry).toBe(false);
  });

  it('should add QA crontab entry when qa.enabled is true', () => {
    const config = createTestConfig({
      qa: {
        enabled: true,
        schedule: '30 1,7,13,19 * * *',
        maxRuntime: 3600,
        branchPatterns: [],
        artifacts: 'both',
        skipLabel: 'skip-qa',
        autoInstallPlaywright: true,
      },
    });
    const result = performInstall(tempDir, config);

    expect(result.success).toBe(true);
    // executor + reviewer + qa = 3
    expect(result.entries).toHaveLength(3);

    const qaEntry = result.entries[2];
    expect(qaEntry).toContain("' qa ");
    expect(qaEntry).toContain('qa.log');
    expect(qaEntry).toContain('30 1,7,13,19 * * *');
    expect(qaEntry).toContain('# night-watch-cli:');
  });

  it('should not include QA entry when qa.enabled is false', () => {
    const config = createTestConfig({
      qa: {
        enabled: false,
        schedule: '30 1,7,13,19 * * *',
        maxRuntime: 3600,
        branchPatterns: [],
        artifacts: 'both',
        skipLabel: 'skip-qa',
        autoInstallPlaywright: true,
      },
    });
    const result = performInstall(tempDir, config);

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(2); // executor and reviewer only

    const hasQaEntry = result.entries.some((entry) => entry.includes("' qa "));
    expect(hasQaEntry).toBe(false);
  });

  it('should skip QA entry when --no-qa flag is set', () => {
    const config = createTestConfig({
      qa: {
        enabled: true,
        schedule: '30 1,7,13,19 * * *',
        maxRuntime: 3600,
        branchPatterns: [],
        artifacts: 'both',
        skipLabel: 'skip-qa',
        autoInstallPlaywright: true,
      },
    });
    const result = performInstall(tempDir, config, { noQa: true });

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(2); // executor and reviewer only

    const hasQaEntry = result.entries.some((entry) => entry.includes("' qa "));
    expect(hasQaEntry).toBe(false);
  });

  it('should skip QA entry when Commander passes qa=false from --no-qa', () => {
    const config = createTestConfig({
      qa: {
        enabled: true,
        schedule: '30 1,7,13,19 * * *',
        maxRuntime: 3600,
        branchPatterns: [],
        artifacts: 'both',
        skipLabel: 'skip-qa',
        autoInstallPlaywright: true,
      },
    });
    const result = performInstall(tempDir, config, { qa: false });

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(2); // executor and reviewer only

    const hasQaEntry = result.entries.some((entry) => entry.includes("' qa "));
    expect(hasQaEntry).toBe(false);
  });

  it('should add pr-resolver crontab entry when prResolver.enabled is true', () => {
    const config = createTestConfig({
      prResolver: {
        enabled: true,
        schedule: '15 6,14,22 * * *',
        maxRuntime: 3600,
        branchPatterns: [],
        maxPrsPerRun: 0,
        perPrTimeout: 600,
        aiConflictResolution: true,
        aiReviewResolution: false,
        readyLabel: 'ready-to-merge',
      },
    });
    const result = performInstall(tempDir, config);

    expect(result.success).toBe(true);
    // executor + reviewer + pr-resolver = 3
    expect(result.entries).toHaveLength(3);

    const prResolverEntry = result.entries[2];
    expect(prResolverEntry).toContain("' resolve ");
    expect(prResolverEntry).toContain('pr-resolver.log');
    expect(prResolverEntry).toContain('15 6,14,22 * * *');
    expect(prResolverEntry).toContain('# night-watch-cli:');
  });

  it('should not include pr-resolver entry when prResolver.enabled is false', () => {
    const config = createTestConfig({
      prResolver: {
        enabled: false,
        schedule: '15 6,14,22 * * *',
        maxRuntime: 3600,
        branchPatterns: [],
        maxPrsPerRun: 0,
        perPrTimeout: 600,
        aiConflictResolution: true,
        aiReviewResolution: false,
        readyLabel: 'ready-to-merge',
      },
    });
    const result = performInstall(tempDir, config);

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(2); // executor and reviewer only

    const hasPrResolverEntry = result.entries.some((entry) => entry.includes("' resolve "));
    expect(hasPrResolverEntry).toBe(false);
  });

  it('should skip pr-resolver entry when noPrResolver option is set', () => {
    const config = createTestConfig({
      prResolver: {
        enabled: true,
        schedule: '15 6,14,22 * * *',
        maxRuntime: 3600,
        branchPatterns: [],
        maxPrsPerRun: 0,
        perPrTimeout: 600,
        aiConflictResolution: true,
        aiReviewResolution: false,
        readyLabel: 'ready-to-merge',
      },
    });
    const result = performInstall(tempDir, config, { noPrResolver: true });

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(2); // executor and reviewer only

    const hasPrResolverEntry = result.entries.some((entry) => entry.includes("' resolve "));
    expect(hasPrResolverEntry).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { INightWatchConfig } from '@night-watch/core/types.js';

const coreMocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  resolveJobProvider: vi.fn(() => 'claude'),
  runManager: vi.fn(),
  createSpinner: vi.fn(() => ({
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  })),
  createTable: vi.fn(() => {
    const rows: string[][] = [];
    return Object.assign(rows, {
      toString: () => rows.map((row) => row.join(': ')).join('\n'),
    });
  }),
  header: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@night-watch/core', () => coreMocks);

vi.mock('@/cli/commands/shared/env-builder.js', () => ({
  maybeApplyCronSchedulingDelay: vi.fn(),
}));

vi.mock('@/cli/commands/shared/feedback.js', () => ({
  recordJobOutcome: vi.fn(),
}));

import {
  applyManagerCliOverrides,
  buildManagerRunOptions,
  managerCommand,
} from '@/cli/commands/manager.js';
import { recordJobOutcome } from '@/cli/commands/shared/feedback.js';

function createTestConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  return {
    defaultBranch: '',
    prdDir: 'docs/prds',
    maxRuntime: 0,
    reviewerMaxRuntime: 0,
    branchPrefix: 'night-watch',
    branchPatterns: ['night-watch/'],
    minReviewScore: 80,
    maxLogSize: 524288,
    cronSchedule: '5 * * * *',
    reviewerSchedule: '25 */3 * * *',
    cronScheduleOffset: 0,
    schedulingPriority: 3,
    maxRetries: 3,
    reviewerMaxRetries: 2,
    reviewerRetryDelay: 30,
    reviewerMaxPrsPerRun: 0,
    provider: 'claude',
    executorEnabled: true,
    reviewerEnabled: true,
    providerEnv: {},
    notifications: { webhooks: [] },
    prdPriority: [],
    roadmapScanner: {
      enabled: true,
      roadmapPath: 'ROADMAP.md',
      autoScanInterval: 300,
      slicerSchedule: '35 */6 * * *',
      slicerMaxRuntime: 0,
      priorityMode: 'roadmap-first',
      issueColumn: 'Ready',
    },
    templatesDir: '.night-watch/templates',
    boardProvider: { enabled: true, provider: 'github' },
    autoMerge: false,
    autoMergeMethod: 'squash',
    fallbackOnRateLimit: true,
    qa: {
      enabled: true,
      schedule: '45 2,10,18 * * *',
      maxRuntime: 0,
      branchPatterns: [],
      artifacts: 'both',
      skipLabel: 'skip-qa',
      autoInstallPlaywright: true,
      validatedLabel: 'e2e-validated',
    },
    audit: {
      enabled: false,
      schedule: '50 3 * * 1',
      maxRuntime: 0,
      createIssues: false,
      targetColumn: 'Draft',
    },
    analytics: {
      enabled: false,
      schedule: '0 6 * * 1',
      maxRuntime: 0,
      lookbackDays: 7,
      targetColumn: 'Draft',
      analysisPrompt: '',
    },
    manager: {
      enabled: true,
      schedule: '15 7 * * *',
      maxRuntime: 0,
      authority: 'draft',
      outputMode: 'board-draft',
      targetColumn: 'Draft',
      memoryPath: '.night-watch/manager/memory.md',
      docsDir: '.night-watch/manager/docs',
      weeklySummaryEnabled: true,
      weeklySummaryDay: 1,
    },
    feedback: {
      enabled: true,
      confidenceThreshold: 0.75,
      augmentationTtlDays: 14,
      maxActiveAugmentations: 3,
      successStreakToExpire: 3,
    },
    prResolver: {
      enabled: true,
      schedule: '15 6,14,22 * * *',
      maxRuntime: 0,
      branchPatterns: [],
      maxPrsPerRun: 0,
      perPrTimeout: 0,
      aiConflictResolution: true,
      aiReviewResolution: false,
      readyLabel: 'ready-to-merge',
    },
    merger: {
      enabled: false,
      schedule: '55 */4 * * *',
      maxRuntime: 0,
      mergeMethod: 'squash',
      minReviewScore: 80,
      branchPatterns: [],
      rebaseBeforeMerge: true,
      maxPrsPerRun: 0,
      ciPolicy: 'fallback-local',
      localCheckCommand: 'yarn install --frozen-lockfile && yarn verify && yarn test',
    },
    jobProviders: {},
    providerScheduleOverrides: [],
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
        analytics: 10,
        manager: 15,
      },
    },
    pausedJobs: {},
    webhookTriggers: {
      enabled: false,
      secretEnv: 'NIGHT_WATCH_WEBHOOK_SECRET',
      allowedJobIds: [],
      requireTimestamp: false,
      maxSkewSeconds: 300,
      github: { enabled: false, events: [], rules: [] },
    },
    ...overrides,
  };
}

describe('manager command', () => {
  let tempDir: string;
  let stdout = '';
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockCwd: ReturnType<typeof vi.spyOn>;
  let mockStdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-manager-test-'));
    stdout = '';
    coreMocks.loadConfig.mockReturnValue(createTestConfig());
    coreMocks.runManager.mockResolvedValue({
      ok: true,
      dryRun: true,
      findings: [],
      createdIssues: [],
    });
    mockCwd = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    mockStdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockCwd.mockRestore();
    mockExit.mockRestore();
    mockStdoutWrite.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('builds run options from CLI flags', () => {
    expect(
      buildManagerRunOptions({ dryRun: true, timeout: '1200', provider: 'codex' }),
    ).toEqual({
      dryRun: true,
      timeout: 1200,
      provider: 'codex',
    });
  });

  it('applies timeout and provider overrides', () => {
    const config = createTestConfig();
    const overridden = applyManagerCliOverrides(config, {
      timeout: '900',
      provider: 'codex',
    });

    expect(overridden.manager.maxRuntime).toBe(900);
    expect(overridden._cliProviderOverride).toBe('codex');
    expect(config.manager.maxRuntime).toBe(0);
  });

  it('prints dry-run json without side effects', async () => {
    const program = new Command();
    program.exitOverride();
    managerCommand(program);

    await expect(
      program.parseAsync(['manager', '--dry-run', '--json'], {
        from: 'user',
      }),
    ).rejects.toThrow('process.exit(0)');

    const payload = JSON.parse(stdout);
    expect(payload.dryRun).toBe(true);
    expect(payload.createdIssues).toEqual([]);
    expect(coreMocks.runManager).toHaveBeenCalledWith(
      tempDir,
      expect.objectContaining({
        manager: expect.objectContaining({ enabled: true }),
      }),
      expect.objectContaining({ dryRun: true }),
    );
    expect(recordJobOutcome).not.toHaveBeenCalled();
  });
});

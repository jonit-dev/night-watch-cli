import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBoardProvider } from '../board/factory.js';
import { syncAuditFindingsToBoard } from '../audit/board-sync.js';
import { INightWatchConfig } from '../types.js';

vi.mock('../board/factory.js');
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function createConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  return {
    defaultBranch: 'main',
    prdDir: 'docs/prds',
    maxRuntime: 7200,
    reviewerMaxRuntime: 1800,
    branchPrefix: 'night-watch/',
    branchPatterns: ['night-watch/'],
    minReviewScore: 70,
    maxLogSize: 10485760,
    cronSchedule: '0 2 * * *',
    reviewerSchedule: '50 3 * * 1',
    scheduleBundleId: null,
    cronScheduleOffset: 0,
    schedulingPriority: 3,
    maxRetries: 3,
    reviewerMaxRetries: 2,
    reviewerRetryDelay: 30,
    provider: 'claude',
    executorEnabled: true,
    reviewerEnabled: true,
    providerEnv: {},
    notifications: { webhooks: [] },
    prdPriority: [],
    roadmapScanner: {
      enabled: false,
      roadmapPath: 'ROADMAP.md',
      autoScanInterval: 300,
      slicerSchedule: '0 4 * * *',
      slicerMaxRuntime: 900,
      priorityMode: 'roadmap-first',
      issueColumn: 'Draft',
    },
    templatesDir: 'templates',
    boardProvider: {
      enabled: true,
      provider: 'github',
      repo: 'test/repo',
      projectNumber: 1,
    },
    autoMerge: false,
    autoMergeMethod: 'squash',
    fallbackOnRateLimit: true,
    claudeModel: 'sonnet',
    qa: {
      enabled: false,
      schedule: '0 3 * * *',
      maxRuntime: 1800,
      branchPatterns: ['night-watch/'],
      artifacts: 'both',
      skipLabel: 'qa-skip',
      autoInstallPlaywright: true,
    },
    audit: {
      enabled: true,
      schedule: '50 3 * * 1',
      maxRuntime: 1800,
      targetColumn: 'Draft',
    },
    analytics: {
      enabled: false,
      schedule: '0 6 * * 1',
      maxRuntime: 900,
      lookbackDays: 7,
      targetColumn: 'Draft',
      analysisPrompt: '',
    },
    jobProviders: {},
    queue: {
      enabled: false,
      mode: 'conservative',
      maxConcurrency: 1,
      maxWaitTime: 3600,
      priority: {
        executor: 100,
        reviewer: 90,
        qa: 80,
        audit: 10,
        slicer: 70,
        analytics: 10,
      },
      providerBuckets: {},
    },
    ...overrides,
  };
}

const SAMPLE_REPORT = `# Code Audit Report

Generated: 2026-03-27T00:00:00.000Z

## Findings

### Finding 1

- **Location**: \`src/game/CharacterTradingNPCBuy.ts:42\`
- **Severity**: critical
- **Category**: unhandled_promise
- **Description**: traderItems is always empty because async work is not awaited before the payload is sent.
- **Snippet**: \`traderItems.push(await buildItem())\`
- **Suggested Fix**: Replace the async forEach with await Promise.all or a for...of loop.

### Finding 2

- **Location**: \`src/server/cache.ts:18\`
- **Severity**: medium
- **Category**: scalability_hotspot
- **Description**: Full cache rebuild runs on every request path.
- **Snippet**: \`rebuildCacheSync()\`
- **Suggested Fix**: Cache the computed value and refresh it on a background schedule.
`;

describe('syncAuditFindingsToBoard', () => {
  let tempDir: string;
  let mockBoardProvider: { createIssue: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-sync-test-'));
    fs.mkdirSync(path.join(tempDir, 'logs'), { recursive: true });

    mockBoardProvider = {
      createIssue: vi.fn().mockResolvedValue({
        id: 'issue-1',
        number: 1,
        title: 'Test Issue',
        body: 'Test Body',
        url: 'https://github.com/test/issue/1',
      }),
    };

    vi.mocked(createBoardProvider).mockReturnValue(mockBoardProvider as never);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('skips when there is no actionable report to sync', async () => {
    fs.writeFileSync(path.join(tempDir, 'logs', 'audit-report.md'), 'NO_ISSUES_FOUND\n', 'utf-8');

    const result = await syncAuditFindingsToBoard(createConfig(), tempDir);

    expect(result.status).toBe('skipped');
    expect(result.issuesCreated).toBe(0);
    expect(mockBoardProvider.createIssue).not.toHaveBeenCalled();
  });

  it('skips board sync when the board provider is disabled', async () => {
    fs.writeFileSync(path.join(tempDir, 'logs', 'audit-report.md'), SAMPLE_REPORT, 'utf-8');

    const result = await syncAuditFindingsToBoard(
      createConfig({
        boardProvider: { enabled: false, provider: 'github' },
      }),
      tempDir,
    );

    expect(result.status).toBe('skipped');
    expect(result.findingsCount).toBe(2);
    expect(mockBoardProvider.createIssue).not.toHaveBeenCalled();
  });

  it('creates board issues in the configured target column', async () => {
    fs.writeFileSync(path.join(tempDir, 'logs', 'audit-report.md'), SAMPLE_REPORT, 'utf-8');

    const result = await syncAuditFindingsToBoard(
      createConfig({
        audit: {
          enabled: true,
          schedule: '50 3 * * 1',
          maxRuntime: 1800,
          targetColumn: 'Review',
        },
      }),
      tempDir,
    );

    expect(result.status).toBe('success');
    expect(result.issuesCreated).toBe(2);
    expect(mockBoardProvider.createIssue).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        title: 'Audit: critical unhandled promise in src/game/CharacterTradingNPCBuy.ts:42',
        column: 'Review',
        labels: ['P0'],
      }),
    );
    expect(mockBoardProvider.createIssue).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        title: 'Audit: medium scalability hotspot in src/server/cache.ts:18',
        column: 'Review',
        labels: ['P2'],
      }),
    );
  });

  it('returns a partial result when some issue creations fail', async () => {
    fs.writeFileSync(path.join(tempDir, 'logs', 'audit-report.md'), SAMPLE_REPORT, 'utf-8');
    mockBoardProvider.createIssue
      .mockRejectedValueOnce(new Error('create failed'))
      .mockResolvedValueOnce({
        id: 'issue-2',
        number: 2,
        title: 'Issue 2',
        body: 'Body 2',
        url: 'https://github.com/test/issue/2',
      });

    const result = await syncAuditFindingsToBoard(createConfig(), tempDir);

    expect(result.status).toBe('partial');
    expect(result.issuesCreated).toBe(1);
    expect(result.issuesFailed).toBe(1);
    expect(result.summary).toContain('1 failed');
  });
});

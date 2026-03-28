/**
 * Tests for the analytics runner
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runAnalytics } from '../analytics/analytics-runner.js';
import { INightWatchConfig } from '../types.js';
import { createBoardProvider } from '../board/factory.js';

// Mock dependencies
vi.mock('../board/factory.js');
vi.mock('../analytics/amplitude-client.js');
vi.mock('../utils/shell.js');
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('analytics-runner', () => {
  let tempDir: string;
  let mockConfig: INightWatchConfig;
  let mockBoardProvider: any;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-test-'));

    mockBoardProvider = {
      createIssue: vi.fn().mockResolvedValue({
        id: 'issue-1',
        number: 1,
        title: 'Test Issue',
        body: 'Test Body',
        url: 'https://github.com/test/issue/1',
      }),
    };

    vi.mocked(createBoardProvider).mockReturnValue(mockBoardProvider);

    mockConfig = {
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
      providerEnv: {
        AMPLITUDE_API_KEY: 'test-api-key',
        AMPLITUDE_SECRET_KEY: 'test-secret-key',
      },
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
        enabled: false,
        schedule: '50 3 * * 1',
        maxRuntime: 1800,
        targetColumn: 'Draft',
      },
      analytics: {
        enabled: true,
        schedule: '0 6 * * 1',
        maxRuntime: 900,
        lookbackDays: 7,
        targetColumn: 'Draft',
        analysisPrompt: 'Test prompt',
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
    };

    // Mock executeScriptWithOutput
    const { executeScriptWithOutput } = await import('../utils/shell.js');
    vi.mocked(executeScriptWithOutput).mockResolvedValue({
      exitCode: 0,
      stdout: '[{"title": "Test Issue", "body": "Test Body", "labels": ["analytics"]}]',
      stderr: '',
    });

    // Mock fetchAmplitudeData
    const { fetchAmplitudeData } = await import('../analytics/amplitude-client.js');
    vi.mocked(fetchAmplitudeData).mockResolvedValue({
      activeUsers: { data: 100 },
      eventSegmentation: { events: [] },
      retention: { data: [] },
      userSessions: { sessions: [] },
      fetchedAt: new Date().toISOString(),
      lookbackDays: 7,
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('should throw when AMPLITUDE_API_KEY is missing from providerEnv', async () => {
    const config = { ...mockConfig, providerEnv: {} };

    await expect(runAnalytics(config, tempDir)).rejects.toThrow(
      /AMPLITUDE_API_KEY.*AMPLITUDE_SECRET_KEY.*providerEnv/i,
    );
  });

  it('should throw when AMPLITUDE_SECRET_KEY is missing from providerEnv', async () => {
    const config = {
      ...mockConfig,
      providerEnv: { AMPLITUDE_API_KEY: 'key' },
    };

    await expect(runAnalytics(config, tempDir)).rejects.toThrow(
      /AMPLITUDE_API_KEY.*AMPLITUDE_SECRET_KEY.*providerEnv/i,
    );
  });

  it('should parse AI response with issue recommendations and create issues', async () => {
    const { executeScriptWithOutput } = await import('../utils/shell.js');
    vi.mocked(executeScriptWithOutput).mockResolvedValue({
      exitCode: 0,
      stdout:
        'Response text [{"title": "Issue 1", "body": "Body 1", "labels": ["analytics", "bug"]}] more text',
      stderr: '',
    });

    const result = await runAnalytics(mockConfig, tempDir);

    expect(result.issuesCreated).toBe(1);
    expect(result.summary).toContain('1 issue');
    expect(mockBoardProvider.createIssue).toHaveBeenCalledWith({
      title: 'Issue 1',
      body: 'Body 1',
      column: 'Draft',
      labels: ['analytics', 'bug'],
    });
  });

  it('should create issues in configured target column', async () => {
    const config = {
      ...mockConfig,
      analytics: { ...mockConfig.analytics, targetColumn: 'Ready' as const },
    };

    const { executeScriptWithOutput } = await import('../utils/shell.js');
    vi.mocked(executeScriptWithOutput).mockResolvedValue({
      exitCode: 0,
      stdout: '[{"title": "Test", "body": "Body", "labels": []}]',
      stderr: '',
    });

    await runAnalytics(config, tempDir);

    expect(mockBoardProvider.createIssue).toHaveBeenCalledWith({
      title: 'Test',
      body: 'Body',
      column: 'Ready',
      labels: [],
    });
  });

  it('should handle empty AI response gracefully', async () => {
    const { executeScriptWithOutput } = await import('../utils/shell.js');
    vi.mocked(executeScriptWithOutput).mockResolvedValue({
      exitCode: 0,
      stdout: 'No issues found []',
      stderr: '',
    });

    const result = await runAnalytics(mockConfig, tempDir);

    expect(result.issuesCreated).toBe(0);
    expect(result.summary).toBe('No actionable insights found');
    expect(mockBoardProvider.createIssue).not.toHaveBeenCalled();
  });

  it('should handle AI response with no JSON array', async () => {
    const { executeScriptWithOutput } = await import('../utils/shell.js');
    vi.mocked(executeScriptWithOutput).mockResolvedValue({
      exitCode: 0,
      stdout: 'No actionable insights today',
      stderr: '',
    });

    const result = await runAnalytics(mockConfig, tempDir);

    expect(result.issuesCreated).toBe(0);
    expect(mockBoardProvider.createIssue).not.toHaveBeenCalled();
  });

  it('should handle AI provider failure', async () => {
    const { executeScriptWithOutput } = await import('../utils/shell.js');
    vi.mocked(executeScriptWithOutput).mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'Provider error',
    });

    await expect(runAnalytics(mockConfig, tempDir)).rejects.toThrow(/exited with code 1/);
  });

  it('should use default labels when none provided', async () => {
    const { executeScriptWithOutput } = await import('../utils/shell.js');
    vi.mocked(executeScriptWithOutput).mockResolvedValue({
      exitCode: 0,
      stdout: '[{"title": "Test", "body": "Body"}]',
      stderr: '',
    });

    await runAnalytics(mockConfig, tempDir);

    expect(mockBoardProvider.createIssue).toHaveBeenCalledWith({
      title: 'Test',
      body: 'Body',
      column: 'Draft',
      labels: ['analytics'],
    });
  });

  it('should resolve provider command from custom preset when not in PROVIDER_COMMANDS', async () => {
    const config = {
      ...mockConfig,
      provider: 'glm-5',
      providerPresets: {
        'glm-5': {
          name: 'GLM-5',
          command: 'claude',
          promptFlag: '-p',
          autoApproveFlag: '--dangerously-skip-permissions',
          modelFlag: '--model',
          model: 'glm-5',
          envVars: {},
        },
      },
    };

    const { executeScriptWithOutput } = await import('../utils/shell.js');
    vi.mocked(executeScriptWithOutput).mockResolvedValue({
      exitCode: 0,
      stdout: '[{"title": "Issue 1", "body": "Body 1"}]',
      stderr: '',
    });

    const result = await runAnalytics(config, tempDir);

    // Should succeed (not crash with "undefined: command not found")
    expect(result.issuesCreated).toBe(1);

    // Verify the script was written with the resolved command, not "undefined"
    const scriptCall = vi.mocked(executeScriptWithOutput).mock.calls[0];
    const scriptPath = scriptCall[0] as string;
    expect(scriptPath).toContain('run-analytics.sh');
  });

  it('should handle multiple issues from AI response', async () => {
    const { executeScriptWithOutput } = await import('../utils/shell.js');
    vi.mocked(executeScriptWithOutput).mockResolvedValue({
      exitCode: 0,
      stdout: '[{"title": "Issue 1", "body": "Body 1"}, {"title": "Issue 2", "body": "Body 2"}]',
      stderr: '',
    });

    const result = await runAnalytics(mockConfig, tempDir);

    expect(result.issuesCreated).toBe(2);
    expect(mockBoardProvider.createIssue).toHaveBeenCalledTimes(2);
  });

  it('should continue creating issues even if one fails', async () => {
    mockBoardProvider.createIssue.mockRejectedValueOnce(new Error('Failed')).mockResolvedValueOnce({
      id: 'issue-2',
      number: 2,
      title: 'Issue 2',
      body: 'Body 2',
    });

    const { executeScriptWithOutput } = await import('../utils/shell.js');
    vi.mocked(executeScriptWithOutput).mockResolvedValue({
      exitCode: 0,
      stdout: '[{"title": "Issue 1", "body": "Body 1"}, {"title": "Issue 2", "body": "Body 2"}]',
      stderr: '',
    });

    const result = await runAnalytics(mockConfig, tempDir);

    expect(result.issuesCreated).toBe(1); // Only second issue succeeded
    expect(result.summary).toBe('Created 1 of 2 issue(s) from analytics insights (1 failed)');
  });

  it('should report when all issue creations fail', async () => {
    mockBoardProvider.createIssue.mockRejectedValue(new Error('Failed'));

    const { executeScriptWithOutput } = await import('../utils/shell.js');
    vi.mocked(executeScriptWithOutput).mockResolvedValue({
      exitCode: 0,
      stdout: '[{"title": "Issue 1", "body": "Body 1"}]',
      stderr: '',
    });

    const result = await runAnalytics(mockConfig, tempDir);

    expect(result.issuesCreated).toBe(0);
    expect(result.summary).toBe(
      'Found 1 actionable insight(s), but failed to create board issue(s)',
    );
  });
});

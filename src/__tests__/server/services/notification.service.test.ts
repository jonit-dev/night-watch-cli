/**
 * Tests for NotificationService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationService } from '../../../server/services/notification.service.js';
import { INightWatchConfig, IWebhookConfig } from '../../../types.js';
import type { INotificationContext } from '../../../server/services/notification.service.js';

// Mock chalk to disable colours for easier assertions
vi.mock('chalk', () => ({
  default: {
    green: (msg: string) => msg,
    red: (msg: string) => msg,
    yellow: (msg: string) => msg,
    cyan: (msg: string) => msg,
    dim: (msg: string) => msg,
    bold: (msg: string) => msg,
  },
  green: (msg: string) => msg,
  red: (msg: string) => msg,
  yellow: (msg: string) => msg,
  cyan: (msg: string) => msg,
  dim: (msg: string) => msg,
  bold: (msg: string) => msg,
}));

const baseCtx: INotificationContext = {
  event: 'run_succeeded',
  projectName: 'my-project',
  prdName: 'add-auth',
  branchName: 'night-watch/add-auth',
  exitCode: 0,
  duration: 120,
  provider: 'claude',
};

function makeConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  return {
    defaultBranch: 'main',
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
    fallbackOnRateLimit: false,
    claudeModel: 'sonnet',
    notifications: { webhooks: [] },
    prdPriority: [],
    roadmapScanner: {
      enabled: false,
      roadmapPath: 'ROADMAP.md',
      autoScanInterval: 300,
      slicerSchedule: '0 * * * *',
      slicerMaxRuntime: 3600,
    },
    templatesDir: 'templates',
    boardProvider: { type: 'none' } as any,
    autoMerge: false,
    autoMergeMethod: 'squash',
    qa: {
      enabled: false,
      schedule: '0 * * * *',
      maxRuntime: 3600,
      branchPatterns: [],
      artifacts: 'screenshot',
      skipLabel: 'skip-qa',
      autoInstallPlaywright: false,
    },
    audit: {
      enabled: false,
      schedule: '0 * * * *',
      maxRuntime: 3600,
    },
    ...overrides,
  };
}

describe('NotificationService', () => {
  let service: NotificationService;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new NotificationService();
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── buildText ────────────────────────────────────────────────────────────

  describe('buildText', () => {
    it('returns a non-empty string for run_succeeded', () => {
      const text = service.buildText(baseCtx);
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
    });

    it('contains project name for run_failed event', () => {
      const text = service.buildText({ ...baseCtx, event: 'run_failed' });
      expect(text).toContain('my-project');
    });

    it('formats QA completed with human-style text', () => {
      const text = service.buildText({
        ...baseCtx,
        event: 'qa_completed',
        prNumber: 5,
        prUrl: 'https://github.com/org/repo/pull/5',
      });
      expect(text).toContain('Finished QA on');
    });
  });

  // ── buildDescription ─────────────────────────────────────────────────────

  describe('buildDescription', () => {
    it('includes project name and provider', () => {
      const desc = service.buildDescription(baseCtx);
      expect(desc).toContain('my-project');
      expect(desc).toContain('claude');
    });

    it('includes PRD name when provided', () => {
      const desc = service.buildDescription({ ...baseCtx, prdName: 'my-prd' });
      expect(desc).toContain('my-prd');
    });

    it('includes PR number when provided', () => {
      const desc = service.buildDescription({ ...baseCtx, prNumber: 42 });
      expect(desc).toContain('#42');
    });
  });

  // ── formatSlack ───────────────────────────────────────────────────────────

  describe('formatSlack', () => {
    it('returns an object with attachments', () => {
      const payload = service.formatSlack(baseCtx) as any;
      expect(payload.attachments).toBeDefined();
      expect(Array.isArray(payload.attachments)).toBe(true);
    });

    it('uses green color for run_succeeded', () => {
      const payload = service.formatSlack({ ...baseCtx, event: 'run_succeeded' }) as any;
      expect(payload.attachments[0].color).toBe('#00ff00');
    });

    it('uses red color for run_failed', () => {
      const payload = service.formatSlack({ ...baseCtx, event: 'run_failed' }) as any;
      expect(payload.attachments[0].color).toBe('#ff0000');
    });

    it('includes project name in the block text', () => {
      const payload = service.formatSlack(baseCtx) as any;
      const text = payload.attachments[0].blocks[0].text.text;
      expect(text).toContain('my-project');
    });
  });

  // ── formatDiscord ─────────────────────────────────────────────────────────

  describe('formatDiscord', () => {
    it('returns an object with embeds', () => {
      const payload = service.formatDiscord(baseCtx) as any;
      expect(payload.embeds).toBeDefined();
      expect(Array.isArray(payload.embeds)).toBe(true);
    });

    it('sets green color for run_succeeded', () => {
      const payload = service.formatDiscord({ ...baseCtx, event: 'run_succeeded' }) as any;
      expect(payload.embeds[0].color).toBe(0x00ff00);
    });

    it('includes a timestamp', () => {
      const payload = service.formatDiscord(baseCtx) as any;
      expect(payload.embeds[0].timestamp).toBeDefined();
    });
  });

  // ── formatTelegram ────────────────────────────────────────────────────────

  describe('formatTelegram', () => {
    it('returns MarkdownV2 parse_mode', () => {
      const payload = service.formatTelegram(baseCtx);
      expect(payload.parse_mode).toBe('MarkdownV2');
    });

    it('uses structured template when prUrl is present', () => {
      const payload = service.formatTelegram({
        ...baseCtx,
        prUrl: 'https://github.com/org/repo/pull/1',
        prTitle: 'feat: structured',
        prNumber: 1,
        prBody: 'Added feature X.',
        filesChanged: 3,
        additions: 50,
        deletions: 10,
      });
      expect(payload.text).toContain('feat: structured');
    });
  });

  // ── getEmoji / getTitle / getColor ────────────────────────────────────────

  describe('getEmoji', () => {
    it('returns a non-empty string', () => {
      const emoji = service.getEmoji(baseCtx);
      expect(typeof emoji).toBe('string');
      expect(emoji.length).toBeGreaterThan(0);
    });
  });

  describe('getTitle', () => {
    it('returns "PRD Execution Succeeded" for run_succeeded', () => {
      expect(service.getTitle(baseCtx)).toBe('PRD Execution Succeeded');
    });

    it('returns "PRD Execution Failed" for run_failed', () => {
      expect(service.getTitle({ ...baseCtx, event: 'run_failed' })).toBe('PRD Execution Failed');
    });
  });

  describe('getColor', () => {
    it('returns a number', () => {
      const color = service.getColor(baseCtx);
      expect(typeof color).toBe('number');
    });

    it('returns green for run_succeeded', () => {
      expect(service.getColor({ ...baseCtx, event: 'run_succeeded' })).toBe(0x00ff00);
    });

    it('returns red for run_failed', () => {
      expect(service.getColor({ ...baseCtx, event: 'run_failed' })).toBe(0xff0000);
    });
  });

  // ── sendWebhook ────────────────────────────────────────────────────────────

  describe('sendWebhook', () => {
    it('skips events not in the webhook config', async () => {
      const webhook: IWebhookConfig = {
        type: 'slack',
        url: 'https://hooks.slack.com/test',
        events: ['run_failed'],
      };
      await service.sendWebhook(webhook, { ...baseCtx, event: 'run_succeeded' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('calls fetch for matching events', async () => {
      const webhook: IWebhookConfig = {
        type: 'slack',
        url: 'https://hooks.slack.com/test',
        events: ['run_failed'],
      };
      await service.sendWebhook(webhook, { ...baseCtx, event: 'run_failed' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not throw on fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const webhook: IWebhookConfig = {
        type: 'slack',
        url: 'https://hooks.slack.com/test',
        events: ['run_failed'],
      };
      await expect(
        service.sendWebhook(webhook, { ...baseCtx, event: 'run_failed' })
      ).resolves.toBeUndefined();
    });
  });

  // ── send ──────────────────────────────────────────────────────────────────

  describe('send', () => {
    it('does nothing when no webhooks are configured and slack is not enabled', async () => {
      const config = makeConfig({ notifications: { webhooks: [] } });
      await service.send(config, baseCtx);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('sends to all configured webhooks', async () => {
      const config = makeConfig({
        notifications: {
          webhooks: [
            { type: 'slack', url: 'https://hooks.slack.com/1', events: ['run_succeeded'] },
            { type: 'discord', url: 'https://discord.com/api/webhooks/2', events: ['run_succeeded'] },
          ],
        },
      });
      await service.send(config, baseCtx);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('skips webhooks whose event list does not match', async () => {
      const config = makeConfig({
        notifications: {
          webhooks: [
            { type: 'slack', url: 'https://hooks.slack.com/1', events: ['run_failed'] },
          ],
        },
      });
      // ctx.event is run_succeeded — webhook only listens for run_failed
      await service.send(config, { ...baseCtx, event: 'run_succeeded' });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

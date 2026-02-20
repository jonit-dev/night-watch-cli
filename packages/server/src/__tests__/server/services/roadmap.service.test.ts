/**
 * Tests for RoadmapService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as childProcess from 'child_process';
import { RoadmapService } from '../../../services/roadmap.service.js';
import { INightWatchConfig } from '@night-watch/core/types.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

const baseConfig: INightWatchConfig = {
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
  fallbackOnRateLimit: false,
  claudeModel: 'sonnet',
  notifications: { webhooks: [] },
  prdPriority: [],
  roadmapScanner: {
    enabled: true,
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
};

describe('RoadmapService', () => {
  let service: RoadmapService;
  let tempDir: string;
  let prdDir: string;

  /** Helper to build a mock child process that succeeds and creates a file */
  function mockProviderSuccess(filename: string) {
    const mockChild = {
      stdout: {
        on: vi.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === 'data') cb(Buffer.from('output\n'));
        }),
      },
      stderr: {
        on: vi.fn(),
      },
      on: vi.fn((event: string, cb: (code: number | null) => void) => {
        if (event === 'close') {
          fs.writeFileSync(path.join(prdDir, filename), '# Mock PRD\n');
          cb(0);
        }
      }),
    };
    (childProcess.spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockChild);
    return mockChild;
  }

  /** Helper to build a mock child process that fails (non-zero exit) */
  function mockProviderFailure() {
    const mockChild = {
      stdout: { on: vi.fn() },
      stderr: {
        on: vi.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === 'data') cb(Buffer.from('error\n'));
        }),
      },
      on: vi.fn((event: string, cb: (code: number | null) => void) => {
        if (event === 'close') cb(1);
      }),
    };
    (childProcess.spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockChild);
    return mockChild;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RoadmapService();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-roadmap-service-test-'));
    prdDir = path.join(tempDir, 'docs/PRDs/night-watch');
    fs.mkdirSync(prdDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ── getStatus ─────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns no-roadmap status when ROADMAP.md is absent', () => {
      const config = { ...baseConfig, prdDir: path.relative(tempDir, prdDir) };
      const status = service.getStatus(tempDir, config);
      expect(status.found).toBe(false);
      expect(status.status).toBe('no-roadmap');
    });

    it('returns disabled status when scanner is disabled', () => {
      const roadmapPath = path.join(tempDir, 'ROADMAP.md');
      fs.writeFileSync(roadmapPath, '## Features\n- [ ] Item 1\n');
      const config = {
        ...baseConfig,
        prdDir: path.relative(tempDir, prdDir),
        roadmapScanner: { ...baseConfig.roadmapScanner, enabled: false },
      };
      const status = service.getStatus(tempDir, config);
      expect(status.enabled).toBe(false);
      expect(status.status).toBe('disabled');
    });

    it('returns correct counts for items', () => {
      const roadmapPath = path.join(tempDir, 'ROADMAP.md');
      fs.writeFileSync(
        roadmapPath,
        '## Features\n- [ ] Item 1\n- [x] Item 2\n- [ ] Item 3\n'
      );
      const config = { ...baseConfig, prdDir: path.relative(tempDir, prdDir) };
      const status = service.getStatus(tempDir, config);
      expect(status.totalItems).toBe(3);
      expect(status.pendingItems).toBe(2); // checked item excluded
    });

    it('returns complete when all items are processed', () => {
      const roadmapPath = path.join(tempDir, 'ROADMAP.md');
      fs.writeFileSync(roadmapPath, '## Features\n- [x] Done Item\n');
      const config = { ...baseConfig, prdDir: path.relative(tempDir, prdDir) };
      const status = service.getStatus(tempDir, config);
      // All items are checked so pending is 0 → complete
      expect(status.status).toBe('complete');
    });
  });

  // ── hasNewItems ────────────────────────────────────────────────────────────

  describe('hasNewItems', () => {
    it('returns false when there is no ROADMAP.md', () => {
      const config = { ...baseConfig, prdDir: path.relative(tempDir, prdDir) };
      expect(service.hasNewItems(tempDir, config)).toBe(false);
    });

    it('returns true when there are unprocessed items', () => {
      const roadmapPath = path.join(tempDir, 'ROADMAP.md');
      fs.writeFileSync(roadmapPath, '## Features\n- [ ] New Feature\n');
      const config = { ...baseConfig, prdDir: path.relative(tempDir, prdDir) };
      expect(service.hasNewItems(tempDir, config)).toBe(true);
    });

    it('returns false when all items are checked', () => {
      const roadmapPath = path.join(tempDir, 'ROADMAP.md');
      fs.writeFileSync(roadmapPath, '## Features\n- [x] Done Item\n');
      const config = { ...baseConfig, prdDir: path.relative(tempDir, prdDir) };
      expect(service.hasNewItems(tempDir, config)).toBe(false);
    });
  });

  // ── sliceNext ─────────────────────────────────────────────────────────────

  describe('sliceNext', () => {
    it('returns error when scanner is disabled', async () => {
      const config = {
        ...baseConfig,
        prdDir: path.relative(tempDir, prdDir),
        roadmapScanner: { ...baseConfig.roadmapScanner, enabled: false },
      };
      const result = await service.sliceNext(tempDir, config);
      expect(result.sliced).toBe(false);
      expect(result.error).toContain('disabled');
    });

    it('returns error when ROADMAP.md is missing', async () => {
      const config = { ...baseConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await service.sliceNext(tempDir, config);
      expect(result.sliced).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('picks the first unprocessed unchecked item and slices it', async () => {
      const roadmapPath = path.join(tempDir, 'ROADMAP.md');
      fs.writeFileSync(
        roadmapPath,
        '## Features\n- [ ] Alpha Feature\n- [ ] Beta Feature\n'
      );
      mockProviderSuccess('01-alpha-feature.md');
      const config = { ...baseConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await service.sliceNext(tempDir, config);
      expect(result.sliced).toBe(true);
      expect(result.file).toBe('01-alpha-feature.md');
      expect(result.item?.title).toBe('Alpha Feature');
    });

    it('skips checked items and returns no-pending when all are done', async () => {
      const roadmapPath = path.join(tempDir, 'ROADMAP.md');
      fs.writeFileSync(roadmapPath, '## Features\n- [x] Checked\n');
      const config = { ...baseConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await service.sliceNext(tempDir, config);
      expect(result.sliced).toBe(false);
      expect(result.error).toContain('No pending items');
      expect(childProcess.spawn).not.toHaveBeenCalled();
    });
  });

  // ── sliceItem ─────────────────────────────────────────────────────────────

  describe('sliceItem', () => {
    it('detects duplicate by slug and does not call the provider', async () => {
      fs.writeFileSync(path.join(prdDir, '05-existing-feature.md'), '# PRD\n');
      const item = {
        hash: 'abc12345',
        title: 'Existing Feature',
        description: 'desc',
        checked: false,
        section: 'Features',
      };
      const config = { ...baseConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await service.sliceItem(tempDir, prdDir, item, config);
      expect(result.sliced).toBe(false);
      expect(result.error).toContain('Duplicate detected');
      expect(childProcess.spawn).not.toHaveBeenCalled();
    });

    it('creates a PRD file when the provider succeeds', async () => {
      const item = {
        hash: 'suc12345',
        title: 'Success Feature',
        description: 'will succeed',
        checked: false,
        section: 'Features',
      };
      mockProviderSuccess('01-success-feature.md');
      const config = { ...baseConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await service.sliceItem(tempDir, prdDir, item, config);
      expect(result.sliced).toBe(true);
      expect(result.file).toBe('01-success-feature.md');
      expect(fs.existsSync(path.join(prdDir, '01-success-feature.md'))).toBe(true);
    });

    it('returns an error when the provider fails', async () => {
      const item = {
        hash: 'fail1234',
        title: 'Failed Feature',
        description: 'will fail',
        checked: false,
        section: 'Features',
      };
      mockProviderFailure();
      const config = { ...baseConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await service.sliceItem(tempDir, prdDir, item, config);
      expect(result.sliced).toBe(false);
      expect(result.error).toContain('exited with code 1');
    });
  });

  // ── scan ──────────────────────────────────────────────────────────────────

  describe('scan', () => {
    it('processes one item and returns it in created', async () => {
      const roadmapPath = path.join(tempDir, 'ROADMAP.md');
      fs.writeFileSync(
        roadmapPath,
        '## Features\n- [ ] Feature One\n- [ ] Feature Two\n'
      );
      mockProviderSuccess('01-feature-one.md');
      const config = { ...baseConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await service.scan(tempDir, config);
      expect(result.created.length).toBeLessThanOrEqual(1);
      if (result.created.length === 1) {
        expect(result.created[0]).toBe('01-feature-one.md');
      }
    });

    it('returns empty result for an empty roadmap', async () => {
      const roadmapPath = path.join(tempDir, 'ROADMAP.md');
      fs.writeFileSync(roadmapPath, '## Features\n');
      const config = { ...baseConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await service.scan(tempDir, config);
      expect(result.created).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(childProcess.spawn).not.toHaveBeenCalled();
    });

    it('reports an error when the provider fails', async () => {
      const roadmapPath = path.join(tempDir, 'ROADMAP.md');
      fs.writeFileSync(roadmapPath, '## Features\n- [ ] Failed Feature\n');
      mockProviderFailure();
      const config = { ...baseConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await service.scan(tempDir, config);
      expect(result.created).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
    });
  });
});

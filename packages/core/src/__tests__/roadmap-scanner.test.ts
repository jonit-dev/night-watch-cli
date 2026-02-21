/**
 * Tests for Roadmap Scanner
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as childProcess from 'child_process';
import * as crypto from 'crypto';
import {
  getRoadmapStatus,
  scanRoadmap,
  sliceNextItem,
  sliceRoadmapItem,
} from '../utils/roadmap-scanner.js';
import { INightWatchConfig } from '../types.js';
import { loadRoadmapState, getStateFilePath } from '../utils/roadmap-state.js';
import { IRoadmapItem } from '../utils/roadmap-parser.js';

// Helper to compute hash the same way as generateItemHash
function computeHash(title: string): string {
  const normalizedTitle = title.toLowerCase().trim();
  return crypto.createHash('sha256').update(normalizedTitle).digest('hex').slice(0, 8);
}

// Mock child_process.spawn
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('roadmap-scanner', () => {
  let tempDir: string;
  let prdDir: string;
  let roadmapPath: string;

  const defaultConfig: INightWatchConfig = {
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
    provider: 'claude',
    reviewerEnabled: true,
    providerEnv: {},
    notifications: { webhooks: [] },
    prdPriority: [],
    roadmapScanner: {
      enabled: true,
      roadmapPath: 'ROADMAP.md',
      autoScanInterval: 300,
      slicerSchedule: '0 * * * *',
      slicerMaxRuntime: 3600,
    },
  };

  const disabledConfig: INightWatchConfig = {
    ...defaultConfig,
    roadmapScanner: {
      ...defaultConfig.roadmapScanner,
      enabled: false,
    },
  };

  // Helper to create a mock provider process that succeeds
  function mockProviderSuccess(filename: string) {
    const mockChild = {
      stdout: {
        on: vi.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === 'data') {
            cb(Buffer.from('Mock provider output\n'));
          }
        }),
      },
      stderr: {
        on: vi.fn((event: string, _cb: (data: Buffer) => void) => {}),
      },
      on: vi.fn((event: string, cb: (code: number | null) => void) => {
        if (event === 'close') {
          // Create the expected file when provider "succeeds"
          const filePath = path.join(prdDir, filename);
          fs.writeFileSync(filePath, '# Mock PRD Content\n', 'utf-8');
          cb(0);
        }
      }),
    };
    (childProcess.spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockChild);
    return mockChild;
  }

  // Helper to create a mock provider process that fails
  function mockProviderFailure() {
    const mockChild = {
      stdout: {
        on: vi.fn(),
      },
      stderr: {
        on: vi.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === 'data') {
            cb(Buffer.from('Mock error\n'));
          }
        }),
      },
      on: vi.fn((event: string, cb: (code: number | null) => void) => {
        if (event === 'close') {
          cb(1);
        }
      }),
    };
    (childProcess.spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockChild);
    return mockChild;
  }

  // Helper to create a mock provider process that does not create a file
  function mockProviderNoFile() {
    const mockChild = {
      stdout: {
        on: vi.fn(),
      },
      stderr: {
        on: vi.fn(),
      },
      on: vi.fn((event: string, cb: (code: number | null) => void) => {
        if (event === 'close') {
          cb(0); // Exit success but no file created
        }
      }),
    };
    (childProcess.spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockChild);
    return mockChild;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-scanner-test-'));
    prdDir = path.join(tempDir, 'docs/PRDs/night-watch');
    roadmapPath = path.join(tempDir, 'ROADMAP.md');

    // Create PRD directory
    fs.mkdirSync(prdDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('getRoadmapStatus', () => {
    it('should return no-roadmap status when file missing', () => {
      // Don't create ROADMAP.md
      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const status = getRoadmapStatus(tempDir, config);

      expect(status.found).toBe(false);
      expect(status.status).toBe('no-roadmap');
      expect(status.totalItems).toBe(0);
    });

    it('should return disabled status when scanner disabled', () => {
      // Create ROADMAP.md
      fs.writeFileSync(roadmapPath, `## Features\n- [ ] Item 1\n`);

      const config = {
        ...disabledConfig,
        prdDir: path.relative(tempDir, prdDir),
      };
      const status = getRoadmapStatus(tempDir, config);

      expect(status.enabled).toBe(false);
      expect(status.status).toBe('disabled');
    });

    it('should return complete when all items processed', () => {
      // Create ROADMAP.md
      fs.writeFileSync(roadmapPath, `## Features\n- [ ] Item 1\n`);

      // Create state with processed item - use correct hash
      const statePath = getStateFilePath(prdDir);
      const state = {
        version: 1,
        lastScan: '',
        items: {
          [computeHash('Item 1')]: {
            title: 'Item 1',
            prdFile: '01-item-1.md',
            createdAt: new Date().toISOString(),
          },
        },
      };
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const status = getRoadmapStatus(tempDir, config);

      expect(status.status).toBe('complete');
      expect(status.processedItems).toBe(1);
      expect(status.pendingItems).toBe(0);
    });

    it('should return correct counts for mixed items', () => {
      fs.writeFileSync(
        roadmapPath,
        `## Features
- [ ] Item 1
- [x] Item 2 (checked)
- [ ] Item 3
`,
      );

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const status = getRoadmapStatus(tempDir, config);

      expect(status.totalItems).toBe(3);
      expect(status.processedItems).toBe(0);
      expect(status.pendingItems).toBe(2); // Item 1 and Item 3 (Item 2 is checked)
    });

    it('should detect items by section', () => {
      fs.writeFileSync(
        roadmapPath,
        `## Phase 1
- [ ] Item 1

## Phase 2
- [ ] Item 2
`,
      );

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const status = getRoadmapStatus(tempDir, config);

      expect(status.items).toHaveLength(2);
      expect(status.items[0].section).toBe('Phase 1');
      expect(status.items[1].section).toBe('Phase 2');
    });
  });

  describe('sliceNextItem', () => {
    it('sliceNextItem should pick the first unprocessed item', async () => {
      fs.writeFileSync(
        roadmapPath,
        `## Features
- [ ] Feature Alpha
- [ ] Feature Beta
`,
      );

      // Mock provider to succeed
      mockProviderSuccess('01-feature-alpha.md');

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await sliceNextItem(tempDir, config);

      expect(result.sliced).toBe(true);
      expect(result.file).toBe('01-feature-alpha.md');
      expect(result.item?.title).toBe('Feature Alpha');

      // Verify state was updated
      const state = loadRoadmapState(prdDir);
      expect(Object.keys(state.items)).toHaveLength(1);
    });

    it('sliceNextItem should skip checked items', async () => {
      fs.writeFileSync(
        roadmapPath,
        `## Features
- [x] Completed Item
`,
      );

      // No need to mock - spawn won't be called
      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await sliceNextItem(tempDir, config);

      expect(result.sliced).toBe(false);
      expect(result.error).toContain('No pending items');
      // Verify spawn was not called
      expect(childProcess.spawn).not.toHaveBeenCalled();
    });

    it('sliceNextItem should skip already-processed items', async () => {
      fs.writeFileSync(roadmapPath, `## Features\n- [ ] Item One\n`);

      // Create state with processed item - use correct hash
      const statePath = getStateFilePath(prdDir);
      const state = {
        version: 1,
        lastScan: '',
        items: {
          [computeHash('Item One')]: {
            title: 'Item One',
            prdFile: '01-item-one.md',
            createdAt: new Date().toISOString(),
          },
        },
      };
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

      // No need to mock - spawn won't be called
      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await sliceNextItem(tempDir, config);

      expect(result.sliced).toBe(false);
      expect(result.error).toContain('No pending items');
      // Verify spawn was not called
      expect(childProcess.spawn).not.toHaveBeenCalled();
    });

    it('sliceNextItem should return no-pending when all done', async () => {
      fs.writeFileSync(roadmapPath, `## Features\n- [ ] Done Feature\n`);

      // Create state with processed item - use correct hash
      const statePath = getStateFilePath(prdDir);
      const state = {
        version: 1,
        lastScan: '',
        items: {
          [computeHash('Done Feature')]: {
            title: 'Done Feature',
            prdFile: '01-done-feature.md',
            createdAt: new Date().toISOString(),
          },
        },
      };
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

      // No need to mock - spawn won't be called
      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await sliceNextItem(tempDir, config);

      expect(result.sliced).toBe(false);
      expect(result.error).toContain('No pending items');
      // Verify spawn was not called
      expect(childProcess.spawn).not.toHaveBeenCalled();
    });
  });

  describe('sliceRoadmapItem', () => {
    it('sliceRoadmapItem should detect duplicate by slug', async () => {
      // Create existing PRD with matching slug
      fs.writeFileSync(path.join(prdDir, '05-existing-feature.md'), '# PRD: Existing Feature\n');

      const item: IRoadmapItem = {
        hash: 'abc12345',
        title: 'Existing Feature',
        description: 'Some description',
        checked: false,
        section: 'Features',
      };

      // No need to mock - spawn won't be called for duplicate
      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await sliceRoadmapItem(tempDir, prdDir, item, config);

      expect(result.sliced).toBe(false);
      expect(result.error).toContain('Duplicate detected');
      // Verify spawn was not called
      expect(childProcess.spawn).not.toHaveBeenCalled();
    });

    it('sliceRoadmapItem should not update state on provider failure', async () => {
      const item: IRoadmapItem = {
        hash: 'fail1234',
        title: 'Failed Feature',
        description: 'This will fail',
        checked: false,
        section: 'Features',
      };

      // Mock provider to fail
      mockProviderFailure();

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };

      // Get initial state
      const stateBefore = loadRoadmapState(prdDir);
      const processedCountBefore = Object.keys(stateBefore.items).length;

      const result = await sliceRoadmapItem(tempDir, prdDir, item, config);

      expect(result.sliced).toBe(false);
      expect(result.error).toContain('exited with code 1');

      // State should be unchanged
      const stateAfter = loadRoadmapState(prdDir);
      expect(Object.keys(stateAfter.items).length).toBe(processedCountBefore);
    });

    it('sliceRoadmapItem should succeed when provider creates file', async () => {
      const item: IRoadmapItem = {
        hash: 'succ12345',
        title: 'Success Feature',
        description: 'This will succeed',
        checked: false,
        section: 'Features',
      };

      // Mock provider to succeed
      mockProviderSuccess('01-success-feature.md');

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await sliceRoadmapItem(tempDir, prdDir, item, config);

      expect(result.sliced).toBe(true);
      expect(result.file).toBe('01-success-feature.md');

      // Verify file was created
      expect(fs.existsSync(path.join(prdDir, '01-success-feature.md'))).toBe(true);
    });

    it('sliceRoadmapItem should fail when provider succeeds but does not create file', async () => {
      const item: IRoadmapItem = {
        hash: 'nofil1234',
        title: 'No File Feature',
        description: 'No file will be created',
        checked: false,
        section: 'Features',
      };

      // Mock provider to succeed but not create file
      mockProviderNoFile();

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await sliceRoadmapItem(tempDir, prdDir, item, config);

      expect(result.sliced).toBe(false);
      expect(result.error).toContain('did not create expected file');
    });

    it('sliceRoadmapItem should not fail on log stream error', async () => {
      const item: IRoadmapItem = {
        hash: 'logerr12',
        title: 'Log Error Feature',
        description: 'Test log stream error handling',
        checked: false,
        section: 'Features',
      };

      // Create logs directory as a file instead of directory to trigger error
      const logsPath = path.join(tempDir, 'logs');
      fs.writeFileSync(logsPath, 'this is a file, not a directory', 'utf-8');

      // Mock provider to succeed
      mockProviderSuccess('01-log-error-feature.md');

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };

      // The operation should succeed even though log stream errors
      // (log stream errors are logged as warnings but don't fail the slice)
      const result = await sliceRoadmapItem(tempDir, prdDir, item, config);

      expect(result.sliced).toBe(true);
      expect(result.file).toBe('01-log-error-feature.md');
    });

    it('sliceRoadmapItem should close log stream on process error', async () => {
      const item: IRoadmapItem = {
        hash: 'errtest1',
        title: 'Error Test Feature',
        description: 'Test log stream end on process error',
        checked: false,
        section: 'Features',
      };

      // Create a mock provider that errors
      const mockChild = {
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn((event: string, cb: (error: Error) => void) => {
          if (event === 'error') {
            // Trigger error on next tick to allow async setup
            process.nextTick(() => cb(new Error('Spawn failed')));
          }
        }),
      };
      (childProcess.spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockChild);

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await sliceRoadmapItem(tempDir, prdDir, item, config);

      // Verify the operation failed as expected
      expect(result.sliced).toBe(false);
      expect(result.error).toContain('Failed to spawn provider');
    });
  });

  describe('scanRoadmap (async)', () => {
    it('scanRoadmap should process only one item', async () => {
      fs.writeFileSync(
        roadmapPath,
        `## Features
- [ ] Feature One
- [ ] Feature Two
`,
      );

      mockProviderSuccess('01-feature-one.md');

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await scanRoadmap(tempDir, config);

      // Should only process ONE item at most
      expect(result.created.length).toBeLessThanOrEqual(1);
      expect(result.created[0]).toBe('01-feature-one.md');
    });

    it('should handle empty roadmap', async () => {
      fs.writeFileSync(roadmapPath, `## Features\n`);

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await scanRoadmap(tempDir, config);

      expect(result.created).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      // Verify spawn was not called
      expect(childProcess.spawn).not.toHaveBeenCalled();
    });

    it('should do nothing when scanner disabled', async () => {
      fs.writeFileSync(roadmapPath, `## Features\n- [ ] Feature A\n`);

      const config = {
        ...disabledConfig,
        prdDir: path.relative(tempDir, prdDir),
      };
      const result = await scanRoadmap(tempDir, config);

      expect(result.created).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
      // Verify spawn was not called
      expect(childProcess.spawn).not.toHaveBeenCalled();
    });

    it('should handle special characters in title', async () => {
      fs.writeFileSync(
        roadmapPath,
        `## Features
- [ ] Feature with Special/Characters & Symbols!
`,
      );

      mockProviderSuccess('01-feature-with-special-characters-symbols.md');

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await scanRoadmap(tempDir, config);

      expect(result.created).toHaveLength(1);
      expect(result.created[0]).toMatch(/01-feature-with-special-characters-symbols\.md/);
    });

    it('should return error when provider fails', async () => {
      fs.writeFileSync(roadmapPath, `## Features\n- [ ] Failed Feature\n`);

      mockProviderFailure();

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = await scanRoadmap(tempDir, config);

      expect(result.created).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('exited with code');
    });
  });
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runManager } from '../../manager/manager-runner.js';
import type { IBoardProvider } from '../../board/types.js';
import { makeManagerTestConfig } from './manager-test-helpers.js';

describe('manager-runner', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('returns roadmap findings in dry run', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-runner-'));
    tempDirs.push(tempDir);
    fs.writeFileSync(tempDir + '/ROADMAP.md', '## Now\n\n- [ ] Ship API\n  Expose the first endpoint.\n', 'utf-8');
    const provider = {
      getAllIssues: vi.fn().mockResolvedValue([]),
      createIssue: vi.fn(),
    } as unknown as IBoardProvider;

    const result = await runManager(tempDir, makeManagerTestConfig(), {
      dryRun: true,
      boardProvider: provider,
      queueStatus: null,
      now: new Date('2026-05-11T12:00:00Z'),
    });

    expect(result.dryRun).toBe(true);
    expect(result.findings.some((finding) => finding.kind === 'roadmap_gap')).toBe(true);
    expect(result.proposedDrafts).toHaveLength(2);
    expect(result.createdDrafts).toHaveLength(0);
    expect(provider.createIssue).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tempDir, '.night-watch/manager/memory.md'))).toBe(false);
  });

  it('writes only manager-owned docs', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-runner-'));
    tempDirs.push(tempDir);
    fs.writeFileSync(tempDir + '/ROADMAP.md', '## Now\n\n- [x] Done\n', 'utf-8');
    const provider = {
      getAllIssues: vi.fn().mockResolvedValue([]),
      createIssue: vi.fn(),
    } as unknown as IBoardProvider;
    const docsDir = '.night-watch/manager/docs';

    const result = await runManager(
      tempDir,
      makeManagerTestConfig({
        manager: {
          docsDir,
          memoryPath: '.night-watch/manager/memory.md',
          outputMode: 'report-only',
        },
      }),
      {
        dryRun: false,
        boardProvider: provider,
        queueStatus: null,
        now: new Date('2026-05-11T12:00:00Z'),
      },
    );

    const resolvedDocsDir = path.resolve(tempDir, docsDir);
    expect(result.docsWritten).toEqual([path.join(resolvedDocsDir, 'overview.md')]);
    expect(result.docsWritten.every((writtenPath) => writtenPath.startsWith(resolvedDocsDir))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.night-watch/manager/memory.md'))).toBe(true);
  });
});

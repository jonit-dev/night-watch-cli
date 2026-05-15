import { describe, expect, it, vi } from 'vitest';

import { createFindingFingerprint } from '../../manager/manager-memory.js';
import { createManagerBoardDrafts, prepareManagerDrafts } from '../../manager/manager-board.js';
import type { IManagerFinding, IManagerMemoryState, IManagerResolvedConfig } from '../../manager/manager-types.js';
import type { IBoardIssue, IBoardProvider } from '../../board/types.js';

const managerConfig: IManagerResolvedConfig = {
  enabled: true,
  schedule: '0 5 * * *',
  maxRuntime: 900,
  authority: 'draft',
  outputMode: 'board-draft',
  targetColumn: 'Draft',
  memoryPath: '.night-watch/manager/memory.md',
  docsDir: '.night-watch/manager/docs',
  weeklySummaryEnabled: true,
  weeklySummaryDay: 1,
  memoryFile: '/tmp/memory.md',
  docsDirectory: '/tmp/docs',
};

function finding(title = 'Roadmap item needs an owner: Ship API'): IManagerFinding {
  return {
    kind: 'roadmap_gap',
    severity: 'warning',
    title,
    body: 'Missing work item.',
    fingerprint: createFindingFingerprint(['roadmap_gap', title]),
    requiresHuman: false,
    source: 'roadmap:Now',
    labels: ['manager', 'roadmap'],
  };
}

function emptyMemory(): IManagerMemoryState {
  return { fingerprints: new Set(), lastWeeklySummaryAt: null, raw: '' };
}

describe('manager-board', () => {
  it('creates board draft for new finding', async () => {
    const prepared = prepareManagerDrafts({
      findings: [finding()],
      memory: emptyMemory(),
      boardIssues: [],
      managerConfig,
    });
    const provider = {
      createIssue: vi.fn().mockResolvedValue({
        id: '1',
        number: 1,
        title: prepared.drafts[0].title,
        body: prepared.drafts[0].body,
        url: 'https://example.test/1',
        column: 'Draft',
        labels: [],
        assignees: [],
      } satisfies IBoardIssue),
    } as unknown as IBoardProvider;

    const created = await createManagerBoardDrafts({
      provider,
      drafts: prepared.drafts,
      dryRun: false,
      outputMode: 'board-draft',
    });

    expect(created).toHaveLength(1);
    expect(provider.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        column: 'Draft',
        title: '[Manager] Roadmap item needs an owner: Ship API',
      }),
    );
  });

  it('skips existing board issue', () => {
    const existing = finding();
    const prepared = prepareManagerDrafts({
      findings: [existing],
      memory: emptyMemory(),
      boardIssues: [
        {
          id: '1',
          number: 1,
          title: '[Manager] Roadmap item needs an owner: Ship API',
          body: '',
          url: '',
          column: 'Draft',
          labels: [],
          assignees: [],
        },
      ],
      managerConfig,
    });

    expect(prepared.drafts).toHaveLength(0);
    expect(prepared.skipped).toEqual([
      {
        fingerprint: existing.fingerprint,
        title: '[Manager] Roadmap item needs an owner: Ship API',
        reason: 'board',
      },
    ]);
  });
});

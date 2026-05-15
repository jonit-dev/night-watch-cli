import { describe, expect, it } from 'vitest';

import { createFindingFingerprint } from '../../manager/manager-memory.js';
import { prepareManagerNotificationDecisions } from '../../manager/manager-notifications.js';
import type { IManagerFinding, IManagerMemoryState, IManagerResolvedConfig } from '../../manager/manager-types.js';

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

const memory: IManagerMemoryState = { fingerprints: new Set(), lastWeeklySummaryAt: null, raw: '' };

function finding(requiresHuman: boolean): IManagerFinding {
  return {
    kind: requiresHuman ? 'blocked_prd' : 'roadmap_gap',
    severity: requiresHuman ? 'blocker' : 'warning',
    title: requiresHuman ? 'Blocked work' : 'Ordinary gap',
    body: 'Body',
    fingerprint: createFindingFingerprint([requiresHuman ? 'blocked' : 'gap']),
    requiresHuman,
    source: 'test',
    labels: ['manager'],
  };
}

describe('manager-notifications', () => {
  it('notifies blockers only', () => {
    const ordinary = prepareManagerNotificationDecisions({
      findings: [finding(false)],
      memory,
      managerConfig: { ...managerConfig, weeklySummaryEnabled: false },
      now: new Date('2026-05-11T12:00:00Z'),
    });
    const blocked = prepareManagerNotificationDecisions({
      findings: [finding(true)],
      memory,
      managerConfig: { ...managerConfig, weeklySummaryEnabled: false },
      now: new Date('2026-05-11T12:00:00Z'),
    });

    expect(ordinary.find((decision) => decision.event === 'manager_blocked')?.shouldNotify).toBe(false);
    expect(blocked.find((decision) => decision.event === 'manager_blocked')?.shouldNotify).toBe(true);
  });

  it('sends weekly summary once', () => {
    const first = prepareManagerNotificationDecisions({
      findings: [],
      memory,
      managerConfig,
      now: new Date('2026-05-11T12:00:00Z'),
    });
    const second = prepareManagerNotificationDecisions({
      findings: [],
      memory: { ...memory, lastWeeklySummaryAt: new Date('2026-05-11T12:00:00Z') },
      managerConfig,
      now: new Date('2026-05-11T13:00:00Z'),
    });

    expect(first.find((decision) => decision.event === 'manager_weekly_summary')?.shouldNotify).toBe(true);
    expect(second.find((decision) => decision.event === 'manager_weekly_summary')?.shouldNotify).toBe(false);
  });
});

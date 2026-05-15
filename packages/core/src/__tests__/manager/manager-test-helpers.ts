import type { INightWatchConfig } from '../../types.js';

export function makeManagerTestConfig(overrides: Record<string, unknown> = {}): INightWatchConfig {
  return {
    prdDir: 'docs/prds',
    roadmapScanner: {
      roadmapPath: 'ROADMAP.md',
    },
    boardProvider: {
      enabled: false,
      provider: 'local',
    },
    ...overrides,
  } as unknown as INightWatchConfig;
}

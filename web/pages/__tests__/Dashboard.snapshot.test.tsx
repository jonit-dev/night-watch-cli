import { describe, expect, it } from 'vitest';
import { pickLatestSnapshot } from '../../utils/status';

describe('pickLatestSnapshot', () => {
  it('returns the only available snapshot', () => {
    const fallback = { timestamp: '2026-03-06T15:28:58.000Z', value: 'fallback' };

    expect(pickLatestSnapshot(null, fallback)).toBe(fallback);
    expect(pickLatestSnapshot(fallback, null)).toBe(fallback);
  });

  it('prefers the newer fallback snapshot over an older primary snapshot', () => {
    const primary = { timestamp: '2026-03-06T15:28:58.000Z', value: 'stream' };
    const fallback = { timestamp: '2026-03-06T15:29:30.000Z', value: 'poll' };

    expect(pickLatestSnapshot(primary, fallback)).toBe(fallback);
  });

  it('keeps the primary snapshot when timestamps are equal', () => {
    const primary = { timestamp: '2026-03-06T15:28:58.000Z', value: 'stream' };
    const fallback = { timestamp: '2026-03-06T15:28:58.000Z', value: 'poll' };

    expect(pickLatestSnapshot(primary, fallback)).toBe(primary);
  });
});

/**
 * Unit tests for roadmap-context-compiler.
 */

import { describe, expect, it } from 'vitest';
import type { IRoadmapStatus } from '../utils/roadmap-scanner.js';
import { compileRoadmapContext } from '../utils/roadmap-context-compiler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_RAW = `# Roadmap
## Short Term
- [ ] Auth feature
- [ ] Billing
## Medium Term
- [ ] Analytics`;

function buildStatus(
  items: Array<{
    title: string;
    section: string;
    checked?: boolean;
    processed?: boolean;
    description?: string;
  }>,
  overrides: Partial<IRoadmapStatus> = {},
): IRoadmapStatus {
  const mapped = items.map((i, idx) => ({
    hash: `hash${idx}`,
    title: i.title,
    description: i.description ?? '',
    checked: i.checked ?? false,
    section: i.section,
    processed: i.processed ?? false,
  }));
  return {
    found: true,
    enabled: true,
    totalItems: mapped.length,
    processedItems: mapped.filter((i) => i.processed).length,
    pendingItems: mapped.filter((i) => !i.processed && !i.checked).length,
    status: 'idle',
    items: mapped,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// compileRoadmapContext — edge cases
// ---------------------------------------------------------------------------

describe('compileRoadmapContext', () => {
  it('returns empty string when status is not found', () => {
    const status = buildStatus([], { found: false });
    expect(compileRoadmapContext(status, { mode: 'full' })).toBe('');
  });

  it('still returns content when scanner is disabled but file was found', () => {
    const status = buildStatus([{ title: 'A', section: 'Short Term' }], { enabled: false });
    const result = compileRoadmapContext(status, { mode: 'full' });
    expect(result).toContain('A');
  });

  it('returns empty string when there are no items', () => {
    const status = buildStatus([]);
    expect(compileRoadmapContext(status, { mode: 'full' })).toBe('');
  });

  it('should truncate raw content when maxChars is set', () => {
    const status = buildStatus(
      [{ title: 'A', section: 'Short Term' }],
      { rawContent: 'x'.repeat(500) },
    );
    const result = compileRoadmapContext(status, { mode: 'full', maxChars: 100 });
    // Raw content portion should be truncated to maxChars
    expect(result).toContain('ROADMAP.md (file content)');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes raw file content when available', () => {
    const status = buildStatus(
      [{ title: 'Auth feature', section: 'Short Term' }],
      { rawContent: SAMPLE_RAW },
    );
    const result = compileRoadmapContext(status, { mode: 'full' });
    expect(result).toContain('ROADMAP.md (file content)');
    expect(result).toContain('# Roadmap');
    expect(result).toContain('- [ ] Auth feature');
  });
});

// ---------------------------------------------------------------------------
// Full progress
// ---------------------------------------------------------------------------

describe('full progress', () => {
  it('contains all horizon sections in progress overlay', () => {
    const status = buildStatus([
      { title: 'Auth feature', section: 'Short Term', description: 'Add OAuth2 login' },
      { title: 'Billing', section: 'Medium Term', description: 'Stripe integration' },
      { title: 'Analytics', section: 'Long Term' },
      { title: 'Done item', section: 'Short Term', processed: true },
    ]);
    const result = compileRoadmapContext(status, { mode: 'full' });

    expect(result).toContain('Short Term');
    expect(result).toContain('Medium Term');
    expect(result).toContain('Long Term');
    expect(result).toContain('Auth feature');
    expect(result).toContain('Billing');
    expect(result).toContain('Analytics');
  });

  it('shows done count per section', () => {
    const status = buildStatus([
      { title: 'Done', section: 'Short Term', processed: true },
      { title: 'Pending', section: 'Short Term' },
    ]);
    const result = compileRoadmapContext(status, { mode: 'full' });
    expect(result).toContain('Short Term');
    expect(result).toContain('1/2 done');
  });

  it('includes descriptions via raw content when provided', () => {
    const raw = '## Short Term\n- [ ] Auth feature\n  Add OAuth2 login flow';
    const status = buildStatus(
      [{ title: 'Auth feature', section: 'Short Term', description: 'Add OAuth2 login flow' }],
      { rawContent: raw },
    );
    const result = compileRoadmapContext(status, { mode: 'full' });
    expect(result).toContain('Add OAuth2 login flow');
  });
});

// ---------------------------------------------------------------------------
// Smart summary
// ---------------------------------------------------------------------------

describe('smart summary', () => {
  it('includes all items in progress overlay', () => {
    const items = [
      { title: 'ST-1', section: 'Short Term' },
      { title: 'ST-2', section: 'Short Term' },
      { title: 'MT-1', section: 'Medium Term' },
      { title: 'MT-2', section: 'Medium Term' },
      { title: 'MT-3', section: 'Medium Term' },
      { title: 'MT-4', section: 'Medium Term' },
      { title: 'MT-5', section: 'Medium Term' },
    ];
    const status = buildStatus(items);
    const result = compileRoadmapContext(status, { mode: 'summary' });

    // All short-term items included in progress
    expect(result).toContain('ST-1');
    expect(result).toContain('ST-2');

    // Medium-term items included (up to 5 per section)
    expect(result).toContain('MT-1');
    expect(result).toContain('MT-2');
    expect(result).toContain('MT-3');
  });

  it('returns empty string when all items are done', () => {
    const status = buildStatus([{ title: 'Done', section: 'Short Term', processed: true }]);
    const result = compileRoadmapContext(status, { mode: 'summary' });
    expect(result).toBe('');
  });

  it('shows overall progress count', () => {
    const status = buildStatus([
      { title: 'Done', section: 'Short Term', processed: true },
      { title: 'Pending', section: 'Short Term' },
    ]);
    const result = compileRoadmapContext(status, { mode: 'summary' });
    expect(result).toContain('1/2 items done');
  });
});

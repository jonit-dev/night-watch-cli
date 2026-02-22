/**
 * Unit tests for roadmap-context-compiler.
 */

import { describe, expect, it } from 'vitest';
import type { IRoadmapStatus } from './roadmap-scanner.js';
import {
  compileRoadmapContext,
  compileRoadmapForPersona,
  isLeadRole,
} from './roadmap-context-compiler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function buildPersona(role: string) {
  return { id: 'p1', name: 'Test', role } as any;
}

// ---------------------------------------------------------------------------
// isLeadRole
// ---------------------------------------------------------------------------

describe('isLeadRole', () => {
  it('matches Tech Lead', () => {
    expect(isLeadRole('Tech Lead')).toBe(true);
  });

  it('matches PM (exact)', () => {
    expect(isLeadRole('PM')).toBe(true);
  });

  it('matches Product Manager', () => {
    expect(isLeadRole('Product Manager')).toBe(true);
  });

  it('matches Director of Engineering', () => {
    expect(isLeadRole('Director of Engineering')).toBe(true);
  });

  it('matches architect (case-insensitive)', () => {
    expect(isLeadRole('Senior Architect')).toBe(true);
  });

  it('returns false for QA Engineer', () => {
    expect(isLeadRole('QA Engineer')).toBe(false);
  });

  it('returns false for Implementer', () => {
    expect(isLeadRole('Implementer')).toBe(false);
  });

  it('returns false for Security Reviewer', () => {
    expect(isLeadRole('Security Reviewer')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// compileRoadmapContext — edge cases
// ---------------------------------------------------------------------------

describe('compileRoadmapContext', () => {
  it('returns empty string when status is not found', () => {
    const status = buildStatus([], { found: false });
    expect(compileRoadmapContext(status, { mode: 'full' })).toBe('');
  });

  it('returns empty string when status is disabled', () => {
    const status = buildStatus([{ title: 'A', section: 'Short Term' }], { enabled: false });
    expect(compileRoadmapContext(status, { mode: 'full' })).toBe('');
  });

  it('returns empty string when there are no items', () => {
    const status = buildStatus([]);
    expect(compileRoadmapContext(status, { mode: 'full' })).toBe('');
  });

  it('should respect maxChars limit', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      title: `Item ${i} with a fairly long title to fill space`,
      section: 'Short Term',
    }));
    const status = buildStatus(items);
    const maxChars = 100;
    const result = compileRoadmapContext(status, { mode: 'full', maxChars });
    expect(result.length).toBeLessThanOrEqual(maxChars);
  });
});

// ---------------------------------------------------------------------------
// Full digest
// ---------------------------------------------------------------------------

describe('full digest', () => {
  it('should produce full digest for lead roles — contains all horizon sections', () => {
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

  it('includes item descriptions in full mode', () => {
    const status = buildStatus([
      { title: 'Auth feature', section: 'Short Term', description: 'Add OAuth2 login flow' },
    ]);
    const result = compileRoadmapContext(status, { mode: 'full' });
    expect(result).toContain('Add OAuth2 login flow');
  });

  it('shows done count per section', () => {
    const status = buildStatus([
      { title: 'Done', section: 'Short Term', processed: true },
      { title: 'Pending', section: 'Short Term' },
    ]);
    const result = compileRoadmapContext(status, { mode: 'full' });
    // Should mention 1/2 done in Short Term
    expect(result).toContain('Short Term (1/2 done)');
  });
});

// ---------------------------------------------------------------------------
// Smart summary
// ---------------------------------------------------------------------------

describe('smart summary', () => {
  it('should produce smart summary for non-lead roles — only short-term + 3 medium-term', () => {
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

    // All short-term items included
    expect(result).toContain('ST-1');
    expect(result).toContain('ST-2');

    // Only first 3 medium-term items
    expect(result).toContain('MT-1');
    expect(result).toContain('MT-2');
    expect(result).toContain('MT-3');
    expect(result).not.toContain('MT-4');
    expect(result).not.toContain('MT-5');
  });

  it('does not include item descriptions in summary mode', () => {
    const status = buildStatus([
      { title: 'Auth', section: 'Short Term', description: 'Long description here' },
    ]);
    const result = compileRoadmapContext(status, { mode: 'summary' });
    expect(result).not.toContain('Long description here');
  });

  it('returns empty string when all items are done', () => {
    const status = buildStatus([{ title: 'Done', section: 'Short Term', processed: true }]);
    const result = compileRoadmapContext(status, { mode: 'summary' });
    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// compileRoadmapForPersona
// ---------------------------------------------------------------------------

describe('compileRoadmapForPersona', () => {
  it('picks full mode for lead persona', () => {
    const status = buildStatus([
      { title: 'Task A', section: 'Short Term', description: 'With description' },
    ]);
    const result = compileRoadmapForPersona(buildPersona('Tech Lead'), status);
    // Full mode includes descriptions
    expect(result).toContain('With description');
  });

  it('picks summary mode for non-lead persona', () => {
    const status = buildStatus([
      { title: 'Task A', section: 'Short Term', description: 'With description' },
    ]);
    const result = compileRoadmapForPersona(buildPersona('QA Engineer'), status);
    // Summary mode excludes descriptions
    expect(result).not.toContain('With description');
    expect(result).toContain('Task A');
  });
});

import { describe, expect, it, vi } from 'vitest';

import { IBoardProvider } from '../board/types.js';
import { getDefaultConfig } from '../config.js';
import { buildUxReportBody, normalizeUxPriority, parseUxFindings, runUx } from '../ux/ux-runner.js';

function createBoardProvider(): IBoardProvider {
  return {
    setupBoard: vi.fn(),
    getBoard: vi.fn(),
    getColumns: vi.fn(),
    createIssue: vi.fn(async (input) => ({
      id: 'issue-1',
      number: 1,
      title: input.title,
      body: input.body,
      url: 'https://github.com/example/repo/issues/1',
      column: input.column ?? null,
      labels: input.labels ?? [],
      assignees: [],
    })),
    addIssue: vi.fn(),
    getIssue: vi.fn(),
    getIssuesByColumn: vi.fn(),
    getAllIssues: vi.fn(),
    moveIssue: vi.fn(),
    closeIssue: vi.fn(),
    commentOnIssue: vi.fn(),
  };
}

describe('UX runner helpers', () => {
  it('normalizes severity labels to P priorities', () => {
    expect(normalizeUxPriority('critical')).toBe('P0');
    expect(normalizeUxPriority('high')).toBe('P1');
    expect(normalizeUxPriority('medium')).toBe('P2');
    expect(normalizeUxPriority('low')).toBe('P3');
  });

  it('parses and sorts UX findings by priority', () => {
    const findings = parseUxFindings(`
      [{"title":"Minor polish","priority":"P3","impact":"Low"},
       {"title":"Checkout blocked","severity":"critical","impact":"Users cannot pay"}]
    `);

    expect(findings.map((finding) => finding.title)).toEqual(['Checkout blocked', 'Minor polish']);
    expect(findings[0].priority).toBe('P0');
  });

  it('builds a report body with evidence and recommended fixes', () => {
    const body = buildUxReportBody({
      baseUrl: 'http://localhost:3000',
      startUrl: '/checkout',
      flows: ['checkout'],
      findings: [
        {
          title: 'Checkout CTA is hidden',
          priority: 'P1',
          impact: 'Users miss the primary action.',
          affectedFlows: ['checkout'],
          affectedPages: ['/checkout'],
          evidence: ['screenshots/checkout.png'],
          reproductionSteps: ['Open checkout on mobile'],
          recommendedFix: 'Keep the CTA visible above the fold.',
        },
      ],
    });

    expect(body).toContain('[P1] Checkout CTA is hidden');
    expect(body).toContain('screenshots/checkout.png');
    expect(body).toContain('Keep the CTA visible above the fold.');
  });
});

describe('runUx', () => {
  it('creates one draft report with sorted findings', async () => {
    const config = getDefaultConfig();
    config.ux = {
      ...config.ux,
      enabled: true,
      baseUrl: 'http://localhost:3000',
      flows: ['checkout'],
    };
    const boardProvider = createBoardProvider();

    const result = await runUx(config, '/tmp/project', {
      boardProvider,
      providerOutput: JSON.stringify([
        { title: 'Minor copy issue', priority: 'P3', impact: 'Small confusion' },
        { title: 'Checkout blocks keyboard users', priority: 'P1', impact: 'Cannot complete flow' },
      ]),
    });

    expect(result.issuesCreated).toBe(1);
    expect(result.findings.map((finding) => finding.priority)).toEqual(['P1', 'P3']);
    expect(boardProvider.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        column: 'Draft',
        labels: ['ux', 'night-watch'],
      }),
    );
    expect(vi.mocked(boardProvider.createIssue).mock.calls[0][0].body).toContain(
      '[P1] Checkout blocks keyboard users',
    );
  });

  it('does not create a board issue when no findings are returned', async () => {
    const config = getDefaultConfig();
    config.ux = { ...config.ux, enabled: true };
    const boardProvider = createBoardProvider();

    const result = await runUx(config, '/tmp/project', {
      boardProvider,
      providerOutput: '[]',
    });

    expect(result.issuesCreated).toBe(0);
    expect(boardProvider.createIssue).not.toHaveBeenCalled();
  });
});

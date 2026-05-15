import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PerformanceDashboard from '../PerformanceDashboard.js';
import { useStore } from '../../../store/useStore.js';

const now = Date.now();

const summary = {
  projectPath: '/tmp/night-watch',
  windows: {
    last7Days: {
      days: 7,
      fromFinishedAt: now - 7 * 24 * 60 * 60 * 1000,
      toFinishedAt: now,
      totalCount: 4,
      successCount: 3,
      failureCount: 1,
      timeoutCount: 0,
      rateLimitedCount: 0,
      skippedCount: 0,
      successRate: 0.75,
      averageDurationSeconds: 90,
      byOutcome: { success: 3, failure: 1 },
      byFailureCategory: { tests: 1 },
      byJobType: {
        executor: {
          totalCount: 4,
          successCount: 3,
          failureCount: 1,
          timeoutCount: 0,
          rateLimitedCount: 0,
          skippedCount: 0,
          successRate: 0.75,
        },
      },
      byProvider: {
        codex: {
          totalCount: 4,
          successCount: 3,
          failureCount: 1,
          timeoutCount: 0,
          rateLimitedCount: 0,
          skippedCount: 0,
          successRate: 0.75,
        },
      },
    },
    last30Days: {
      days: 30,
      fromFinishedAt: now - 30 * 24 * 60 * 60 * 1000,
      toFinishedAt: now,
      totalCount: 10,
      successCount: 6,
      failureCount: 3,
      timeoutCount: 1,
      rateLimitedCount: 0,
      skippedCount: 0,
      successRate: 0.6,
      averageDurationSeconds: 125,
      byOutcome: { success: 6, failure: 3, timeout: 1 },
      byFailureCategory: { tests: 2, lint: 1 },
      byJobType: {
        executor: {
          totalCount: 6,
          successCount: 4,
          failureCount: 2,
          timeoutCount: 0,
          rateLimitedCount: 0,
          skippedCount: 0,
          successRate: 0.67,
        },
        reviewer: {
          totalCount: 4,
          successCount: 2,
          failureCount: 1,
          timeoutCount: 1,
          rateLimitedCount: 0,
          skippedCount: 0,
          successRate: 0.5,
        },
      },
      byProvider: {
        codex: {
          totalCount: 7,
          successCount: 5,
          failureCount: 2,
          timeoutCount: 0,
          rateLimitedCount: 0,
          skippedCount: 0,
          successRate: 0.71,
        },
        claude: {
          totalCount: 3,
          successCount: 1,
          failureCount: 1,
          timeoutCount: 1,
          rateLimitedCount: 0,
          skippedCount: 0,
          successRate: 0.33,
        },
      },
    },
  },
  activeAugmentations: [
    {
      id: 7,
      projectPath: '/tmp/night-watch',
      patternId: 1,
      jobType: 'executor',
      promptText: 'Check flaky test setup before editing.',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
      appliedCount: 2,
      successCount: 1,
    },
  ],
};

const patterns = {
  projectPath: '/tmp/night-watch',
  patterns: [
    {
      id: 1,
      projectPath: '/tmp/night-watch',
      patternKey: 'executor:tests',
      jobType: 'executor',
      category: 'tests',
      title: 'Repeated test failures',
      description: 'Executor runs repeatedly fail in the test suite.',
      sampleCount: 3,
      confidence: 0.82,
      firstSeenAt: now - 1000,
      lastSeenAt: now,
      status: 'active',
      metadata: {},
    },
  ],
  topFailurePatterns: [
    {
      key: 'executor:codex:tests:vitest failed',
      jobType: 'executor',
      providerKey: 'codex',
      category: 'tests',
      signature: 'vitest failed',
      sampleCount: 2,
      lastSeenAt: now,
    },
  ],
};

function stubFeedbackFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/feedback/summary')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(summary),
      } as Response);
    }
    if (url.endsWith('/api/feedback/patterns')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(patterns),
      } as Response);
    }
    return Promise.reject(new Error(`Unhandled URL: ${url}`));
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('PerformanceDashboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders compact dashboard analytics without detailed breakdowns', async () => {
    useStore.setState({ globalModeLoading: false, selectedProjectId: null });
    const fetchMock = stubFeedbackFetch();

    render(<PerformanceDashboard variant="compact" onViewDetails={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByText('Basic Analytics')).toBeInTheDocument();
    });

    expect(screen.getByText('7 Day Success')).toBeInTheDocument();
    expect(screen.getByText('30 Day Success')).toBeInTheDocument();
    expect(screen.getByText('Failures')).toBeInTheDocument();
    expect(screen.getByText('Avg Duration')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view analytics/i })).toBeInTheDocument();
    expect(screen.queryByText('Success-Rate Trend')).not.toBeInTheDocument();
    expect(screen.queryByText('Failure Categories')).not.toBeInTheDocument();
    expect(screen.queryByText('Job Breakdown')).not.toBeInTheDocument();
    expect(screen.queryByText('Provider Breakdown')).not.toBeInTheDocument();
    expect(screen.queryByText('Repeated test failures')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/feedback/patterns'));
  });

  it('renders full analytics details', async () => {
    useStore.setState({ globalModeLoading: false, selectedProjectId: null });
    stubFeedbackFetch();

    render(<PerformanceDashboard />);

    await waitFor(() => {
      expect(screen.getAllByText('75%').length).toBeGreaterThan(0);
    });

    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('Success-Rate Trend')).toBeInTheDocument();
    expect(screen.getByText('Failure Categories')).toBeInTheDocument();
    expect(screen.getByText('Job Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Provider Breakdown')).toBeInTheDocument();
    expect(screen.getByText('reviewer')).toBeInTheDocument();
    expect(screen.getAllByText('codex').length).toBeGreaterThan(0);
    expect(screen.getByText('Repeated test failures')).toBeInTheDocument();
    expect(screen.getByText('Check flaky test setup before editing.')).toBeInTheDocument();
  });
});

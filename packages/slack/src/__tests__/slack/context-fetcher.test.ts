/**
 * Tests for ContextFetcher URL fetching and GitHub issue/PR context.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

import { execFileSync } from 'child_process';
import { ContextFetcher } from '../../context-fetcher.js';

function buildFetcher(): ContextFetcher {
  return new ContextFetcher();
}

describe('ContextFetcher', () => {
  let fetcher: ContextFetcher;

  beforeEach(() => {
    vi.resetAllMocks();
    fetcher = buildFetcher();
  });

  describe('fetchUrlSummaries', () => {
    it('returns empty string for empty URL list', async () => {
      const result = await fetcher.fetchUrlSummaries([]);
      expect(result).toBe('');
    });

    it('should fetch up to 4 URLs', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () =>
          '<title>Test Page</title><meta name="description" content="Test description">',
      } as Response);

      const urls = [
        'https://example.com/1',
        'https://example.com/2',
        'https://example.com/3',
        'https://example.com/4',
        'https://example.com/5',
      ];

      await fetcher.fetchUrlSummaries(urls);

      // Should call fetch exactly 4 times (slice(0, 4)), not 5
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      expect(fetchSpy).toHaveBeenCalledWith('https://example.com/1', expect.any(Object));
      expect(fetchSpy).toHaveBeenCalledWith('https://example.com/2', expect.any(Object));
      expect(fetchSpy).toHaveBeenCalledWith('https://example.com/3', expect.any(Object));
      expect(fetchSpy).toHaveBeenCalledWith('https://example.com/4', expect.any(Object));
      expect(fetchSpy).not.toHaveBeenCalledWith('https://example.com/5', expect.any(Object));
    });

    it('includes title and description in output', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () =>
          '<title>My Page Title</title><meta name="description" content="My description here">',
      } as Response);

      const result = await fetcher.fetchUrlSummaries(['https://example.com']);

      expect(result).toContain('My Page Title');
      expect(result).toContain('My description here');
    });

    it('skips URLs that return non-ok responses', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        text: async () => '',
      } as Response);

      const result = await fetcher.fetchUrlSummaries(['https://example.com/404']);
      expect(result).toBe('');
    });

    it('skips URLs that throw fetch errors', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await fetcher.fetchUrlSummaries(['https://example.com/error']);
      expect(result).toBe('');
    });
  });

  describe('fetchGitHubIssueContext', () => {
    it('returns empty string for empty URL list', async () => {
      const result = await fetcher.fetchGitHubIssueContext([]);
      expect(result).toBe('');
    });

    it('should fetch up to 5 GitHub URLs', async () => {
      vi.mocked(execFileSync).mockReturnValue(
        Buffer.from(
          JSON.stringify({
            title: 'Test issue',
            state: 'open',
            body: 'Issue body',
            labels: [],
          }),
        ),
      );

      const urls = [
        'https://github.com/org/repo/issues/1',
        'https://github.com/org/repo/issues/2',
        'https://github.com/org/repo/issues/3',
        'https://github.com/org/repo/issues/4',
        'https://github.com/org/repo/issues/5',
        'https://github.com/org/repo/issues/6',
      ];

      await fetcher.fetchGitHubIssueContext(urls);

      // Should call execFileSync exactly 5 times (slice(0, 5)), not 6
      expect(execFileSync).toHaveBeenCalledTimes(5);
    });

    it('skips non-GitHub URLs', async () => {
      await fetcher.fetchGitHubIssueContext(['https://example.com/issues/42']);

      expect(execFileSync).not.toHaveBeenCalled();
    });

    it('formats GitHub issue output correctly', async () => {
      vi.mocked(execFileSync).mockReturnValue(
        Buffer.from(
          JSON.stringify({
            title: 'Auth token not refreshed',
            state: 'open',
            body: 'The token expires without refresh.',
            labels: ['bug', 'auth'],
          }),
        ),
      );

      const result = await fetcher.fetchGitHubIssueContext([
        'https://github.com/org/repo/issues/99',
      ]);

      expect(result).toContain('Issue #99');
      expect(result).toContain('Auth token not refreshed');
      expect(result).toContain('open');
      expect(result).toContain('bug');
      expect(result).toContain('The token expires without refresh.');
    });

    it('handles gh CLI failure gracefully', async () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error('gh not found');
      });

      const result = await fetcher.fetchGitHubIssueContext([
        'https://github.com/org/repo/issues/1',
      ]);

      expect(result).toBe('');
    });
  });
});

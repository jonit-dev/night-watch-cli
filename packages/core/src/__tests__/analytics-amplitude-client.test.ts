/**
 * Tests for the Amplitude REST API client
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fetchAmplitudeData,
  buildAuthHeader,
  buildDateRange,
} from '../analytics/amplitude-client.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('amplitude-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildAuthHeader', () => {
    it('should construct correct Basic auth header', () => {
      const header = buildAuthHeader('test-api-key', 'test-secret-key');
      expect(header).toBe('Basic dGVzdC1hcGkta2V5OnRlc3Qtc2VjcmV0LWtleQ==');
    });

    it('should handle special characters in keys', () => {
      const header = buildAuthHeader('key-with:colon', 'secret');
      expect(header).toMatch(/^Basic /);
      const decoded = Buffer.from(header.replace('Basic ', ''), 'base64').toString();
      expect(decoded).toBe('key-with:colon:secret');
    });
  });

  describe('buildDateRange', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-07T00:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should calculate correct date range for 7 days lookback', () => {
      const range = buildDateRange(7);
      expect(range.start).toBe('20260228');
      expect(range.end).toBe('20260307');
    });

    it('should calculate correct date range for 1 day lookback', () => {
      const range = buildDateRange(1);
      expect(range.start).toBe('20260306');
      expect(range.end).toBe('20260307');
    });

    it('should calculate correct date range for 30 days lookback', () => {
      const range = buildDateRange(30);
      expect(range.start).toBe('20260205');
      expect(range.end).toBe('20260307');
    });
  });

  describe('fetchAmplitudeData', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-07T00:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should fetch all Amplitude endpoints with correct auth', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: 'mock' }),
      } as Response);

      const result = await fetchAmplitudeData('test-key', 'test-secret', 7);

      expect(mockFetch).toHaveBeenCalledTimes(4);
      expect(result).toHaveProperty('activeUsers');
      expect(result).toHaveProperty('eventSegmentation');
      expect(result).toHaveProperty('retention');
      expect(result).toHaveProperty('userSessions');
      expect(result).toHaveProperty('fetchedAt');
      expect(result.lookbackDays).toBe(7);

      // Check auth header
      const calls = mockFetch.mock.calls;
      for (const call of calls) {
        const options = call[1] as RequestInit;
        expect(options.headers?.Authorization).toBe('Basic dGVzdC1rZXk6dGVzdC1zZWNyZXQ=');
      }
    });

    it('should throw on 401 authentication failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response);

      await expect(fetchAmplitudeData('key', 'secret', 7)).rejects.toThrow(/authentication.*401/);
    });

    it('should throw on 429 rate limit', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      } as Response);

      await expect(fetchAmplitudeData('key', 'secret', 7)).rejects.toThrow(/rate limit.*429/);
    });

    it('should throw on other API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      await expect(fetchAmplitudeData('key', 'secret', 7)).rejects.toThrow(/API error.*500/);
    });

    it('should handle partial failures gracefully', async () => {
      // First call succeeds, second fails, third and fourth succeed
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ active: 100 }),
        } as Response)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ retention: 'data' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sessions: 'data' }),
        } as Response);

      const result = await fetchAmplitudeData('key', 'secret', 7);

      expect(result.activeUsers).toEqual({ active: 100 });
      expect(result.eventSegmentation).toBeNull(); // Failed
      expect(result.retention).toEqual({ retention: 'data' });
      expect(result.userSessions).toEqual({ sessions: 'data' });
    });

    it('should use correct date range in API calls', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      await fetchAmplitudeData('key', 'secret', 14);

      const calls = mockFetch.mock.calls;
      // Check that all URLs contain the correct date range
      for (const call of calls) {
        const url = call[0] as string;
        expect(url).toContain('start=20260221');
        expect(url).toContain('end=20260307');
      }
    });

    it('should use /api/2/users?m=active for active users endpoint', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      await fetchAmplitudeData('key', 'secret', 7);

      const urls = mockFetch.mock.calls.map((call) => call[0] as string);
      const activeUsersUrl = urls.find((u) => u.includes('/users'));
      expect(activeUsersUrl).toContain('/api/2/users?m=active&start=');
      expect(activeUsersUrl).not.toContain('/users/active');
    });

    it('should include fetchedAt timestamp', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      const result = await fetchAmplitudeData('key', 'secret', 7);

      expect(result.fetchedAt).toBe('2026-03-07T00:00:00.000Z');
    });
  });
});

/**
 * Tests for BoundedCache - a size-bounded FIFO cache with automatic eviction.
 */

import { describe, expect, it } from 'vitest';
import { BoundedCache } from '../../bounded-cache.js';

describe('BoundedCache', () => {
  describe('basic operations', () => {
    it('stores and retrieves values', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 10 });
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
      expect(cache.size).toBe(1);
    });

    it('returns undefined for missing keys', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 10 });
      expect(cache.get('missing')).toBeUndefined();
    });

    it('checks key existence with has()', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 10 });
      expect(cache.has('a')).toBe(false);
      cache.set('a', 1);
      expect(cache.has('a')).toBe(true);
    });

    it('deletes entries', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 10 });
      cache.set('a', 1);
      expect(cache.delete('a')).toBe(true);
      expect(cache.has('a')).toBe(false);
      expect(cache.size).toBe(0);
    });

    it('clears all entries', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 10 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeUndefined();
    });
  });

  describe('eviction behavior', () => {
    it('evicts oldest entry when limit is exceeded', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 3 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      expect(cache.size).toBe(3);

      // Adding 'd' should evict 'a' (oldest)
      cache.set('d', 4);
      expect(cache.size).toBe(3);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('enforces maxSize limit across multiple insertions', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 100 });
      for (let i = 0; i < 200; i++) {
        cache.set(`key-${i}`, i);
      }
      expect(cache.size).toBe(100);
      // First 100 entries should be evicted
      expect(cache.has('key-0')).toBe(false);
      expect(cache.has('key-99')).toBe(false);
      // Last 100 entries should be present
      expect(cache.has('key-100')).toBe(true);
      expect(cache.has('key-199')).toBe(true);
    });

    it('evicts in FIFO order regardless of access frequency', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 3 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Access 'a' multiple times - should not affect eviction order
      cache.get('a');
      cache.get('a');
      cache.get('a');

      // Adding 'd' should still evict 'a' (first in, first out)
      cache.set('d', 4);
      expect(cache.has('a')).toBe(false);
    });

    it('handles updating existing key without eviction', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 3 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Update existing key - should not trigger eviction
      cache.set('b', 20);
      expect(cache.size).toBe(3);
      expect(cache.get('b')).toBe(20);
      expect(cache.has('a')).toBe(true);
      expect(cache.has('c')).toBe(true);
    });

    it('maintains FIFO order after multiple updates', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 3 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Update 'a' - should not change its position in eviction order
      cache.set('a', 10);

      // Add new entry - should evict 'a' (oldest in FIFO)
      cache.set('d', 4);
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles maxSize of 1', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 1 });
      cache.set('a', 1);
      expect(cache.size).toBe(1);
      cache.set('b', 2);
      expect(cache.size).toBe(1);
      expect(cache.has('a')).toBe(false);
      expect(cache.get('b')).toBe(2);
    });

    it('handles delete of oldest key correctly', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 3 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Delete oldest key
      cache.delete('a');

      // Add new key - should not evict since we're under limit
      cache.set('d', 4);
      expect(cache.size).toBe(3);
      expect(cache.has('b')).toBe(true);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
    });

    it('handles delete of middle key correctly', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 3 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Delete middle key
      cache.delete('b');

      // Add new key - no eviction since we're now at size 2 (below maxSize 3)
      cache.set('d', 4);
      expect(cache.has('a')).toBe(true);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
      expect(cache.size).toBe(3);

      // Add another key - should evict 'a' (oldest)
      cache.set('e', 5);
      expect(cache.has('a')).toBe(false);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
      expect(cache.has('e')).toBe(true);
    });
  });

  describe('use case: emojiCadenceCounter', () => {
    it('simulates emojiCadenceCounter usage pattern', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 1000 });

      // Simulate channel:threadTs:personaId key pattern
      const makeKey = (channel: string, threadTs: string, personaId: string) =>
        `${channel}:${threadTs}:${personaId}`;

      // First post in thread
      const key = makeKey('C123', '1234567890.123', 'dev-1');
      const count = (cache.get(key) ?? 0) + 1;
      cache.set(key, count);
      expect(cache.get(key)).toBe(1);

      // Second post in same thread
      const count2 = (cache.get(key) ?? 0) + 1;
      cache.set(key, count2);
      expect(cache.get(key)).toBe(2);

      // Cache should remain bounded
      expect(cache.size).toBe(1);
    });

    it('handles cache pressure with many unique keys', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 100 });

      // Simulate many unique threads
      for (let i = 0; i < 500; i++) {
        const key = `C123:${i}.123:dev-${i % 5}`;
        const count = (cache.get(key) ?? 0) + 1;
        cache.set(key, count);
      }

      // Cache should be capped at maxSize
      expect(cache.size).toBe(100);
    });
  });
});

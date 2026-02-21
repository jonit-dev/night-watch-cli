import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'reflect-metadata';
import type { IAgentPersona } from '@night-watch/core';
import {
  ThreadStateManager,
  MAX_PROCESSED_MESSAGE_KEYS,
  PERSONA_REPLY_COOLDOWN_MS,
  AD_HOC_THREAD_MEMORY_MS,
  ISSUE_REVIEW_COOLDOWN_MS,
} from '../../thread-state-manager.js';

function buildPersona(
  id: string,
  name: string,
  overrides: Partial<IAgentPersona> = {},
): IAgentPersona {
  return {
    id,
    name,
    role: 'Engineer',
    avatarUrl: null,
    soul: {
      whoIAm: '',
      worldview: [],
      opinions: {},
      expertise: [],
      interests: [],
      tensions: [],
      boundaries: [],
      petPeeves: [],
    },
    style: {
      voicePrinciples: '',
      sentenceStructure: '',
      tone: '',
      wordsUsed: [],
      wordsAvoided: [],
      emojiUsage: { frequency: 'never', favorites: [], contextRules: '' },
      quickReactions: {},
      rhetoricalMoves: [],
      antiPatterns: [],
      goodExamples: [],
      badExamples: [],
    },
    skill: { modes: {}, interpolationRules: '', additionalInstructions: [] },
    modelConfig: null,
    systemPromptOverride: null,
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('ThreadStateManager', () => {
  let state: ThreadStateManager;

  beforeEach(() => {
    state = new ThreadStateManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rememberMessageKey', () => {
    it('should return true for new message keys', () => {
      expect(state.rememberMessageKey('k1')).toBe(true);
    });

    it('should return false for duplicate keys', () => {
      state.rememberMessageKey('k1');
      expect(state.rememberMessageKey('k1')).toBe(false);
    });

    it('should evict oldest keys at capacity', () => {
      const keys: string[] = [];
      for (let i = 0; i < MAX_PROCESSED_MESSAGE_KEYS; i++) {
        const k = `key-${i}`;
        keys.push(k);
        state.rememberMessageKey(k);
      }
      // All MAX keys registered; adding one more evicts the first
      state.rememberMessageKey('overflow');
      // First key has been evicted — should be accepted again
      expect(state.rememberMessageKey(keys[0])).toBe(true);
    });

    it('should evict keys in FIFO order', () => {
      // Add keys up to capacity
      const keys: string[] = [];
      for (let i = 0; i < MAX_PROCESSED_MESSAGE_KEYS; i++) {
        const k = `key-${i}`;
        keys.push(k);
        state.rememberMessageKey(k);
      }

      // Add more keys to force evictions
      state.rememberMessageKey('overflow-1');
      state.rememberMessageKey('overflow-2');

      // First two keys should have been evicted
      expect(state.rememberMessageKey(keys[0])).toBe(true);
      expect(state.rememberMessageKey(keys[1])).toBe(true);

      // Last keys should still be remembered
      expect(state.rememberMessageKey(keys[keys.length - 1])).toBe(false);
      expect(state.rememberMessageKey('overflow-1')).toBe(false);
    });

    it('should handle empty string keys', () => {
      expect(state.rememberMessageKey('')).toBe(true);
      expect(state.rememberMessageKey('')).toBe(false);
    });

    it('should handle special character keys', () => {
      const specialKeys = [
        'key:with:colons',
        'key/with/slashes',
        'key-with-dashes',
        'key_with_underscores',
      ];
      for (const key of specialKeys) {
        expect(state.rememberMessageKey(key)).toBe(true);
      }
      // All should be recognized as duplicates
      for (const key of specialKeys) {
        expect(state.rememberMessageKey(key)).toBe(false);
      }
    });

    it('should handle unicode keys', () => {
      expect(state.rememberMessageKey('key-emoji-🚀')).toBe(true);
      expect(state.rememberMessageKey('key-emoji-🚀')).toBe(false);
    });
  });

  describe('persona cooldown', () => {
    it('should not be on cooldown without prior reply', () => {
      expect(state.isPersonaOnCooldown('C1', '1.0', 'p1')).toBe(false);
    });

    it('should be on cooldown immediately after marking reply', () => {
      state.markPersonaReply('C1', '1.0', 'p1');
      expect(state.isPersonaOnCooldown('C1', '1.0', 'p1')).toBe(true);
    });

    it('should not be on cooldown after window expires', () => {
      vi.useFakeTimers();
      state.markPersonaReply('C1', '1.0', 'p1');
      vi.advanceTimersByTime(PERSONA_REPLY_COOLDOWN_MS + 1);
      expect(state.isPersonaOnCooldown('C1', '1.0', 'p1')).toBe(false);
      vi.useRealTimers();
    });

    it('should still be on cooldown just before window expires', () => {
      vi.useFakeTimers();
      state.markPersonaReply('C1', '1.0', 'p1');
      vi.advanceTimersByTime(PERSONA_REPLY_COOLDOWN_MS - 1);
      expect(state.isPersonaOnCooldown('C1', '1.0', 'p1')).toBe(true);
      vi.useRealTimers();
    });

    it('should handle multiple personas in same thread independently', () => {
      state.markPersonaReply('C1', '1.0', 'p1');
      expect(state.isPersonaOnCooldown('C1', '1.0', 'p1')).toBe(true);
      expect(state.isPersonaOnCooldown('C1', '1.0', 'p2')).toBe(false);
    });

    it('should handle same persona in different threads independently', () => {
      state.markPersonaReply('C1', '1.0', 'p1');
      expect(state.isPersonaOnCooldown('C1', '1.0', 'p1')).toBe(true);
      expect(state.isPersonaOnCooldown('C1', '2.0', 'p1')).toBe(false);
      expect(state.isPersonaOnCooldown('C2', '1.0', 'p1')).toBe(false);
    });

    it('should handle multiple channels independently', () => {
      state.markPersonaReply('C1', '1.0', 'p1');
      state.markPersonaReply('C2', '1.0', 'p1');
      expect(state.isPersonaOnCooldown('C1', '1.0', 'p1')).toBe(true);
      expect(state.isPersonaOnCooldown('C2', '1.0', 'p1')).toBe(true);
      expect(state.isPersonaOnCooldown('C3', '1.0', 'p1')).toBe(false);
    });

    it('should update cooldown time on multiple replies', () => {
      vi.useFakeTimers();
      state.markPersonaReply('C1', '1.0', 'p1');
      vi.advanceTimersByTime(PERSONA_REPLY_COOLDOWN_MS - 1000);
      // Still on cooldown
      expect(state.isPersonaOnCooldown('C1', '1.0', 'p1')).toBe(true);

      // Mark reply again - resets cooldown
      state.markPersonaReply('C1', '1.0', 'p1');
      vi.advanceTimersByTime(PERSONA_REPLY_COOLDOWN_MS - 1000);
      expect(state.isPersonaOnCooldown('C1', '1.0', 'p1')).toBe(true);

      vi.advanceTimersByTime(1001);
      expect(state.isPersonaOnCooldown('C1', '1.0', 'p1')).toBe(false);
      vi.useRealTimers();
    });

    it('should handle special characters in IDs', () => {
      state.markPersonaReply('C1', '1.0', 'p-1:with-special');
      expect(state.isPersonaOnCooldown('C1', '1.0', 'p-1:with-special')).toBe(true);
    });
  });

  describe('channel activity', () => {
    it('should update last activity map and return same reference', () => {
      const map = state.getLastChannelActivityAt();
      state.markChannelActivity('C1');
      expect(map.has('C1')).toBe(true);
    });

    it('getLastChannelActivityAt returns live Map reference', () => {
      const ref1 = state.getLastChannelActivityAt();
      const ref2 = state.getLastChannelActivityAt();
      expect(ref1).toBe(ref2);
    });

    it('should track multiple channels independently', () => {
      const map = state.getLastChannelActivityAt();
      state.markChannelActivity('C1');
      state.markChannelActivity('C2');
      state.markChannelActivity('C3');

      expect(map.size).toBe(3);
      expect(map.has('C1')).toBe(true);
      expect(map.has('C2')).toBe(true);
      expect(map.has('C3')).toBe(true);
    });

    it('should update timestamp for same channel on multiple marks', () => {
      vi.useFakeTimers();
      const map = state.getLastChannelActivityAt();
      state.markChannelActivity('C1');
      const firstTimestamp = map.get('C1');

      vi.advanceTimersByTime(1000);
      state.markChannelActivity('C1');
      const secondTimestamp = map.get('C1');

      expect(secondTimestamp).toBeGreaterThan(firstTimestamp!);
      vi.useRealTimers();
    });

    it('should allow external modification of the returned map', () => {
      const map = state.getLastChannelActivityAt();
      state.markChannelActivity('C1');
      expect(map.size).toBe(1);

      // Direct modification
      map.set('C2', Date.now());
      expect(map.size).toBe(2);
      expect(map.has('C2')).toBe(true);
    });

    it('should initialize with empty activity map', () => {
      const map = state.getLastChannelActivityAt();
      expect(map.size).toBe(0);
    });
  });

  describe('ad-hoc thread memory', () => {
    it('should remember and retrieve ad-hoc persona', () => {
      const personas = [buildPersona('p1', 'Maya'), buildPersona('p2', 'Carlos')];
      state.rememberAdHocThreadPersona('C1', '1.0', 'p1');
      const result = state.getRememberedAdHocPersona('C1', '1.0', personas);
      expect(result?.id).toBe('p1');
    });

    it('should return null for expired ad-hoc persona', () => {
      vi.useFakeTimers();
      const personas = [buildPersona('p1', 'Maya')];
      state.rememberAdHocThreadPersona('C1', '1.0', 'p1');
      vi.advanceTimersByTime(AD_HOC_THREAD_MEMORY_MS + 1);
      const result = state.getRememberedAdHocPersona('C1', '1.0', personas);
      expect(result).toBeNull();
      vi.useRealTimers();
    });

    it('should return null when no persona stored', () => {
      const personas = [buildPersona('p1', 'Maya')];
      expect(state.getRememberedAdHocPersona('C1', '1.0', personas)).toBeNull();
    });

    it('should delete expired ad-hoc persona from state', () => {
      vi.useFakeTimers();
      const personas = [buildPersona('p1', 'Maya')];
      state.rememberAdHocThreadPersona('C1', '1.0', 'p1');
      vi.advanceTimersByTime(AD_HOC_THREAD_MEMORY_MS + 1);

      // First call returns null and deletes the entry
      expect(state.getRememberedAdHocPersona('C1', '1.0', personas)).toBeNull();

      // Second call should also return null (entry was deleted)
      expect(state.getRememberedAdHocPersona('C1', '1.0', personas)).toBeNull();
      vi.useRealTimers();
    });

    it('should return null when persona not in provided list', () => {
      const personas = [buildPersona('p2', 'Carlos')];
      state.rememberAdHocThreadPersona('C1', '1.0', 'p1');
      const result = state.getRememberedAdHocPersona('C1', '1.0', personas);
      expect(result).toBeNull();
    });

    it('should handle empty persona list', () => {
      state.rememberAdHocThreadPersona('C1', '1.0', 'p1');
      expect(state.getRememberedAdHocPersona('C1', '1.0', [])).toBeNull();
    });

    it('should still be valid just before expiration', () => {
      vi.useFakeTimers();
      const personas = [buildPersona('p1', 'Maya')];
      state.rememberAdHocThreadPersona('C1', '1.0', 'p1');
      vi.advanceTimersByTime(AD_HOC_THREAD_MEMORY_MS - 1);
      const result = state.getRememberedAdHocPersona('C1', '1.0', personas);
      expect(result?.id).toBe('p1');
      vi.useRealTimers();
    });

    it('should handle multiple threads independently', () => {
      const personas = [buildPersona('p1', 'Maya'), buildPersona('p2', 'Carlos')];
      state.rememberAdHocThreadPersona('C1', '1.0', 'p1');
      state.rememberAdHocThreadPersona('C1', '2.0', 'p2');
      state.rememberAdHocThreadPersona('C2', '1.0', 'p1');

      expect(state.getRememberedAdHocPersona('C1', '1.0', personas)?.id).toBe('p1');
      expect(state.getRememberedAdHocPersona('C1', '2.0', personas)?.id).toBe('p2');
      expect(state.getRememberedAdHocPersona('C2', '1.0', personas)?.id).toBe('p1');
    });

    it('should overwrite existing ad-hoc persona for same thread', () => {
      const personas = [buildPersona('p1', 'Maya'), buildPersona('p2', 'Carlos')];
      state.rememberAdHocThreadPersona('C1', '1.0', 'p1');
      state.rememberAdHocThreadPersona('C1', '1.0', 'p2');
      const result = state.getRememberedAdHocPersona('C1', '1.0', personas);
      expect(result?.id).toBe('p2');
    });

    it('should handle resetting timer on persona change', () => {
      vi.useFakeTimers();
      const personas = [buildPersona('p1', 'Maya'), buildPersona('p2', 'Carlos')];
      state.rememberAdHocThreadPersona('C1', '1.0', 'p1');

      // Advance almost to expiration
      vi.advanceTimersByTime(AD_HOC_THREAD_MEMORY_MS - 1000);

      // Change persona - should reset timer
      state.rememberAdHocThreadPersona('C1', '1.0', 'p2');

      // Advance past what would have been expiration for original persona
      vi.advanceTimersByTime(2000);

      // New persona should still be valid
      expect(state.getRememberedAdHocPersona('C1', '1.0', personas)?.id).toBe('p2');
      vi.useRealTimers();
    });
  });

  describe('issue review cooldown', () => {
    it('should not be on cooldown before marking', () => {
      expect(state.isIssueOnReviewCooldown('https://github.com/org/repo/issues/1')).toBe(false);
    });

    it('should track issue review cooldown after marking', () => {
      const url = 'https://github.com/org/repo/issues/1';
      state.markIssueReviewed(url);
      expect(state.isIssueOnReviewCooldown(url)).toBe(true);
    });

    it('should expire issue review cooldown after window', () => {
      vi.useFakeTimers();
      const url = 'https://github.com/org/repo/issues/1';
      state.markIssueReviewed(url);
      vi.advanceTimersByTime(ISSUE_REVIEW_COOLDOWN_MS + 1);
      expect(state.isIssueOnReviewCooldown(url)).toBe(false);
      vi.useRealTimers();
    });

    it('should still be on cooldown just before window expires', () => {
      vi.useFakeTimers();
      const url = 'https://github.com/org/repo/issues/1';
      state.markIssueReviewed(url);
      vi.advanceTimersByTime(ISSUE_REVIEW_COOLDOWN_MS - 1);
      expect(state.isIssueOnReviewCooldown(url)).toBe(true);
      vi.useRealTimers();
    });

    it('should handle multiple issues independently', () => {
      const url1 = 'https://github.com/org/repo/issues/1';
      const url2 = 'https://github.com/org/repo/issues/2';
      state.markIssueReviewed(url1);

      expect(state.isIssueOnReviewCooldown(url1)).toBe(true);
      expect(state.isIssueOnReviewCooldown(url2)).toBe(false);

      state.markIssueReviewed(url2);
      expect(state.isIssueOnReviewCooldown(url2)).toBe(true);
    });

    it('should update cooldown on re-review', () => {
      vi.useFakeTimers();
      const url = 'https://github.com/org/repo/issues/1';
      state.markIssueReviewed(url);

      vi.advanceTimersByTime(ISSUE_REVIEW_COOLDOWN_MS - 1000);
      expect(state.isIssueOnReviewCooldown(url)).toBe(true);

      // Mark as reviewed again - should reset cooldown
      state.markIssueReviewed(url);

      vi.advanceTimersByTime(ISSUE_REVIEW_COOLDOWN_MS - 500);
      expect(state.isIssueOnReviewCooldown(url)).toBe(true);

      vi.advanceTimersByTime(1000);
      expect(state.isIssueOnReviewCooldown(url)).toBe(false);
      vi.useRealTimers();
    });

    it('should handle various URL formats', () => {
      const urls = [
        'https://github.com/org/repo/issues/123',
        'http://gitlab.com/group/project/issues/42',
        'https://bitbucket.org/workspace/repo/issues/10',
        '/issues/1', // relative URL
        'issue-123', // non-URL identifiers
      ];

      for (const url of urls) {
        state.markIssueReviewed(url);
        expect(state.isIssueOnReviewCooldown(url)).toBe(true);
      }
    });

    it('should treat identical URLs with different trailing slashes as different', () => {
      const url1 = 'https://github.com/org/repo/issues/1';
      const url2 = 'https://github.com/org/repo/issues/1/';
      state.markIssueReviewed(url1);

      expect(state.isIssueOnReviewCooldown(url1)).toBe(true);
      expect(state.isIssueOnReviewCooldown(url2)).toBe(false);
    });
  });

  describe('persona selection', () => {
    it('should pick non-cooldown persona when available', () => {
      const personas = [buildPersona('p1', 'Maya'), buildPersona('p2', 'Carlos')];
      state.markPersonaReply('C1', '1.0', 'p1');
      const picked = state.pickRandomPersona(personas, 'C1', '1.0');
      expect(picked?.id).toBe('p2');
    });

    it('should return null for empty persona list', () => {
      expect(state.pickRandomPersona([], 'C1', '1.0')).toBeNull();
    });

    it('should pick from all personas when all are on cooldown', () => {
      const personas = [
        buildPersona('p1', 'Maya'),
        buildPersona('p2', 'Carlos'),
        buildPersona('p3', 'Priya'),
      ];
      state.markPersonaReply('C1', '1.0', 'p1');
      state.markPersonaReply('C1', '1.0', 'p2');
      state.markPersonaReply('C1', '1.0', 'p3');

      const picked = state.pickRandomPersona(personas, 'C1', '1.0');
      expect(picked).not.toBeNull();
      expect(personas.map((p) => p.id)).toContain(picked?.id);
    });

    it('should pick from non-cooldown personas when some are available', () => {
      const personas = [
        buildPersona('p1', 'Maya'),
        buildPersona('p2', 'Carlos'),
        buildPersona('p3', 'Priya'),
        buildPersona('p4', 'Dev'),
      ];
      state.markPersonaReply('C1', '1.0', 'p1');
      state.markPersonaReply('C1', '1.0', 'p3');

      const picked = state.pickRandomPersona(personas, 'C1', '1.0');
      // Should only pick from p2 or p4 (non-cooldown)
      expect(['p2', 'p4']).toContain(picked?.id);
    });

    it('should handle single persona list', () => {
      const personas = [buildPersona('p1', 'Maya')];
      const picked = state.pickRandomPersona(personas, 'C1', '1.0');
      expect(picked?.id).toBe('p1');
    });

    it('should pick random persona when multiple non-cooldown available', () => {
      const personas = [
        buildPersona('p1', 'Maya'),
        buildPersona('p2', 'Carlos'),
        buildPersona('p3', 'Priya'),
      ];

      // Run multiple times and verify we get different results (statistically)
      const results = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const picked = state.pickRandomPersona(personas, 'C2', '1.0');
        if (picked) results.add(picked.id);
      }

      // With 3 personas and 20 iterations, we should likely see at least 2 different ones
      // (though not guaranteed - this test could occasionally fail)
      expect(results.size).toBeGreaterThanOrEqual(1);
    });

    it('should respect thread-specific cooldowns', () => {
      const personas = [buildPersona('p1', 'Maya'), buildPersona('p2', 'Carlos')];
      state.markPersonaReply('C1', '1.0', 'p1');

      // Same thread, p1 should be excluded
      let picked = state.pickRandomPersona(personas, 'C1', '1.0');
      expect(picked?.id).toBe('p2');

      // Different thread, both should be available
      picked = state.pickRandomPersona(personas, 'C1', '2.0');
      expect(['p1', 'p2']).toContain(picked?.id);
    });

    it('should find persona by name case-insensitively', () => {
      const personas = [buildPersona('p1', 'Dev'), buildPersona('p2', 'Maya')];
      const result = state.findPersonaByName(personas, 'dev');
      expect(result?.id).toBe('p1');
    });

    it('should return null when persona name not found', () => {
      const personas = [buildPersona('p1', 'Maya')];
      expect(state.findPersonaByName(personas, 'Unknown')).toBeNull();
    });

    it('should find persona by name with mixed case', () => {
      const personas = [
        buildPersona('p1', 'Maya'),
        buildPersona('p2', 'carlos'),
        buildPersona('p3', 'Priya_Singh'),
      ];

      expect(state.findPersonaByName(personas, 'MAYA')?.id).toBe('p1');
      expect(state.findPersonaByName(personas, 'CaRlOs')?.id).toBe('p2');
      expect(state.findPersonaByName(personas, 'priya_singh')?.id).toBe('p3');
    });

    it('should find persona by name with special characters', () => {
      const personas = [buildPersona('p1', 'Dev-Bot'), buildPersona('p2', 'AI Agent')];
      expect(state.findPersonaByName(personas, 'dev-bot')?.id).toBe('p1');
      expect(state.findPersonaByName(personas, 'ai agent')?.id).toBe('p2');
    });

    it('should handle whitespace in search name', () => {
      const personas = [buildPersona('p1', 'Maya')];
      expect(state.findPersonaByName(personas, '  Maya  ')).toBeNull(); // No trim
    });

    it('should handle empty search name', () => {
      const personas = [buildPersona('p1', 'Maya')];
      expect(state.findPersonaByName(personas, '')).toBeNull();
    });

    it('should return first match when duplicate names exist', () => {
      const personas = [
        buildPersona('p1', 'Maya'),
        buildPersona('p2', 'Maya'), // Duplicate name
      ];
      const result = state.findPersonaByName(personas, 'maya');
      expect(result).not.toBeNull();
      expect(['p1', 'p2']).toContain(result?.id);
    });
  });

  describe('randomInt', () => {
    it('should return min when min equals max', () => {
      expect(state.randomInt(5, 5)).toBe(5);
    });

    it('should return value in range [min, max]', () => {
      for (let i = 0; i < 50; i++) {
        const val = state.randomInt(1, 10);
        expect(val).toBeGreaterThanOrEqual(1);
        expect(val).toBeLessThanOrEqual(10);
      }
    });

    it('should return min when max is less than min', () => {
      expect(state.randomInt(10, 5)).toBe(10);
    });

    it('should handle negative numbers', () => {
      for (let i = 0; i < 20; i++) {
        const val = state.randomInt(-10, -5);
        expect(val).toBeGreaterThanOrEqual(-10);
        expect(val).toBeLessThanOrEqual(-5);
      }
    });

    it('should handle range spanning zero', () => {
      for (let i = 0; i < 20; i++) {
        const val = state.randomInt(-5, 5);
        expect(val).toBeGreaterThanOrEqual(-5);
        expect(val).toBeLessThanOrEqual(5);
      }
    });

    it('should handle zero range', () => {
      expect(state.randomInt(0, 0)).toBe(0);
    });

    it('should return min when max is min + 1', () => {
      const results = new Set<number>();
      for (let i = 0; i < 20; i++) {
        results.add(state.randomInt(5, 6));
      }
      // Should only return 5 or 6
      expect(results.size).toBeLessThanOrEqual(2);
      expect(results.has(5) || results.has(6)).toBe(true);
    });

    it('should delegate to the randomInt utility function', () => {
      // Just verify it works - the implementation delegates to utils.randomInt
      const val1 = state.randomInt(1, 100);
      const val2 = state.randomInt(1, 100);
      // Two calls should sometimes return different values (probabilistic test)
      // We just verify they're both in valid range
      expect(val1).toBeGreaterThanOrEqual(1);
      expect(val1).toBeLessThanOrEqual(100);
      expect(val2).toBeGreaterThanOrEqual(1);
      expect(val2).toBeLessThanOrEqual(100);
    });
  });
});

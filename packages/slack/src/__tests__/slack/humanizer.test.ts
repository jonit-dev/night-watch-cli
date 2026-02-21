/**
 * Tests for text humanization utilities.
 * Covers emoji policies, sentence trimming, deduplication, and edge cases.
 */

import { describe, expect, it } from 'vitest';
import {
  humanizeSlackReply,
  isSkipMessage,
  dedupeRepeatedSentences,
  limitEmojiCount,
  isFacialEmoji,
  applyEmojiPolicy,
  trimToSentences,
  MAX_HUMANIZED_SENTENCES,
  MAX_HUMANIZED_CHARS,
} from '../../humanizer.js';

describe('humanizer utilities', () => {
  describe('isSkipMessage', () => {
    it('returns true for SKIP sentinel in any case', () => {
      expect(isSkipMessage('SKIP')).toBe(true);
      expect(isSkipMessage('skip')).toBe(true);
      expect(isSkipMessage('Skip')).toBe(true);
      expect(isSkipMessage('  SKIP  ')).toBe(true);
    });

    it('returns false for normal text', () => {
      expect(isSkipMessage('This is a reply')).toBe(false);
      expect(isSkipMessage('')).toBe(false);
    });
  });

  describe('dedupeRepeatedSentences', () => {
    it('removes consecutive duplicate sentences', () => {
      const result = dedupeRepeatedSentences('Fix parse error. Fix parse error.');
      expect(result).toBe('Fix parse error.');
    });

    it('removes multiple duplicates globally', () => {
      const result = dedupeRepeatedSentences('Good. Good. Bad. Good.');
      // dedupeRepeatedSentences removes ALL duplicates globally
      // "Good. Good. Bad. Good." -> "Good. Bad." (all "Good" duplicates are removed)
      expect(result).toBe('Good. Bad.');
    });

    it('handles empty input', () => {
      expect(dedupeRepeatedSentences('')).toBe('');
    });

    it('handles single sentence', () => {
      expect(dedupeRepeatedSentences('Single sentence.')).toBe('Single sentence.');
    });

    it('preserves non-duplicate sentences', () => {
      const result = dedupeRepeatedSentences('First one. Second one. Third one.');
      expect(result).toBe('First one. Second one. Third one.');
    });

    it('handles sentences with different whitespace', () => {
      const result = dedupeRepeatedSentences('Same.  Same.\tSame.');
      expect(result).toBe('Same.');
    });
  });

  describe('isFacialEmoji', () => {
    it('identifies smileys and facial expressions', () => {
      // Test actual emoji characters using surrogate pairs or direct Unicode
      expect(isFacialEmoji('\u{1F600}')).toBe(true); //
      expect(isFacialEmoji('\u{1F642}')).toBe(true); //
      expect(isFacialEmoji('\u{1F910}')).toBe(true); //
      expect(isFacialEmoji('\u{1F970}')).toBe(true); //
    });

    it('returns false for non-facial emoji', () => {
      expect(isFacialEmoji('\u{2705}')).toBe(false); //
      expect(isFacialEmoji('\u{1F680}')).toBe(false); //
      expect(isFacialEmoji('\u{1F4BE}')).toBe(false); //
    });

    it('returns false for non-emoji characters', () => {
      expect(isFacialEmoji('a')).toBe(false);
      expect(isFacialEmoji('1')).toBe(false);
    });
  });

  describe('limitEmojiCount', () => {
    it('limits to max emojis', () => {
      const result = limitEmojiCount('fire rocket check ✅🚀👍', 2);
      const emojis = result.match(/\p{Extended_Pictographic}/gu) ?? [];
      expect(emojis.length).toBe(2);
    });

    it('keeps first N emojis', () => {
      const result = limitEmojiCount('✅🚀👍💯', 2);
      expect(result).toContain('✅');
      expect(result).toContain('🚀');
      expect(result).not.toContain('👍');
      expect(result).not.toContain('💯');
    });

    it('passes through text without emojis', () => {
      const result = limitEmojiCount('Hello world', 1);
      expect(result).toBe('Hello world');
    });

    it('handles zero limit', () => {
      const result = limitEmojiCount('✅🚀👍', 0);
      expect(result).not.toContain('✅');
      expect(result).not.toContain('🚀');
      expect(result).not.toContain('👍');
    });
  });

  describe('applyEmojiPolicy', () => {
    it('removes all emojis when disabled', () => {
      const result = applyEmojiPolicy('Good ✅🚀', false, false);
      expect(result).toBe('Good ');
    });

    it('keeps only facial emoji when non-facial disabled', () => {
      const result = applyEmojiPolicy('Good 🙂✅', true, false);
      expect(result).toContain('🙂');
      expect(result).not.toContain('✅');
    });

    it('keeps non-facial emoji when no facial present', () => {
      const result = applyEmojiPolicy('Good ✅🚀', true, true);
      const emojis = result.match(/\p{Extended_Pictographic}/gu) ?? [];
      expect(emojis.length).toBe(1);
    });

    it('prefers facial emoji over non-facial', () => {
      const result = applyEmojiPolicy('Good ✅🙂', true, true);
      expect(result).toContain('🙂');
      expect(result).not.toContain('✅');
    });

    it('handles text without emojis', () => {
      const result = applyEmojiPolicy('Just text', true, true);
      expect(result).toBe('Just text');
    });
  });

  describe('trimToSentences', () => {
    it('keeps text under limit unchanged', () => {
      const result = trimToSentences('One. Two.', 5);
      expect(result).toBe('One. Two.');
    });

    it('trims to max sentences', () => {
      const result = trimToSentences('One. Two. Three. Four.', 2);
      expect(result).toBe('One. Two.');
    });

    it('handles sentences without terminal punctuation', () => {
      const result = trimToSentences('One two three', 1);
      expect(result).toBe('One two three');
    });

    it('handles empty input', () => {
      expect(trimToSentences('', 3)).toBe('');
    });

    it('preserves punctuation', () => {
      const result = trimToSentences('One! Two? Three.', 2);
      expect(result).toBe('One! Two?');
    });
  });

  describe('humanizeSlackReply', () => {
    const defaultOptions = {
      allowEmoji: true,
      allowNonFacialEmoji: true,
      maxSentences: MAX_HUMANIZED_SENTENCES,
      maxChars: MAX_HUMANIZED_CHARS,
    };

    it('removes markdown headings', () => {
      const result = humanizeSlackReply('# Heading\n\nContent', defaultOptions);
      expect(result).not.toContain('#');
      expect(result).not.toMatch(/^#\s/);
    });

    it('removes markdown list bullets', () => {
      const result = humanizeSlackReply('- item one\n- item two', defaultOptions);
      expect(result).not.toMatch(/^-\s+/m);
    });

    it('removes bold markdown', () => {
      const result = humanizeSlackReply('This is **bold** text', defaultOptions);
      expect(result).not.toContain('**');
      expect(result).toContain('bold');
    });

    it('removes canned assistant phrases', () => {
      const cannedPhrases = [
        'Great question! Here is the answer.',
        'Of course, I can help.',
        'Certainly! Let me explain.',
        "You're absolutely right about that.",
        'I hope this helps with your problem.',
      ];

      for (const phrase of cannedPhrases) {
        const result = humanizeSlackReply(phrase, defaultOptions);
        expect(result).not.toMatch(/^great question/i);
        expect(result).not.toMatch(/^of course/i);
        expect(result).not.toMatch(/^certainly/i);
        expect(result).not.toMatch(/^you're absolutely right/i);
        expect(result).not.toMatch(/^i hope this helps/i);
      }
    });

    it('limits sentence count', () => {
      const input =
        'First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.';
      const result = humanizeSlackReply(input, defaultOptions);
      const sentences = result.split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length).toBeLessThanOrEqual(MAX_HUMANIZED_SENTENCES);
    });

    it('trims to max characters with ellipsis', () => {
      const longText = 'a'.repeat(MAX_HUMANIZED_CHARS + 100);
      const result = humanizeSlackReply(longText, defaultOptions);
      expect(result.length).toBeLessThanOrEqual(MAX_HUMANIZED_CHARS);
      expect(result).toMatch(/\.\.\.$/);
    });

    it('preserves SKIP sentinel', () => {
      expect(humanizeSlackReply('SKIP', defaultOptions)).toBe('SKIP');
      expect(humanizeSlackReply('  skip  ', defaultOptions)).toBe('SKIP');
    });

    it('applies emoji policy', () => {
      const result = humanizeSlackReply('✅🚀👍', { ...defaultOptions, allowEmoji: false });
      const emojis = result.match(/\p{Extended_Pictographic}/gu) ?? [];
      expect(emojis.length).toBe(0);
    });

    it('removes repeated sentences', () => {
      const result = humanizeSlackReply('Same. Same.', defaultOptions);
      expect(result).toBe('Same.');
    });

    it('handles empty input', () => {
      expect(humanizeSlackReply('', defaultOptions)).toBe('');
    });

    it('handles whitespace-only input', () => {
      expect(humanizeSlackReply('   \n\t  ', defaultOptions)).toBe('');
    });

    it('normalizes whitespace', () => {
      const result = humanizeSlackReply('Word1  \n  Word2', defaultOptions);
      expect(result).toBe('Word1 Word2');
    });

    it('limits to one emoji', () => {
      const result = humanizeSlackReply('✅🚀👍💯', defaultOptions);
      const emojis = result.match(/\p{Extended_Pictographic}/gu) ?? [];
      expect(emojis.length).toBeLessThanOrEqual(1);
    });

    it('prefers facial emoji when available', () => {
      const result = humanizeSlackReply('🙂✅', { ...defaultOptions, allowNonFacialEmoji: false });
      expect(result).toContain('🙂');
      expect(result).not.toContain('✅');
    });

    it('uses provided options', () => {
      const customOptions = {
        allowEmoji: false,
        allowNonFacialEmoji: false,
        maxSentences: 1,
        maxChars: 50,
      };
      const result = humanizeSlackReply('✅ First. Second. Third.', customOptions);
      expect(result).not.toContain('✅');
      const sentences = result.split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length).toBeLessThanOrEqual(1);
      expect(result.length).toBeLessThanOrEqual(50);
    });

    it('handles text with mixed markdown and emojis', () => {
      const result = humanizeSlackReply('# Title\n- **Bold** item\nContent ✅🚀', defaultOptions);
      expect(result).not.toContain('#');
      expect(result).not.toContain('-');
      expect(result).not.toContain('**');
      const emojis = result.match(/\p{Extended_Pictographic}/gu) ?? [];
      expect(emojis.length).toBeLessThanOrEqual(1);
    });

    it('handles sentences separated by various delimiters', () => {
      const result = humanizeSlackReply('One! Two? Three.', { ...defaultOptions, maxSentences: 2 });
      const sentences = result.split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length).toBe(2);
    });
  });
});

import { describe, expect, it } from 'vitest';
import { humanizeSlackReply } from '../../deliberation.js';

describe('humanizeSlackReply', () => {
  it('removes canned assistant openers when followed by generic filler and keeps reply short', () => {
    const result = humanizeSlackReply(
      'Great question! I think we should check CI. Then we should fix tests. Finally we should re-run everything.',
    );

    expect(result.startsWith('Great question')).toBe(false);
    expect(result.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(3);
  });

  it('keeps canned opener when followed by substantive non-filler content', () => {
    // "Of course" followed by a file path — not a generic filler word — should be kept
    const result = humanizeSlackReply(
      'Of course, middleware.ts#L23 skips expiry validation.',
    );

    expect(result).toContain('Of course');
  });

  it('limits emoji spam to at most one emoji', () => {
    const result = humanizeSlackReply('Looks good ✅🚀👍');
    const emojis = result.match(/[\p{Extended_Pictographic}]/gu) ?? [];
    expect(emojis.length).toBeLessThanOrEqual(1);
  });

  it('can disable emojis entirely for sparse cadence', () => {
    const result = humanizeSlackReply('Looks good 🙂✅', { allowEmoji: false });
    const emojis = result.match(/[\p{Extended_Pictographic}]/gu) ?? [];
    expect(emojis.length).toBe(0);
  });

  it('prefers facial emoji when allowed', () => {
    const result = humanizeSlackReply('done ✅🙂', { allowEmoji: true, allowNonFacialEmoji: true });
    expect(result).toContain('🙂');
    expect(result).not.toContain('✅');
  });

  it('strips list formatting used by bot-like responses', () => {
    const result = humanizeSlackReply('- item one\n- item two');
    expect(result).not.toContain('- ');
  });

  it('passes through SKIP sentinel unchanged', () => {
    const result = humanizeSlackReply('SKIP');
    expect(result).toBe('SKIP');
  });

  it('removes repeated duplicate sentences', () => {
    const result = humanizeSlackReply('Fix parse error. Fix parse error.');
    expect(result).toBe('Fix parse error.');
  });
});

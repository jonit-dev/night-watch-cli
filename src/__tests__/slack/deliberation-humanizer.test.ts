import { describe, expect, it } from 'vitest';
import { humanizeSlackReply } from '../../slack/deliberation.js';

describe('humanizeSlackReply', () => {
  it('removes canned assistant openers and keeps reply short', () => {
    const result = humanizeSlackReply(
      'Great question! Of course, we can do that. First we should check CI. Then we should fix tests. Finally we should re-run everything.',
    );

    expect(result.startsWith('Great question')).toBe(false);
    expect(result.startsWith('Of course')).toBe(false);
    expect(result.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(2);
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
});

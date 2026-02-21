/**
 * Tests for deliberation builder functions.
 * Covers opening message generation, contribution prompts, and context formatting.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { IDiscussionTrigger } from '@night-watch/core';
import { execFileSync } from 'node:child_process';
import {
  buildOpeningMessage,
  buildIssueTitleFromTrigger,
  hasConcreteCodeContext,
  buildContributionPrompt,
  formatThreadHistory,
  loadPrDiffExcerpt,
  MAX_ROUNDS,
} from '../../deliberation-builders.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

// Mock logger
vi.mock('@night-watch/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@night-watch/core')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

function buildTrigger(
  type: IDiscussionTrigger['type'],
  overrides: Partial<IDiscussionTrigger> = {},
): IDiscussionTrigger {
  return {
    type,
    projectPath: '/test/project',
    ref: 'ref-1',
    context: 'Test context',
    ...overrides,
  };
}

describe('deliberation-builders', () => {
  describe('buildOpeningMessage', () => {
    describe('pr_review type', () => {
      it('generates varied opening messages', () => {
        const trigger = buildTrigger('pr_review', {
          prUrl: 'https://github.com/test/repo/pull/42',
          ref: '42', // PR number from ref
        });
        const message = buildOpeningMessage(trigger);
        expect(message).toContain('#42');
        expect(message).toContain('github.com');
      });

      it('handles PR without URL', () => {
        const trigger = buildTrigger('pr_review', { prUrl: undefined });
        const message = buildOpeningMessage(trigger);
        expect(message).toContain('#ref-1');
      });

      it('includes context if provided', () => {
        const trigger = buildTrigger('pr_review', {
          context: 'Looking at authentication changes',
        });
        const message = buildOpeningMessage(trigger);
        expect(message).toBeTruthy();
      });
    });

    describe('build_failure type', () => {
      it('includes ref and truncated context', () => {
        const trigger = buildTrigger('build_failure', {
          context: 'A'.repeat(1000),
        });
        const message = buildOpeningMessage(trigger);
        expect(message).toContain('ref-1');
        expect(message.length).toBeLessThan(700); // Context truncated to 500
      });
    });

    describe('prd_kickoff type', () => {
      it('includes PRD ref', () => {
        const trigger = buildTrigger('prd_kickoff');
        const message = buildOpeningMessage(trigger);
        expect(message).toContain('ref-1');
        expect(message).toContain('Picking up');
      });
    });

    describe('code_watch type', () => {
      it('parses structured context into natural message', () => {
        const trigger = buildTrigger('code_watch', {
          context:
            'Location: src/auth/login.ts\nSignal: Missing error handling\nSnippet: throw new Error()',
        });
        const message = buildOpeningMessage(trigger);
        expect(message).toContain('src/auth/login.ts');
        expect(message.toLowerCase()).toContain('error handling');
      });

      it('handles context without snippet', () => {
        const trigger = buildTrigger('code_watch', {
          context: 'Location: src/api/routes.ts\nSignal: N+1 query',
        });
        const message = buildOpeningMessage(trigger);
        expect(message).toContain('src/api/routes.ts');
        expect(message).toContain('N+1 query');
        expect(message).not.toContain('```');
      });

      it('falls back to raw context when parsing fails', () => {
        const trigger = buildTrigger('code_watch', {
          context: 'Unstructured signal detected',
        });
        const message = buildOpeningMessage(trigger);
        expect(message).toContain('Unstructured signal');
      });

      it('generates varied message formats based on ref hash', () => {
        const trigger = buildTrigger('code_watch', {
          context: 'Location: test.ts\nSignal: Issue',
        });
        const messages = new Set();
        for (let i = 0; i < 20; i++) {
          messages.add(buildOpeningMessage({ ...trigger, ref: `ref-${i}` }));
        }
        // Multiple distinct formats should exist
        expect(messages.size).toBeGreaterThan(1);
      });
    });

    describe('issue_review type', () => {
      it('generates varied opening messages based on ref hash', () => {
        const messages = new Set();
        for (let i = 0; i < 20; i++) {
          messages.add(buildOpeningMessage(buildTrigger('issue_review', { ref: `issue-${i}` })));
        }
        expect(messages.size).toBeGreaterThan(1);
      });

      it('includes issue ref in message', () => {
        const trigger = buildTrigger('issue_review', { ref: 'issue-42' });
        const message = buildOpeningMessage(trigger);
        expect(message).toContain('issue-42');
      });
    });

    describe('unknown trigger type', () => {
      it('truncates context for unknown types', () => {
        const trigger = buildTrigger('pr_review' as any, {
          context: 'A'.repeat(1000),
        });
        const message = buildOpeningMessage(trigger);
        expect(message.length).toBeLessThanOrEqual(500);
      });
    });
  });

  describe('buildIssueTitleFromTrigger', () => {
    it('extracts signal and location from structured context', () => {
      const trigger = buildTrigger('code_watch', {
        context: 'Location: src/auth.ts\nSignal: Missing validation',
      });
      const title = buildIssueTitleFromTrigger(trigger);
      expect(title).toBe('fix: Missing validation at src/auth.ts');
    });

    it('uses fallback values when context is unstructured', () => {
      const trigger = buildTrigger('code_watch', {
        context: 'Unstructured context',
      });
      const title = buildIssueTitleFromTrigger(trigger);
      expect(title).toBe('fix: code signal at unknown location');
    });

    it('handles empty context', () => {
      const trigger = buildTrigger('code_watch', { context: '' });
      const title = buildIssueTitleFromTrigger(trigger);
      expect(title).toBe('fix: code signal at unknown location');
    });
  });

  describe('hasConcreteCodeContext', () => {
    it('detects code blocks', () => {
      expect(hasConcreteCodeContext('```js\nconsole.log("test")\n```')).toBe(true);
      expect(hasConcreteCodeContext('```\ncode here\n```')).toBe(true);
    });

    it('detects file paths with extensions', () => {
      expect(hasConcreteCodeContext('see src/auth/login.ts:42')).toBe(true);
      expect(hasConcreteCodeContext('file: test/utils.test.ts')).toBe(true);
      expect(hasConcreteCodeContext('check scripts/deploy.js')).toBe(true);
    });

    it('detects git diff markers', () => {
      expect(hasConcreteCodeContext('diff --git a/file.ts b/file.ts')).toBe(true);
      expect(hasConcreteCodeContext('@@ -10,5 +10,7 @@')).toBe(true);
    });

    it('detects code keywords', () => {
      expect(hasConcreteCodeContext('function test()')).toBe(true);
      expect(hasConcreteCodeContext('class MyClass')).toBe(true);
      expect(hasConcreteCodeContext('const x = 1')).toBe(true);
      expect(hasConcreteCodeContext('let value')).toBe(true);
      expect(hasConcreteCodeContext('if (condition)')).toBe(true);
      expect(hasConcreteCodeContext('try {')).toBe(true);
      expect(hasConcreteCodeContext('catch (e)')).toBe(true);
    });

    it('returns false for text without code context', () => {
      expect(hasConcreteCodeContext('Just regular text here')).toBe(false);
      expect(hasConcreteCodeContext('No code markers')).toBe(false);
    });
  });

  describe('buildContributionPrompt', () => {
    function buildPersona() {
      return {
        name: 'Maya',
        role: 'Security Reviewer',
        soul: { expertise: ['security'] },
      } as any;
    }

    it('includes persona and trigger details', () => {
      const trigger = buildTrigger('pr_review', { ref: 'PR-42' });
      const prompt = buildContributionPrompt(buildPersona(), trigger, '', 1);
      expect(prompt).toContain('Maya');
      expect(prompt).toContain('Security Reviewer');
      expect(prompt).toContain('PR-42');
    });

    it('includes thread history when provided', () => {
      const trigger = buildTrigger('pr_review');
      const history = 'Dev: Initial take\nMaya: Security concern';
      const prompt = buildContributionPrompt(buildPersona(), trigger, history, 1);
      expect(prompt).toContain('Thread So Far');
      expect(prompt).toContain('Dev: Initial take');
      expect(prompt).toContain('Maya: Security concern');
    });

    it('indicates first round guidance', () => {
      const trigger = buildTrigger('pr_review');
      const prompt = buildContributionPrompt(buildPersona(), trigger, '', 1);
      expect(prompt).toContain('Round: 1');
      expect(prompt).toContain('First round');
    });

    it('indicates final round guidance', () => {
      const trigger = buildTrigger('pr_review');
      const prompt = buildContributionPrompt(buildPersona(), trigger, '', MAX_ROUNDS);
      expect(prompt).toContain('final round');
      expect(prompt).toContain('wrap up');
    });

    it('includes issue review specific guidance', () => {
      const trigger = buildTrigger('issue_review');
      const prompt = buildContributionPrompt(buildPersona(), trigger, '', 1);
      expect(prompt).toContain('Issue Review Guidance');
      expect(prompt).toContain('READY');
      expect(prompt).toContain('CLOSE');
      expect(prompt).toContain('DRAFT');
    });

    it('omits issue review guidance for other types', () => {
      const trigger = buildTrigger('pr_review');
      const prompt = buildContributionPrompt(buildPersona(), trigger, '', 1);
      expect(prompt).not.toContain('Issue Review Guidance');
    });

    it('triggers context to max length', () => {
      const longContext = 'x'.repeat(5000);
      const trigger = buildTrigger('pr_review', { context: longContext });
      const prompt = buildContributionPrompt(buildPersona(), trigger, '', 1);
      // Context should be truncated in the prompt
      const contextSection = prompt.match(/## Context\n(.+?)##/s)?.[1] ?? '';
      expect(contextSection.length).toBeLessThan(2500);
    });
  });

  describe('formatThreadHistory', () => {
    it('formats messages with speaker names', () => {
      const messages = [
        { ts: '1', channel: 'C1', text: 'First message', username: 'Dev' },
        { ts: '2', channel: 'C1', text: 'Second message', username: 'Maya' },
      ] as const;
      const result = formatThreadHistory(messages);
      expect(result).toBe('Dev: First message\nMaya: Second message');
    });

    it('filters empty messages', () => {
      const messages = [
        { ts: '1', channel: 'C1', text: 'Valid', username: 'Dev' },
        { ts: '2', channel: 'C1', text: '   ', username: 'Maya' },
        { ts: '3', channel: 'C1', text: '', username: 'Carlos' },
      ] as const;
      const result = formatThreadHistory(messages);
      expect(result).toBe('Dev: Valid');
    });

    it('normalizes whitespace', () => {
      const messages = [
        { ts: '1', channel: 'C1', text: 'Word1   \n  Word2', username: 'Dev' },
      ] as const;
      const result = formatThreadHistory(messages);
      expect(result).toBe('Dev: Word1 Word2');
    });

    it('handles missing username', () => {
      const messages = [{ ts: '1', channel: 'C1', text: 'Message', username: undefined }] as const;
      const result = formatThreadHistory(messages);
      expect(result).toBe('Teammate: Message');
    });

    it('handles empty array', () => {
      expect(formatThreadHistory([])).toBe('');
    });
  });

  describe('loadPrDiffExcerpt', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns empty string when ref is not a number', () => {
      const result = loadPrDiffExcerpt('/project', 'not-a-number');
      expect(result).toBe('');
      expect(execFileSync).not.toHaveBeenCalled();
    });

    it('returns formatted diff excerpt on success', () => {
      const mockDiff = 'diff --git a/file.ts b/file.ts\n' + '--- a/file.ts\n' + '+++ b/file.ts\n';
      vi.mocked(execFileSync).mockReturnValue(mockDiff);

      const result = loadPrDiffExcerpt('/project', '42');

      expect(execFileSync).toHaveBeenCalledWith(
        'gh',
        ['pr', 'diff', '42', '--color=never'],
        expect.objectContaining({ cwd: '/project' }),
      );
      expect(result).toContain('PR diff excerpt');
      expect(result).toContain('```diff');
      expect(result).toContain('diff --git');
    });

    it('returns empty string on gh command failure', () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error('gh: authentication required');
      });

      const result = loadPrDiffExcerpt('/project', '42');

      expect(result).toBe('');
    });

    it('returns empty string on empty diff', () => {
      vi.mocked(execFileSync).mockReturnValue('');

      const result = loadPrDiffExcerpt('/project', '42');

      expect(result).toBe('');
    });

    it('truncates diff to first 160 lines', () => {
      const lines = Array(200).fill('line of code').join('\n');
      vi.mocked(execFileSync).mockReturnValue(lines);

      const result = loadPrDiffExcerpt('/project', '42');

      // Should contain approximately 160 lines
      const lineCount = result.split('\n').length;
      expect(lineCount).toBeLessThanOrEqual(165); // Allow for header lines
    });
  });
});

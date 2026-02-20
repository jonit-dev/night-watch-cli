import { describe, expect, it } from 'vitest';
import { IAgentPersona } from '../../../shared/types.js';
import {
  buildInboundMessageKey,
  extractMentionHandles,
  findCodeWatchSignal,
  isAmbientTeamMessage,
  parseSlackJobRequest,
  resolveMentionedPersonas,
  resolvePersonasByPlainName,
  selectFollowUpPersona,
  shouldIgnoreInboundSlackEvent,
} from '../../slack/interaction-listener.js';

function buildPersona(id: string, name: string): IAgentPersona {
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
      emojiUsage: {
        frequency: 'never',
        favorites: [],
        contextRules: '',
      },
      quickReactions: {},
      rhetoricalMoves: [],
      antiPatterns: [],
      goodExamples: [],
      badExamples: [],
    },
    skill: {
      modes: {},
      interpolationRules: '',
      additionalInstructions: [],
    },
    modelConfig: null,
    systemPromptOverride: null,
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('Slack interaction listener helpers', () => {
  describe('extractMentionHandles', () => {
    it('extracts and normalizes @handle mentions', () => {
      const handles = extractMentionHandles(
        'hey @Maya can you pair with @carlos and @Maya on this?',
      );
      expect(handles).toEqual(['maya', 'carlos']);
    });

    it('ignores invalid/short handles', () => {
      const handles = extractMentionHandles('thanks @a @!! @ok');
      expect(handles).toEqual(['ok']);
    });
  });

  describe('resolveMentionedPersonas', () => {
    it('maps @mentions to active personas by name', () => {
      const personas = [
        buildPersona('1', 'Maya'),
        buildPersona('2', 'Carlos'),
        buildPersona('3', 'Priya'),
      ];

      const resolved = resolveMentionedPersonas(
        'hey @maya and @carlos please review',
        personas,
      );

      expect(resolved.map((p) => p.name)).toEqual(['Maya', 'Carlos']);
    });

    it('ignores unknown mentions', () => {
      const personas = [buildPersona('1', 'Maya')];
      const resolved = resolveMentionedPersonas('hey @unknown @maya', personas);
      expect(resolved.map((p) => p.name)).toEqual(['Maya']);
    });
  });

  describe('resolvePersonasByPlainName', () => {
    it('matches plain persona names without @ mention', () => {
      const personas = [
        buildPersona('1', 'Maya'),
        buildPersona('2', 'Carlos'),
      ];
      const resolved = resolvePersonasByPlainName('Carlos, are you there?', personas);
      expect(resolved.map((p) => p.name)).toEqual(['Carlos']);
    });
  });

  describe('shouldIgnoreInboundSlackEvent', () => {
    it('ignores bot and subtype events', () => {
      expect(
        shouldIgnoreInboundSlackEvent(
          {
            type: 'message',
            subtype: 'message_changed',
            user: 'U123',
            channel: 'C123',
            ts: '1700000000.123',
          },
          'U999',
        ),
      ).toBe(true);

      expect(
        shouldIgnoreInboundSlackEvent(
          {
            type: 'message',
            bot_id: 'B123',
            user: 'U123',
            channel: 'C123',
            ts: '1700000000.124',
          },
          'U999',
        ),
      ).toBe(true);
    });

    it('ignores messages from the bot user id', () => {
      expect(
        shouldIgnoreInboundSlackEvent(
          {
            type: 'message',
            user: 'U_BOT',
            channel: 'C123',
            ts: '1700000000.125',
          },
          'U_BOT',
        ),
      ).toBe(true);
    });

    it('accepts normal human text messages', () => {
      expect(
        shouldIgnoreInboundSlackEvent(
          {
            type: 'message',
            user: 'U123',
            channel: 'C123',
            ts: '1700000000.126',
            text: '@maya check this',
          },
          'U_BOT',
        ),
      ).toBe(false);
    });
  });

  describe('buildInboundMessageKey', () => {
    it('includes event type so message and app_mention do not collide', () => {
      const messageKey = buildInboundMessageKey('C123', '1700000000.126', 'message');
      const mentionKey = buildInboundMessageKey('C123', '1700000000.126', 'app_mention');

      expect(messageKey).not.toBe(mentionKey);
      expect(messageKey).toBe('C123:1700000000.126:message');
      expect(mentionKey).toBe('C123:1700000000.126:app_mention');
    });
  });

  describe('parseSlackJobRequest', () => {
    it('parses a job command with project hint', () => {
      expect(parseSlackJobRequest('<@UBOT> please run night-watch-cli now')).toEqual({
        job: 'run',
        projectHint: 'night-watch-cli',
      });
    });

    it('parses a job command without project hint', () => {
      expect(parseSlackJobRequest('hey can you review?')).toEqual({ job: 'review' });
    });

    it('parses PR URL for targeted review', () => {
      expect(
        parseSlackJobRequest('review and fix conflicts of this PR https://github.com/jonit-dev/night-watch-cli/pull/26'),
      ).toEqual({
        job: 'review',
        projectHint: 'night-watch-cli',
        prNumber: '26',
        fixConflicts: true,
      });
    });

    it('parses wrapped PR URL with whitespace/newline artifacts', () => {
      expect(
        parseSlackJobRequest(
          'review and fix conflicts of this PR https://github.com/jonit-dev/night-watch-\n    cli/pull/261',
        ),
      ).toEqual({
        job: 'review',
        projectHint: 'night-watch-cli',
        prNumber: '261',
        fixConflicts: true,
      });
    });

    it('infers review job from broken PR request language without explicit "review"', () => {
      expect(
        parseSlackJobRequest(
          'need someone to take a look on this broken PR https://github.com/jonit-dev/night-watch-cli/pull/26',
        ),
      ).toEqual({
        job: 'review',
        projectHint: 'night-watch-cli',
        prNumber: '26',
      });
    });

    it('infers review job from merge-issues request language', () => {
      expect(
        parseSlackJobRequest(
          'Can someone fix these merge issues? https://github.com/jonit-dev/night-watch-cli/pull/25',
        ),
      ).toEqual({
        job: 'review',
        projectHint: 'night-watch-cli',
        prNumber: '25',
        fixConflicts: true,
      });
    });

    it('returns null when no supported job command exists', () => {
      expect(parseSlackJobRequest('what is your specialty')).toBeNull();
    });
  });

  describe('isAmbientTeamMessage', () => {
    it('detects casual team greetings', () => {
      expect(isAmbientTeamMessage('Hey guys')).toBe(true);
      expect(isAmbientTeamMessage('hello team')).toBe(true);
      expect(isAmbientTeamMessage('Yo')).toBe(true);
    });

    it('ignores non-greeting chatter', () => {
      expect(isAmbientTeamMessage('Cool')).toBe(false);
      expect(isAmbientTeamMessage('ship it')).toBe(false);
    });
  });

  describe('findCodeWatchSignal', () => {
    it('detects empty catch blocks', () => {
      const signal = findCodeWatchSignal(`
        async function run() {
          try {
            await work();
          } catch (err) {
          }
        }
      `);
      expect(signal?.type).toBe('empty_catch');
    });

    it('detects critical TODO markers', () => {
      const signal = findCodeWatchSignal(`
        // TODO security bug: tighten token validation before ship
        export const ok = true;
      `);
      expect(signal?.type).toBe('critical_todo');
    });

    it('returns null when no suspicious signal is present', () => {
      const signal = findCodeWatchSignal(`
        export function sum(a: number, b: number): number {
          return a + b;
        }
      `);
      expect(signal).toBeNull();
    });
  });

  describe('selectFollowUpPersona', () => {
    it('keeps continuity by default', () => {
      const preferred = buildPersona('1', 'Maya');
      preferred.role = 'Security Reviewer';
      preferred.soul.expertise = ['security'];
      const carlos = buildPersona('2', 'Carlos');
      carlos.role = 'Tech Lead / Architect';
      carlos.soul.expertise = ['architecture'];

      const selected = selectFollowUpPersona(
        preferred,
        [preferred, carlos],
        'cool, what else?',
      );

      expect(selected.name).toBe('Maya');
    });

    it('hands off when another persona has clear domain fit', () => {
      const maya = buildPersona('1', 'Maya');
      maya.role = 'Security Reviewer';
      maya.soul.expertise = ['security'];
      const priya = buildPersona('2', 'Priya');
      priya.role = 'QA Engineer';
      priya.soul.expertise = ['testing', 'qa'];

      const selected = selectFollowUpPersona(
        maya,
        [maya, priya],
        'can you add qa tests for this bug and check regression?',
      );

      expect(selected.name).toBe('Priya');
    });
  });
});

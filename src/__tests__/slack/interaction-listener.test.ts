import { describe, expect, it } from 'vitest';
import { IAgentPersona } from '../../../shared/types.js';
import {
  extractMentionHandles,
  resolveMentionedPersonas,
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
});

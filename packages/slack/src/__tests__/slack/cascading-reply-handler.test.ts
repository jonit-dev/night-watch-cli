import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IAgentPersona } from '@night-watch/core';
import { CascadingReplyHandler } from '../../cascading-reply-handler.js';
import type { SlackClient } from '../../client.js';
import type { DeliberationEngine } from '../../deliberation.js';
import type { ThreadStateManager } from '../../thread-state-manager.js';
import * as utilsModule from '../../utils.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPersona(id: string, name: string, role = 'Engineer'): IAgentPersona {
  return {
    id,
    name,
    role,
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
  };
}

function buildMocks() {
  const slackClient = {
    addReaction: vi.fn().mockResolvedValue(undefined),
    getChannelHistory: vi.fn().mockResolvedValue([]),
  } as unknown as SlackClient;

  const engine = {
    replyAsAgent: vi.fn().mockResolvedValue(''),
  } as unknown as DeliberationEngine;

  const state = {
    isPersonaOnCooldown: vi.fn().mockReturnValue(false),
    markPersonaReply: vi.fn(),
    rememberAdHocThreadPersona: vi.fn(),
    randomInt: vi.fn().mockReturnValue(0),
  } as unknown as ThreadStateManager;

  return { slackClient, engine, state };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CascadingReplyHandler', () => {
  let mocks: ReturnType<typeof buildMocks>;
  let handler: CascadingReplyHandler;
  let sleepSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks = buildMocks();
    handler = new CascadingReplyHandler(mocks.slackClient, mocks.engine, mocks.state);
    vi.clearAllMocks();
    // Mock sleep to avoid actual delays in tests
    sleepSpy = vi.spyOn(utilsModule, 'sleep').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── randomReactionProbability getter ────────────────────────────────────────

  describe('randomReactionProbability', () => {
    it('returns the RANDOM_REACTION_PROBABILITY constant value', () => {
      expect(handler.randomReactionProbability).toBe(0.25);
    });
  });

  // ── reactionCandidatesForPersona ──────────────────────────────────────────

  describe('reactionCandidatesForPersona', () => {
    it('returns security-related emojis for security role', () => {
      const persona = buildPersona('1', 'Maya', 'Security Reviewer');
      const candidates = handler.reactionCandidatesForPersona(persona);
      expect(candidates).toEqual(['eyes', 'thinking_face', 'shield', 'thumbsup']);
    });

    it('returns QA-related emojis for QA role', () => {
      const persona = buildPersona('2', 'Priya', 'QA Engineer');
      const candidates = handler.reactionCandidatesForPersona(persona);
      expect(candidates).toEqual(['test_tube', 'mag', 'thinking_face', 'thumbsup']);
    });

    it('returns QA emojis for quality assurance role (contains "quality")', () => {
      const persona = buildPersona('3', 'Priya', 'Quality Assurance Lead');
      const candidates = handler.reactionCandidatesForPersona(persona);
      // "quality" matches the qa branch first
      expect(candidates).toContain('test_tube');
    });

    it('returns lead emojis for tech lead role', () => {
      const persona = buildPersona('4', 'Carlos', 'Tech Lead / Architect');
      const candidates = handler.reactionCandidatesForPersona(persona);
      expect(candidates).toEqual(['thinking_face', 'thumbsup', 'memo', 'eyes']);
    });

    it('returns lead emojis for architect role', () => {
      const persona = buildPersona('5', 'Alex', 'Software Architect');
      const candidates = handler.reactionCandidatesForPersona(persona);
      expect(candidates).toEqual(['thinking_face', 'thumbsup', 'memo', 'eyes']);
    });

    it('returns implementer emojis for developer role', () => {
      const persona = buildPersona('6', 'Dev', 'Implementer / Developer');
      const candidates = handler.reactionCandidatesForPersona(persona);
      expect(candidates).toEqual(['wrench', 'hammer_and_wrench', 'thumbsup', 'eyes']);
    });

    it('returns default emojis for generic engineer role (does not match developer)', () => {
      const persona = buildPersona('7', 'Sam', 'Staff Engineer');
      const candidates = handler.reactionCandidatesForPersona(persona);
      // "Engineer" doesn't match "developer" or "implementer"
      expect(candidates).toEqual(['eyes', 'thinking_face', 'thumbsup', 'wave']);
    });

    it('returns default emojis for unknown/generic role', () => {
      const persona = buildPersona('8', 'Generic', 'Business Analyst');
      const candidates = handler.reactionCandidatesForPersona(persona);
      expect(candidates).toEqual(['eyes', 'thinking_face', 'thumbsup', 'wave']);
    });

    it('is case-insensitive when matching role keywords', () => {
      const persona = buildPersona('9', 'Security', 'SECURITY ENGINEER');
      const candidates = handler.reactionCandidatesForPersona(persona);
      expect(candidates).toContain('shield');
    });
  });

  // ── followAgentMentions ───────────────────────────────────────────────────

  describe('followAgentMentions', () => {
    it('does nothing when postedText is empty', async () => {
      const personas = [buildPersona('1', 'Carlos')];
      await handler.followAgentMentions('', 'C1', 'ts1', personas, '', '99');
      expect(mocks.engine.replyAsAgent).not.toHaveBeenCalled();
    });

    it('does nothing when postedText is only whitespace', async () => {
      const personas = [buildPersona('1', 'Carlos')];
      await handler.followAgentMentions('   ', 'C1', 'ts1', personas, '', '99');
      expect(mocks.engine.replyAsAgent).not.toHaveBeenCalled();
    });

    it('does nothing when no mentioned personas found in text', async () => {
      const personas = [buildPersona('1', 'Carlos')];
      await handler.followAgentMentions('no matching name here', 'C1', 'ts1', personas, '', '99');
      expect(mocks.engine.replyAsAgent).not.toHaveBeenCalled();
    });

    it('skips personas that are on cooldown', async () => {
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(true);
      const personas = [buildPersona('1', 'Carlos')];
      await handler.followAgentMentions(
        'Hey Carlos, what do you think?',
        'C1',
        'ts1',
        personas,
        '',
        '99',
      );
      expect(mocks.engine.replyAsAgent).not.toHaveBeenCalled();
    });

    it('skips the persona whose id matches skipPersonaId', async () => {
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(false);
      const persona = buildPersona('skip-id', 'Carlos');
      const personas = [persona];
      await handler.followAgentMentions(
        'Hey Carlos, any thoughts?',
        'C1',
        'ts1',
        personas,
        '',
        'skip-id',
      );
      expect(mocks.engine.replyAsAgent).not.toHaveBeenCalled();
    });

    it('calls replyAsAgent and marks state for a valid mention', async () => {
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(false);
      vi.mocked(mocks.state.randomInt).mockReturnValue(0);
      vi.mocked(mocks.engine.replyAsAgent).mockResolvedValue('Noted!');

      const persona = buildPersona('carlos-id', 'Carlos');
      const personas = [persona];

      await handler.followAgentMentions(
        'Carlos, please review this',
        'C1',
        'ts1',
        personas,
        'ctx',
        'other-id',
      );

      expect(mocks.engine.replyAsAgent).toHaveBeenCalledWith(
        'C1',
        'ts1',
        'Carlos, please review this',
        persona,
        'ctx',
      );
      expect(mocks.state.markPersonaReply).toHaveBeenCalledWith('C1', 'ts1', 'carlos-id');
      expect(mocks.state.rememberAdHocThreadPersona).toHaveBeenCalledWith('C1', 'ts1', 'carlos-id');
    });

    it('handles multiple persona mentions in a single message', async () => {
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(false);
      vi.mocked(mocks.state.randomInt).mockReturnValue(0);
      vi.mocked(mocks.engine.replyAsAgent).mockResolvedValue('Got it!');

      const carlos = buildPersona('carlos-id', 'Carlos');
      const priya = buildPersona('priya-id', 'Priya');
      const personas = [carlos, priya];

      await handler.followAgentMentions(
        'Carlos and Priya, please review',
        'C1',
        'ts1',
        personas,
        'ctx',
        'other-id',
      );

      expect(mocks.engine.replyAsAgent).toHaveBeenCalledTimes(2);
      expect(mocks.state.markPersonaReply).toHaveBeenCalledTimes(2);
      expect(mocks.state.rememberAdHocThreadPersona).toHaveBeenCalledTimes(2);
    });

    it('matches persona names case-insensitively', async () => {
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(false);
      vi.mocked(mocks.state.randomInt).mockReturnValue(0);
      vi.mocked(mocks.engine.replyAsAgent).mockResolvedValue('Sure!');

      const persona = buildPersona('maya-id', 'Maya');
      const personas = [persona];

      await handler.followAgentMentions(
        'MAYA, check this out!',
        'C1',
        'ts1',
        personas,
        'ctx',
        'other',
      );

      expect(mocks.engine.replyAsAgent).toHaveBeenCalledWith(
        'C1',
        'ts1',
        'MAYA, check this out!',
        persona,
        'ctx',
      );
    });

    it('handles persona mention with word boundaries', async () => {
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(false);
      vi.mocked(mocks.state.randomInt).mockReturnValue(0);
      vi.mocked(mocks.engine.replyAsAgent).mockResolvedValue('On it!');

      const persona = buildPersona('dev-id', 'Dev');
      const personas = [persona];

      // "Dev" as a whole word should match
      await handler.followAgentMentions(
        'Dev, can you help?',
        'C1',
        'ts1',
        personas,
        'ctx',
        'other',
      );

      expect(mocks.engine.replyAsAgent).toHaveBeenCalled();
    });

    it('applies human-like delay before each mentioned persona responds', async () => {
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(false);
      vi.mocked(mocks.state.randomInt).mockReturnValue(1000);

      const persona = buildPersona('1', 'Carlos');
      const personas = [persona];

      await handler.followAgentMentions('Carlos help', 'C1', 'ts1', personas, 'ctx', 'other');

      expect(sleepSpy).toHaveBeenCalledWith(1000); // Uses the value from randomInt
    });
  });

  // ── maybePiggybackReply ───────────────────────────────────────────────────

  describe('maybePiggybackReply', () => {
    it('does nothing when random value exceeds probability threshold', async () => {
      // Force Math.random to return 1.0 — definitely above PIGGYBACK_REPLY_PROBABILITY (0.4)
      vi.spyOn(Math, 'random').mockReturnValue(1.0);

      const personas = [buildPersona('1', 'Dev')];
      await handler.maybePiggybackReply('C1', 'ts1', 'hello', personas, '', 'other');

      expect(mocks.engine.replyAsAgent).not.toHaveBeenCalled();
    });

    it('does nothing when all eligible personas are excluded or on cooldown', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0); // always triggers
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(true);
      vi.mocked(mocks.state.randomInt).mockReturnValue(0);

      const personas = [buildPersona('1', 'Dev')];
      await handler.maybePiggybackReply('C1', 'ts1', 'hello', personas, '', 'other');

      expect(mocks.engine.replyAsAgent).not.toHaveBeenCalled();
    });

    it('calls replyAsAgent when probability check passes and a persona is available', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0); // always triggers (0 < 0.4)
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(false);
      vi.mocked(mocks.state.randomInt).mockReturnValue(0);
      vi.mocked(mocks.engine.replyAsAgent).mockResolvedValue('');

      const persona = buildPersona('dev-id', 'Dev');
      const personas = [persona];

      await handler.maybePiggybackReply('C1', 'ts1', 'hello', personas, 'ctx', 'other-id');

      expect(mocks.engine.replyAsAgent).toHaveBeenCalledWith(
        'C1',
        'ts1',
        'hello',
        persona,
        'ctx',
      );
    });

    it('applies piggyback delay before responding', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(false);
      vi.mocked(mocks.state.randomInt).mockReturnValue(5000);

      const persona = buildPersona('1', 'Dev');
      const personas = [persona];

      await handler.maybePiggybackReply('C1', 'ts1', 'hello', personas, 'ctx', 'other');

      expect(sleepSpy).toHaveBeenCalledWith(5000);
    });

    it('marks state after successful piggyback reply', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(false);
      vi.mocked(mocks.state.randomInt).mockReturnValue(0);
      vi.mocked(mocks.engine.replyAsAgent).mockResolvedValue('I agree!');

      const persona = buildPersona('dev-id', 'Dev');
      const personas = [persona];

      await handler.maybePiggybackReply('C1', 'ts1', 'hello', personas, 'ctx', 'other-id');

      expect(mocks.state.markPersonaReply).toHaveBeenCalledWith('C1', 'ts1', 'dev-id');
      expect(mocks.state.rememberAdHocThreadPersona).toHaveBeenCalledWith('C1', 'ts1', 'dev-id');
    });

    it('triggers followAgentMentions when piggyback reply contains persona mentions', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(false);
      vi.mocked(mocks.state.randomInt).mockReturnValue(0);
      vi.mocked(mocks.engine.replyAsAgent).mockResolvedValue('Carlos, what do you think?');

      const dev = buildPersona('dev-id', 'Dev');
      const carlos = buildPersona('carlos-id', 'Carlos');
      const personas = [dev, carlos];

      const followUpSpy = vi.spyOn(handler, 'followAgentMentions').mockResolvedValue(undefined);

      await handler.maybePiggybackReply('C1', 'ts1', 'original', personas, 'ctx', 'dev-id');

      expect(followUpSpy).toHaveBeenCalledWith(
        'Carlos, what do you think?',
        'C1',
        'ts1',
        personas,
        'ctx',
        'carlos-id', // Uses the actual persona's ID who replied, not the excluded ID
      );
    });

    it('does not trigger followAgentMentions when piggyback reply is empty', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(false);
      vi.mocked(mocks.state.randomInt).mockReturnValue(0);
      vi.mocked(mocks.engine.replyAsAgent).mockResolvedValue('');

      const persona = buildPersona('1', 'Dev');
      const personas = [persona];

      const followUpSpy = vi.spyOn(handler, 'followAgentMentions').mockResolvedValue(undefined);

      await handler.maybePiggybackReply('C1', 'ts1', 'hello', personas, 'ctx', '1');

      expect(followUpSpy).not.toHaveBeenCalled();
    });
  });

  // ── engageMultiplePersonas ────────────────────────────────────────────────

  describe('engageMultiplePersonas', () => {
    it('does nothing when all personas are on cooldown', async () => {
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(true);
      const personas = [buildPersona('1', 'Carlos'), buildPersona('2', 'Dev')];

      await handler.engageMultiplePersonas('C1', 'ts1', 'msg-ts', 'hello', personas, '');

      expect(mocks.engine.replyAsAgent).not.toHaveBeenCalled();
    });

    it('does nothing when no personas available', async () => {
      const personas: IAgentPersona[] = [];

      await handler.engageMultiplePersonas('C1', 'ts1', 'msg-ts', 'hello', personas, '');

      expect(mocks.engine.replyAsAgent).not.toHaveBeenCalled();
    });

    it('engages at least one available persona', async () => {
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(false);
      vi.mocked(mocks.state.randomInt).mockReturnValue(1);
      vi.mocked(mocks.engine.replyAsAgent).mockResolvedValue('');

      const personas = [buildPersona('1', 'Carlos')];

      await handler.engageMultiplePersonas('C1', 'ts1', 'msg-ts', 'hey team', personas, 'ctx');

      expect(mocks.engine.replyAsAgent).toHaveBeenCalledTimes(1);
    });

    it('engages exactly 2 personas when enough are available', async () => {
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(false);
      vi.mocked(mocks.state.randomInt).mockReturnValue(2); // count = 2
      vi.mocked(mocks.engine.replyAsAgent).mockResolvedValue('');

      const personas = [
        buildPersona('1', 'Carlos'),
        buildPersona('2', 'Dev'),
        buildPersona('3', 'Maya'),
      ];

      await handler.engageMultiplePersonas('C1', 'ts1', 'msg-ts', 'hey team', personas, 'ctx');

      expect(mocks.engine.replyAsAgent).toHaveBeenCalledTimes(2);
    });

    it('engages all available personas when fewer than 2-3 range', async () => {
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(false);
      vi.mocked(mocks.state.randomInt).mockReturnValue(2);
      vi.mocked(mocks.engine.replyAsAgent).mockResolvedValue('');

      const personas = [buildPersona('1', 'Carlos')];

      await handler.engageMultiplePersonas('C1', 'ts1', 'msg-ts', 'hey', personas, 'ctx');

      expect(mocks.engine.replyAsAgent).toHaveBeenCalledTimes(1);
    });

    it('marks state for each engaged persona', async () => {
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(false);
      vi.mocked(mocks.state.randomInt).mockReturnValue(2);
      vi.mocked(mocks.engine.replyAsAgent).mockResolvedValue('');

      const carlos = buildPersona('carlos-id', 'Carlos');
      const dev = buildPersona('dev-id', 'Dev');
      const personas = [carlos, dev];

      await handler.engageMultiplePersonas('C1', 'ts1', 'msg-ts', 'team chat', personas, 'ctx');

      expect(mocks.state.markPersonaReply).toHaveBeenCalledWith('C1', 'ts1', 'carlos-id');
      expect(mocks.state.markPersonaReply).toHaveBeenCalledWith('C1', 'ts1', 'dev-id');
    });

    it('applies human response timing to first persona only', async () => {
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(false);
      vi.mocked(mocks.state.randomInt).mockReturnValue(1000);
      vi.mocked(mocks.engine.replyAsAgent).mockResolvedValue('');

      const personas = [buildPersona('1', 'Carlos')];

      await handler.engageMultiplePersonas('C1', 'ts1', 'msg-ts', 'hello', personas, 'ctx');

      // First persona gets a delay through applyHumanResponseTiming (calls sleep)
      // Since randomInt returns 1000 and the first persona goes through applyHumanResponseTiming
      // which calls sleep with the randomInt value
      expect(sleepSpy).toHaveBeenCalledWith(1000);
    });

    it('staggers subsequent persona replies with delays', async () => {
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(false);
      vi.mocked(mocks.state.randomInt).mockReturnValue(5000);

      const personas = [buildPersona('1', 'Carlos'), buildPersona('2', 'Dev')];

      vi.mocked(mocks.engine.replyAsAgent).mockResolvedValue('');

      await handler.engageMultiplePersonas('C1', 'ts1', 'msg-ts', 'hey', personas, 'ctx');

      // Second persona should have stagger delay
      expect(sleepSpy).toHaveBeenCalledWith(5000);
    });

    it('triggers followAgentMentions on last persona if reply contains mentions', async () => {
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(false);
      vi.mocked(mocks.state.randomInt).mockReturnValue(1);
      vi.mocked(mocks.engine.replyAsAgent).mockResolvedValue('Carlos, agree?');

      const dev = buildPersona('dev-id', 'Dev');
      const carlos = buildPersona('carlos-id', 'Carlos');
      const personas = [dev, carlos];

      const followUpSpy = vi.spyOn(handler, 'followAgentMentions').mockResolvedValue(undefined);

      await handler.engageMultiplePersonas('C1', 'ts1', 'msg-ts', 'chat', personas, 'ctx');

      expect(followUpSpy).toHaveBeenCalled();
    });

    it('does not trigger followAgentMentions when last reply is empty', async () => {
      vi.mocked(mocks.state.isPersonaOnCooldown).mockReturnValue(false);
      vi.mocked(mocks.state.randomInt).mockReturnValue(1);
      vi.mocked(mocks.engine.replyAsAgent).mockResolvedValue('');

      const personas = [buildPersona('1', 'Dev')];

      const followUpSpy = vi.spyOn(handler, 'followAgentMentions').mockResolvedValue(undefined);

      await handler.engageMultiplePersonas('C1', 'ts1', 'msg-ts', 'chat', personas, 'ctx');

      expect(followUpSpy).not.toHaveBeenCalled();
    });
  });

  // ── recoverPersonaFromThreadHistory ───────────────────────────────────────

  describe('recoverPersonaFromThreadHistory', () => {
    it('returns null when history is empty', async () => {
      vi.mocked(mocks.slackClient.getChannelHistory).mockResolvedValue([]);
      const personas = [buildPersona('1', 'Carlos')];
      const result = await handler.recoverPersonaFromThreadHistory('C1', 'ts1', personas);
      expect(result).toBeNull();
    });

    it('returns null when no history message matches any persona name', async () => {
      vi.mocked(mocks.slackClient.getChannelHistory).mockResolvedValue([
        { username: 'unknown-bot', text: 'hello' } as never,
      ]);
      const personas = [buildPersona('1', 'Carlos')];
      const result = await handler.recoverPersonaFromThreadHistory('C1', 'ts1', personas);
      expect(result).toBeNull();
    });

    it('returns matched persona from history by username', async () => {
      const persona = buildPersona('carlos-id', 'Carlos');
      vi.mocked(mocks.slackClient.getChannelHistory).mockResolvedValue([
        { username: 'Carlos', text: 'Sure thing.' } as never,
      ]);
      const result = await handler.recoverPersonaFromThreadHistory('C1', 'ts1', [persona]);
      expect(result).toBe(persona);
    });

    it('matches persona username case-insensitively', async () => {
      const persona = buildPersona('priya-id', 'Priya');
      vi.mocked(mocks.slackClient.getChannelHistory).mockResolvedValue([
        { username: 'priya', text: 'Got it.' } as never,
      ]);
      const result = await handler.recoverPersonaFromThreadHistory('C1', 'ts1', [persona]);
      expect(result).toBe(persona);
    });

    it('returns null when getChannelHistory throws', async () => {
      vi.mocked(mocks.slackClient.getChannelHistory).mockRejectedValue(new Error('not found'));
      const personas = [buildPersona('1', 'Carlos')];
      const result = await handler.recoverPersonaFromThreadHistory('C1', 'ts1', personas);
      expect(result).toBeNull();
    });

    it('returns most recent matching persona when scanning backwards', async () => {
      const carlos = buildPersona('carlos-id', 'Carlos');
      const dev = buildPersona('dev-id', 'Dev');

      vi.mocked(mocks.slackClient.getChannelHistory).mockResolvedValue([
        { username: 'Dev', text: 'First' } as never,
        { username: 'Carlos', text: 'Second' } as never,
      ]);

      // Walks backwards, should find Carlos (most recent)
      const result = await handler.recoverPersonaFromThreadHistory('C1', 'ts1', [carlos, dev]);
      expect(result?.name).toBe('Carlos');
    });

    it('ignores messages without username field', async () => {
      const persona = buildPersona('1', 'Carlos');
      vi.mocked(mocks.slackClient.getChannelHistory).mockResolvedValue([
        { text: 'no username' } as never,
        { username: 'Carlos', text: 'has username' } as never,
      ]);

      const result = await handler.recoverPersonaFromThreadHistory('C1', 'ts1', [persona]);
      expect(result).toBe(persona);
    });
  });

  // ── applyHumanResponseTiming ──────────────────────────────────────────────

  describe('applyHumanResponseTiming', () => {
    it('calls maybeReactToHumanMessage before sleeping', async () => {
      const persona = buildPersona('1', 'Dev');

      const reactSpy = vi.spyOn(handler, 'maybeReactToHumanMessage').mockResolvedValue(undefined);

      await handler.applyHumanResponseTiming('C1', 'msg-ts', persona);

      expect(reactSpy).toHaveBeenCalledWith('C1', 'msg-ts', persona);
      expect(sleepSpy).toHaveBeenCalled();
    });

    it('applies random delay in RESPONSE_DELAY range', async () => {
      vi.mocked(mocks.state.randomInt).mockReturnValue(1500);
      const persona = buildPersona('1', 'Dev');

      await handler.applyHumanResponseTiming('C1', 'msg-ts', persona);

      expect(sleepSpy).toHaveBeenCalledWith(1500);
    });
  });

  // ── maybeReactToHumanMessage ───────────────────────────────────────────────

  describe('maybeReactToHumanMessage', () => {
    it('does nothing when random value exceeds HUMAN_REACTION_PROBABILITY', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(1.0); // above 0.65
      const persona = buildPersona('1', 'Dev');

      await handler.maybeReactToHumanMessage('C1', 'msg-ts', persona);

      expect(mocks.slackClient.addReaction).not.toHaveBeenCalled();
    });

    it('adds reaction when probability check passes', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0); // below 0.65
      vi.mocked(mocks.state.randomInt).mockReturnValue(0);
      vi.mocked(mocks.slackClient.addReaction).mockResolvedValue(undefined);

      const persona = buildPersona('1', 'Dev', 'Engineer');
      await handler.maybeReactToHumanMessage('C1', 'msg-ts', persona);

      expect(mocks.slackClient.addReaction).toHaveBeenCalledWith('C1', 'msg-ts', 'eyes');
    });

    it('applies random delay before adding reaction', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      vi.mocked(mocks.state.randomInt).mockReturnValue(500);

      const persona = buildPersona('1', 'Dev');
      vi.mocked(mocks.slackClient.addReaction).mockResolvedValue(undefined);

      await handler.maybeReactToHumanMessage('C1', 'msg-ts', persona);

      expect(sleepSpy).toHaveBeenCalledWith(500);
    });

    it('picks reaction from persona-specific candidates', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      vi.mocked(mocks.state.randomInt).mockReturnValue(2);
      vi.mocked(mocks.slackClient.addReaction).mockResolvedValue(undefined);

      const persona = buildPersona('1', 'Maya', 'Security Reviewer');
      await handler.maybeReactToHumanMessage('C1', 'msg-ts', persona);

      // Index 2 from ['eyes', 'thinking_face', 'shield', 'thumbsup']
      expect(mocks.slackClient.addReaction).toHaveBeenCalledWith('C1', 'msg-ts', 'shield');
    });

    it('ignores reaction failures (permissions, already reacted, etc.)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      vi.mocked(mocks.state.randomInt).mockReturnValue(0);
      vi.mocked(mocks.slackClient.addReaction).mockRejectedValue(new Error('already_reacted'));

      const persona = buildPersona('1', 'Dev');

      // Should not throw
      await expect(
        handler.maybeReactToHumanMessage('C1', 'msg-ts', persona),
      ).resolves.toBeUndefined();
    });
  });
});

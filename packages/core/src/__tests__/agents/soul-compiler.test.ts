import { describe, expect, it } from 'vitest';
import { IAgentPersona } from '@/shared/types.js';
import { compileSoul } from '../../agents/soul-compiler.js';

function buildPersona(): IAgentPersona {
  return {
    id: 'persona-1',
    name: 'Dev',
    role: 'Implementer',
    avatarUrl: null,
    soul: {
      whoIAm: 'I ship pragmatic fixes quickly.',
      worldview: ['Shipping matters.'],
      opinions: { process: ['Keep PRs small.'] },
      expertise: [],
      interests: [],
      tensions: [],
      boundaries: [],
      petPeeves: [],
    },
    style: {
      voicePrinciples: 'Direct and pragmatic.',
      sentenceStructure: 'Short, then medium-length follow-up.',
      tone: 'Calm and practical.',
      wordsUsed: ['ship it'],
      wordsAvoided: ['synergy'],
      emojiUsage: {
        frequency: 'moderate',
        favorites: ['🚀'],
        contextRules: 'Use 🚀 only for approvals.',
      },
      quickReactions: {},
      rhetoricalMoves: ['State decision first'],
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

describe('compileSoul', () => {
  it('includes humanized writing guardrails', () => {
    const prompt = compileSoul(buildPersona());
    expect(prompt).toContain('## How to Sound Human');
    expect(prompt).toContain('You are a teammate in Slack');
    expect(prompt).toContain('Never use these chatbot tells');
    expect(prompt).toContain('Avoid AI filler words');
  });

  it('includes extended voice fields for personality fidelity', () => {
    const prompt = compileSoul(buildPersona());
    expect(prompt).toContain('Rhythm: Short, then medium-length follow-up.');
    expect(prompt).toContain('Tone: Calm and practical.');
    expect(prompt).toContain('### Rhetorical Moves');
    expect(prompt).toContain('State decision first');
    expect(prompt).toContain('### Emoji Context: Use 🚀 only for approvals.');
  });
});


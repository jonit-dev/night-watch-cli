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

  it('should inject tiered memory sections when memory is provided', () => {
    const memory =
      '## Core Lessons\n- [PATTERN] Always validate input before processing.\n\n## Working Memory\n- [OBSERVATION] Retry logic lacks backoff';
    const prompt = compileSoul(buildPersona(), memory);
    expect(prompt).toContain('## Core Lessons');
    expect(prompt).toContain('## Working Memory');
    expect(prompt).toContain('Always validate input before processing.');
  });

  it('should not add an extra ## Memory header when injecting tiered memory', () => {
    const memory = '## Core Lessons\n- core lesson\n\n## Working Memory\n- working lesson';
    const prompt = compileSoul(buildPersona(), memory);
    expect(prompt).not.toContain('## Memory\n## Core Lessons');
    expect(prompt).not.toContain('## Memory\n');
  });

  it('should omit memory section when memory is empty string', () => {
    const prompt = compileSoul(buildPersona(), '');
    expect(prompt).not.toContain('## Core Lessons');
    expect(prompt).not.toContain('## Working Memory');
  });

  it('should omit memory section when memory is undefined', () => {
    const prompt = compileSoul(buildPersona());
    expect(prompt).not.toContain('## Core Lessons');
    expect(prompt).not.toContain('## Working Memory');
  });
});

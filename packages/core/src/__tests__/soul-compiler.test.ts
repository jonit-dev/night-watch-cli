import { describe, expect, it } from 'vitest';

import { compileSoul } from '../agents/soul-compiler.js';
import { IAgentPersona } from '../shared/types.js';

function buildPersona(overrides: Partial<IAgentPersona> = {}): IAgentPersona {
  return {
    id: 'persona-1',
    name: 'TestAgent',
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
      sentenceStructure: 'Short.',
      tone: 'Calm.',
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

describe('compileSoul', () => {
  it('should compile persona soul into a system prompt', () => {
    const persona = buildPersona();
    const result = compileSoul(persona);

    expect(result).toContain('TestAgent');
    expect(result).toContain('Implementer');
    expect(result).toContain('I ship pragmatic fixes quickly.');
  });

  it('should return systemPromptOverride directly when set', () => {
    const persona = buildPersona({ systemPromptOverride: 'Custom override prompt.' });
    const result = compileSoul(persona);

    expect(result).toBe('Custom override prompt.');
  });

  it('should not include memory section when memory is undefined', () => {
    const persona = buildPersona();
    const result = compileSoul(persona);

    expect(result).not.toContain('## Core Lessons');
    expect(result).not.toContain('## Working Memory');
    expect(result).not.toContain('## Memory');
  });

  it('should not include memory section when memory is empty string', () => {
    const persona = buildPersona();
    const result = compileSoul(persona, '');

    expect(result).not.toContain('## Core Lessons');
    expect(result).not.toContain('## Working Memory');
    expect(result).not.toContain('## Memory');
  });

  it('should inject tiered memory sections', () => {
    const persona = buildPersona();
    const tieredMemory =
      '## Core Lessons\n- [PATTERN] Always type-check before merge\n\n## Working Memory\n- [OBSERVATION] Retry logic uses fixed delay';
    const result = compileSoul(persona, tieredMemory);

    expect(result).toContain('## Core Lessons');
    expect(result).toContain('## Working Memory');
    expect(result).toContain('[PATTERN] Always type-check before merge');
    expect(result).toContain('[OBSERVATION] Retry logic uses fixed delay');
  });

  it('should not add an extra ## Memory header when injecting tiered memory', () => {
    const persona = buildPersona();
    const tieredMemory = '## Core Lessons\n- core lesson\n\n## Working Memory\n- working lesson';
    const result = compileSoul(persona, tieredMemory);

    expect(result).not.toContain('## Memory\n## Core Lessons');
    expect(result).not.toContain('## Memory\n');
  });

  it('should include worldview beliefs', () => {
    const persona = buildPersona();
    const result = compileSoul(persona);

    expect(result).toContain('Shipping matters.');
  });

  it('should include operating rules', () => {
    const persona = buildPersona();
    const result = compileSoul(persona);

    expect(result).toContain('## Operating Rules');
    expect(result).toContain('Never break character');
  });
});

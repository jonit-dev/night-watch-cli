import { describe, expect, it } from 'vitest';

import { buildCompactionPrompt, buildReflectionPrompt } from '../memory/reflection-prompts.js';
import { IAgentPersona, IReflectionContext } from '../shared/types.js';

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

function buildContext(overrides: Partial<IReflectionContext> = {}): IReflectionContext {
  return {
    triggerType: 'pr_review',
    outcome: 'approved',
    summary: 'Reviewed the authentication refactor PR.',
    ...overrides,
  };
}

describe('buildReflectionPrompt', () => {
  it('should build role-flavored prompt for implementer role', () => {
    const persona = buildPersona({ role: 'Implementer', name: 'Dev' });
    const context = buildContext();
    const prompt = buildReflectionPrompt(persona, context);

    expect(prompt).toContain('Dev');
    expect(prompt).toContain('implement');
    expect(prompt).toContain('developer');
  });

  it('should build role-flavored prompt for developer role keyword', () => {
    const persona = buildPersona({ role: 'Senior Developer', name: 'Alice' });
    const context = buildContext();
    const prompt = buildReflectionPrompt(persona, context);

    expect(prompt).toContain('Alice');
    expect(prompt).toContain('developer');
    expect(prompt).toContain('implement');
  });

  it('should build role-flavored prompt for tech lead role', () => {
    const persona = buildPersona({ role: 'Tech Lead', name: 'Carlos' });
    const context = buildContext();
    const prompt = buildReflectionPrompt(persona, context);

    expect(prompt).toContain('Carlos');
    expect(prompt).toContain('tech lead');
    expect(prompt).toContain('architect');
  });

  it('should build role-flavored prompt for architect role', () => {
    const persona = buildPersona({ role: 'Software Architect', name: 'Priya' });
    const context = buildContext();
    const prompt = buildReflectionPrompt(persona, context);

    expect(prompt).toContain('Priya');
    expect(prompt).toContain('architect');
  });

  it('should build role-flavored prompt for QA role', () => {
    const persona = buildPersona({ role: 'QA Engineer', name: 'Quinn' });
    const context = buildContext({ triggerType: 'build_failure', outcome: 'fixed' });
    const prompt = buildReflectionPrompt(persona, context);

    expect(prompt).toContain('Quinn');
    expect(prompt).toContain('QA');
    expect(prompt).toContain('test');
  });

  it('should build role-flavored prompt for quality assurance role', () => {
    const persona = buildPersona({ role: 'Quality Assurance Lead', name: 'Tessa' });
    const context = buildContext();
    const prompt = buildReflectionPrompt(persona, context);

    expect(prompt).toContain('quality');
  });

  it('should build role-flavored prompt for security role', () => {
    const persona = buildPersona({ role: 'Security Engineer', name: 'Sam' });
    const context = buildContext({ triggerType: 'pr_review', outcome: 'changes_requested' });
    const prompt = buildReflectionPrompt(persona, context);

    expect(prompt).toContain('Sam');
    expect(prompt).toContain('security');
  });

  it('should build generic prompt for unknown role', () => {
    const persona = buildPersona({ role: 'Product Manager', name: 'Parker' });
    const context = buildContext();
    const prompt = buildReflectionPrompt(persona, context);

    expect(prompt).toContain('Parker');
    expect(prompt).toContain('lessons');
  });

  it('should include interaction context in prompt (triggerType, outcome, summary)', () => {
    const persona = buildPersona({ role: 'Implementer', name: 'Dev' });
    const context = buildContext({
      triggerType: 'build_failure',
      outcome: 'fixed',
      summary: 'Fixed the broken CI pipeline caused by a missing env var.',
      filesChanged: ['src/ci.yml', 'src/env.ts'],
    });
    const prompt = buildReflectionPrompt(persona, context);

    expect(prompt).toContain('build_failure');
    expect(prompt).toContain('fixed');
    expect(prompt).toContain('Fixed the broken CI pipeline caused by a missing env var.');
    expect(prompt).toContain('src/ci.yml');
    expect(prompt).toContain('src/env.ts');
  });

  it('should instruct LLM to respond with bullet points', () => {
    const persona = buildPersona();
    const context = buildContext();
    const prompt = buildReflectionPrompt(persona, context);

    expect(prompt).toContain('- ');
    expect(prompt).toContain('bullet');
  });

  it('should include category format in reflection prompt', () => {
    const persona = buildPersona();
    const context = buildContext();
    const prompt = buildReflectionPrompt(persona, context);

    expect(prompt).toContain('[CATEGORY]');
  });

  it('should include good/bad examples in reflection prompt', () => {
    const persona = buildPersona();
    const context = buildContext();
    const prompt = buildReflectionPrompt(persona, context);

    expect(prompt).toContain('GOOD lessons');
    expect(prompt).toContain('BAD lessons');
  });
});

describe('buildCompactionPrompt', () => {
  it('should build compaction prompt with persona name', () => {
    const persona = buildPersona({ name: 'Maya' });
    const currentMemory = '## 2026-02-01\n- Lesson A\n\n## 2026-02-02\n- Lesson B\n';
    const prompt = buildCompactionPrompt(persona, currentMemory);

    expect(prompt).toContain('Maya');
    expect(prompt).toContain(currentMemory);
  });

  it('should include a max bullet point limit derived from COMPACTION_TARGET_LINES', () => {
    const persona = buildPersona({ name: 'Bob' });
    const prompt = buildCompactionPrompt(persona, 'some memory');

    // COMPACTION_TARGET_LINES = 60, so maxBullets = 30
    expect(prompt).toContain('30');
  });

  it('should instruct to respond only with a bullet list and no preamble', () => {
    const persona = buildPersona({ name: 'Charlie' });
    const prompt = buildCompactionPrompt(persona, 'memory content');

    expect(prompt).toContain('bullet');
    expect(prompt).toContain('no preamble');
    expect(prompt).toContain('no headers');
  });

  it('should instruct compaction to preserve refs', () => {
    const persona = buildPersona({ name: 'Priya' });
    const prompt = buildCompactionPrompt(persona, 'memory content');

    expect(prompt).toContain('ref: path#L42');
  });
});

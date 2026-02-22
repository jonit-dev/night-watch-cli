/**
 * Tests for AI persona matcher.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IAgentPersona, INightWatchConfig } from '@night-watch/core';
import * as client from '../../ai/client.js';
import { matchPersonaToMessage } from '../../ai/persona-matcher.js';

const config: INightWatchConfig = {
  provider: 'claude',
  projectsPath: '/test/projects',
} as INightWatchConfig;

function makePersona(name: string, role: string, expertise: string[]): IAgentPersona {
  return {
    id: name.toLowerCase(),
    name,
    role,
    avatarUrl: null,
    soul: { expertise, whoIAm: '', worldview: [], opinions: {}, interests: [], tensions: [], boundaries: [], petPeeves: [] },
    style: {} as IAgentPersona['style'],
    skill: {} as IAgentPersona['skill'],
    modelConfig: null,
    systemPromptOverride: null,
    isActive: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

const maya = makePersona('Maya', 'Security Reviewer', ['security', 'auth', 'OWASP']);
const carlos = makePersona('Carlos', 'Tech Lead', ['architecture', 'system design']);
const priya = makePersona('Priya', 'Product Manager', ['product', 'UX', 'roadmap']);
const personas = [maya, carlos, priya];

describe('matchPersonaToMessage', () => {
  beforeEach(() => {
    vi.spyOn(client, 'callSimpleAI');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns matching persona on exact name match', async () => {
    vi.mocked(client.callSimpleAI).mockResolvedValue('Maya');
    const result = await matchPersonaToMessage('Review our auth flow', personas, config);
    expect(result).toBe(maya);
  });

  it('is case-insensitive', async () => {
    vi.mocked(client.callSimpleAI).mockResolvedValue('CARLOS');
    const result = await matchPersonaToMessage('Redesign the architecture', personas, config);
    expect(result).toBe(carlos);
  });

  it('handles trimmed/padded response', async () => {
    vi.mocked(client.callSimpleAI).mockResolvedValue('  Priya  ');
    const result = await matchPersonaToMessage('What is on the roadmap?', personas, config);
    expect(result).toBe(priya);
  });

  it('uses only first word of response', async () => {
    vi.mocked(client.callSimpleAI).mockResolvedValue('Maya Security Reviewer');
    const result = await matchPersonaToMessage('OWASP issues', personas, config);
    expect(result).toBe(maya);
  });

  it('returns null for unrecognized name', async () => {
    vi.mocked(client.callSimpleAI).mockResolvedValue('Unknown');
    const result = await matchPersonaToMessage('Hello', personas, config);
    expect(result).toBeNull();
  });

  it('returns null for empty response', async () => {
    vi.mocked(client.callSimpleAI).mockResolvedValue('');
    const result = await matchPersonaToMessage('Hello', personas, config);
    expect(result).toBeNull();
  });

  it('returns null when callSimpleAI throws', async () => {
    vi.mocked(client.callSimpleAI).mockRejectedValue(new Error('API error'));
    const result = await matchPersonaToMessage('Hello', personas, config);
    expect(result).toBeNull();
  });

  it('passes only first 500 chars of message', async () => {
    vi.mocked(client.callSimpleAI).mockResolvedValue('Maya');
    const longMessage = 'x'.repeat(1000);
    await matchPersonaToMessage(longMessage, personas, config);
    const userPrompt = vi.mocked(client.callSimpleAI).mock.calls[0]![1];
    expect(userPrompt).toContain('x'.repeat(500));
    expect(userPrompt).not.toContain('x'.repeat(501));
  });
});

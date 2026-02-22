/**
 * Tests for ProactiveLoop — specifically the ticket slicing sweep logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IAgentPersona } from '@night-watch/core';

// --- module mocks -----------------------------------------------------------

vi.mock('@night-watch/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@night-watch/core')>();
  return {
    ...actual,
    getRepositories: vi.fn(),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
    isLeadRole: vi.fn((role: string) => role.toLowerCase().includes('lead')),
  };
});

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
}));

vi.mock('../../personas.js', () => ({
  findCarlos: vi.fn(),
}));

vi.mock('../../deliberation.js', () => ({
  DeliberationEngine: vi.fn(),
}));

vi.mock('../../job-spawner.js', () => ({
  JobSpawner: vi.fn(),
}));

// --- imports after mocks ----------------------------------------------------

import { getRepositories } from '@night-watch/core';
import { findCarlos } from '../../personas.js';
import { ProactiveLoop } from '../../proactive-loop.js';
import type { IProactiveLoopCallbacks } from '../../proactive-loop.js';

// --- helpers ----------------------------------------------------------------

function buildPersona(overrides: Partial<IAgentPersona> = {}): IAgentPersona {
  return {
    id: 'p1',
    name: 'Carlos',
    role: 'Tech Lead',
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
    ...overrides,
  };
}

function buildConfig() {
  return {
    slack: {
      enabled: true,
      discussionEnabled: true,
      botToken: 'xoxb-test',
      autoCreateProjectChannels: false,
    },
  } as any;
}

function buildProject(slackChannelId = 'C1') {
  return { path: '/test/project', name: 'my-project', slackChannelId } as any;
}

function buildCallbacks(overrides: Partial<IProactiveLoopCallbacks> = {}): IProactiveLoopCallbacks {
  return {
    markChannelActivity: vi.fn(),
    buildProjectContext: vi.fn(() => 'project ctx'),
    buildRoadmapContext: vi.fn(() => 'roadmap ctx'),
    buildRoadmapForPersona: vi.fn(() => 'persona roadmap ctx'),
    ...overrides,
  };
}

function buildLoop(
  callbacks: IProactiveLoopCallbacks,
  channelActivityAt: Map<string, number>,
  engineMock: any,
) {
  const jobSpawner = { spawnCodeWatchAudit: vi.fn() } as any;
  const jobCallbacks = {} as any;
  return new ProactiveLoop(
    buildConfig(),
    engineMock,
    jobSpawner,
    jobCallbacks,
    channelActivityAt,
    callbacks,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProactiveLoop — slicing sweep', () => {
  const channel = 'C1';
  const project = buildProject(channel);
  const persona = buildPersona();
  const now = Date.now();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findCarlos).mockReturnValue(persona);
    vi.mocked(getRepositories).mockReturnValue({
      agentPersona: { getActive: vi.fn(() => [persona]) },
      projectRegistry: { getAll: vi.fn(() => [project]) },
    } as any);
  });

  it('should trigger slicing sweep after interval', async () => {
    // Channel has been idle long enough for a proactive message
    // and the last slicing sweep was more than 4 hours ago (never)
    const channelActivityAt = new Map([[channel, now - 25 * 60_000]]); // idle 25min

    const engineMock = { postProactiveMessage: vi.fn().mockResolvedValue(undefined) };
    const callbacks = buildCallbacks();
    const loop = buildLoop(callbacks, channelActivityAt, engineMock);

    // lastSlicingSweepAt is empty → 0 → now - 0 >= 4h (since now >> 4h in epoch ms)
    // But we need to ensure lastProactiveAt also allows it
    // Access private method for testing
    await (loop as any).sendProactiveMessages();

    expect(engineMock.postProactiveMessage).toHaveBeenCalledOnce();
    const callArgs = engineMock.postProactiveMessage.mock.calls[0];
    // 6th argument should be slicingMode = true (lastSlicingSweepAt starts at 0)
    expect(callArgs[5]).toBe(true);
  });

  it('should not trigger slicing before interval', async () => {
    // Channel has been idle long enough for a proactive message
    const channelActivityAt = new Map([[channel, now - 25 * 60_000]]); // idle 25min

    const engineMock = { postProactiveMessage: vi.fn().mockResolvedValue(undefined) };
    const callbacks = buildCallbacks();
    const loop = buildLoop(callbacks, channelActivityAt, engineMock);

    // Manually set lastSlicingSweepAt to just 1 second ago
    (loop as any).lastSlicingSweepAt.set(channel, now - 1_000);
    // Also set lastProactiveAt to allow regular proactive
    (loop as any).lastProactiveAt.set(channel, now - 95 * 60_000);

    await (loop as any).sendProactiveMessages();

    expect(engineMock.postProactiveMessage).toHaveBeenCalledOnce();
    const callArgs = engineMock.postProactiveMessage.mock.calls[0];
    // slicingMode should be false — interval not met
    expect(callArgs[5]).toBe(false);
  });

  it('should prefer Carlos for slicing sweep', async () => {
    const channelActivityAt = new Map([[channel, now - 25 * 60_000]]);
    const otherPersona = buildPersona({ id: 'p2', name: 'Maya', role: 'Security Reviewer' });

    vi.mocked(getRepositories).mockReturnValue({
      agentPersona: { getActive: vi.fn(() => [otherPersona, persona]) },
      projectRegistry: { getAll: vi.fn(() => [project]) },
    } as any);
    vi.mocked(findCarlos).mockReturnValue(persona); // Carlos

    const engineMock = { postProactiveMessage: vi.fn().mockResolvedValue(undefined) };
    const callbacks = buildCallbacks();
    const loop = buildLoop(callbacks, channelActivityAt, engineMock);

    await (loop as any).sendProactiveMessages();

    expect(engineMock.postProactiveMessage).toHaveBeenCalledOnce();
    const callArgs = engineMock.postProactiveMessage.mock.calls[0];
    // Second arg is the persona — should be Carlos
    expect(callArgs[1]).toBe(persona);
    expect(callArgs[5]).toBe(true); // slicingMode
  });

  it('should update lastSlicingSweepAt after slicing sweep', async () => {
    const channelActivityAt = new Map([[channel, now - 25 * 60_000]]);

    const engineMock = { postProactiveMessage: vi.fn().mockResolvedValue(undefined) };
    const callbacks = buildCallbacks();
    const loop = buildLoop(callbacks, channelActivityAt, engineMock);

    await (loop as any).sendProactiveMessages();

    const lastSlicing = (loop as any).lastSlicingSweepAt.get(channel);
    expect(lastSlicing).toBeDefined();
    expect(lastSlicing).toBeGreaterThan(0);
  });
});

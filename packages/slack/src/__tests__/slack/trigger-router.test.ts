import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IAgentPersona } from '@night-watch/core';
import type { IRegistryEntry } from '@night-watch/core';
import { getRepositories } from '@night-watch/core';
import * as projectMatcher from '../../ai/project-matcher.js';
import { ContextFetcher } from '../../context-fetcher.js';
import { DeliberationEngine } from '../../deliberation.js';
import { JobSpawner } from '../../job-spawner.js';
import { MessageParser } from '../../message-parser.js';
import type { IInboundSlackEvent } from '../../message-parser.js';
import { ThreadStateManager } from '../../thread-state-manager.js';
import { TriggerRouter } from '../../trigger-router.js';
import type { ITriggerContext } from '../../trigger-router.js';
import type { CascadingReplyHandler } from '../../cascading-reply-handler.js';

// Mock getRepositories
vi.mock('@night-watch/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@night-watch/core')>();
  return {
    ...actual,
    getRepositories: vi.fn(),
  };
});

// Mock project-matcher to avoid real AI calls in unit tests
vi.mock('../../ai/project-matcher.js', () => ({
  matchProjectToMessage: vi.fn().mockResolvedValue(null),
}));

// ── Minimal builder helpers ──────────────────────────────────────────────────

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

function buildProject(
  id: string,
  name: string,
  path: string,
  slackChannelId?: string,
): IRegistryEntry {
  return { id, name, path, slackChannelId: slackChannelId ?? '' } as IRegistryEntry;
}

function buildEvent(overrides: Partial<IInboundSlackEvent> = {}): IInboundSlackEvent {
  return {
    type: 'message',
    user: 'U123',
    channel: 'C001',
    ts: '1700000000.001',
    text: 'hello',
    ...overrides,
  };
}

// ── Fake/stub constructors ───────────────────────────────────────────────────

function buildRouter(projects: IRegistryEntry[] = []): {
  router: TriggerRouter;
  state: ThreadStateManager;
  parser: MessageParser;
  slackClient: InstanceType<typeof import('../../client.js').SlackClient>;
  engine: DeliberationEngine;
  jobSpawner: JobSpawner;
  contextFetcher: ContextFetcher;
  replyHandler: CascadingReplyHandler;
  mockGetAll: ReturnType<typeof vi.fn>;
} {
  const parser = new MessageParser();
  const state = new ThreadStateManager();
  const slackClient = {
    postAsAgent: vi.fn().mockResolvedValue(undefined),
    addReaction: vi.fn().mockResolvedValue(undefined),
  } as unknown as InstanceType<typeof import('../../client.js').SlackClient>;
  const engine = {
    startDiscussion: vi.fn().mockResolvedValue(undefined),
    replyAsAgent: vi.fn().mockResolvedValue(''),
  } as unknown as DeliberationEngine;
  const jobSpawner = {
    spawnNightWatchJob: vi.fn().mockResolvedValue(undefined),
    spawnDirectProviderRequest: vi.fn().mockResolvedValue(undefined),
  } as unknown as JobSpawner;
  const contextFetcher = {
    fetchGitHubIssueContext: vi.fn().mockResolvedValue(''),
    fetchUrlSummaries: vi.fn().mockResolvedValue(''),
  } as unknown as ContextFetcher;
  const replyHandler = {
    applyHumanResponseTiming: vi.fn().mockResolvedValue(undefined),
    maybeReactToHumanMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as CascadingReplyHandler;

  // Mock getRepositories to return our test projects
  const mockGetAll = vi.fn().mockReturnValue(projects);
  vi.mocked(getRepositories).mockReturnValue({
    projectRegistry: {
      getAll: mockGetAll,
    } as any,
    executionHistory: {} as any,
    prdState: {} as any,
    roadmapState: {} as any,
    agentPersona: {} as any,
    slackDiscussion: {} as any,
  });

  const config = {
    slack: { enabled: true, discussionEnabled: true, botToken: 'tok', appToken: 'app' },
  } as unknown as import('@night-watch/core').INightWatchConfig;

  const router = new TriggerRouter(
    parser,
    slackClient,
    engine,
    jobSpawner,
    state,
    contextFetcher,
    config,
    replyHandler,
  );

  return {
    router,
    state,
    parser,
    slackClient,
    engine,
    jobSpawner,
    contextFetcher,
    replyHandler,
    mockGetAll,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TriggerRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset project matcher to null so individual tests can override as needed.
    vi.mocked(projectMatcher.matchProjectToMessage).mockResolvedValue(null);
  });

  describe('isMessageAddressedToBot', () => {
    it('returns true for app_mention event type', () => {
      const { router } = buildRouter();
      const event = buildEvent({ type: 'app_mention' });
      expect(router.isMessageAddressedToBot(event)).toBe(true);
    });

    it('returns true when text starts with "night watch"', () => {
      const { router } = buildRouter();
      const event = buildEvent({ type: 'message', text: 'night watch, can you run QA?' });
      expect(router.isMessageAddressedToBot(event)).toBe(true);
    });

    it('returns true when text starts with "nw" abbreviation', () => {
      const { router } = buildRouter();
      const event = buildEvent({ type: 'message', text: 'nw please review this PR' });
      expect(router.isMessageAddressedToBot(event)).toBe(true);
    });

    it('returns false for unrelated message text', () => {
      const { router } = buildRouter();
      const event = buildEvent({ type: 'message', text: 'hey team, happy friday!' });
      expect(router.isMessageAddressedToBot(event)).toBe(false);
    });

    it('returns false for message text that does not start with bot name', () => {
      const { router } = buildRouter();
      const event = buildEvent({ type: 'message', text: 'please help me' });
      expect(router.isMessageAddressedToBot(event)).toBe(false);
    });
  });

  describe('resolveProjectByHint', () => {
    it('matches project by exact name', () => {
      const { router } = buildRouter();
      const projects = [
        buildProject('p1', 'Night Watch CLI', '/repos/night-watch-cli'),
        buildProject('p2', 'Other Project', '/repos/other'),
      ];
      const result = router.resolveProjectByHint(projects, 'night-watch-cli');
      expect(result?.id).toBe('p1');
    });

    it('returns null when no project matches the hint', () => {
      const { router } = buildRouter();
      const projects = [buildProject('p1', 'Night Watch CLI', '/repos/night-watch-cli')];
      const result = router.resolveProjectByHint(projects, 'nonexistent-project');
      expect(result).toBeNull();
    });

    it('returns null for empty hint string', () => {
      const { router } = buildRouter();
      const projects = [buildProject('p1', 'Night Watch CLI', '/repos/night-watch-cli')];
      const result = router.resolveProjectByHint(projects, '');
      expect(result).toBeNull();
    });

    it('matches project by path basename', () => {
      const { router } = buildRouter();
      const projects = [buildProject('p1', 'My App', '/repos/my-app')];
      const result = router.resolveProjectByHint(projects, 'my-app');
      expect(result?.id).toBe('p1');
    });
  });

  describe('resolveTargetProject', () => {
    it('resolves by channel match when no hint provided', () => {
      const { router } = buildRouter();
      const projects = [
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
        buildProject('p2', 'Beta', '/repos/beta', 'C002'),
      ];
      const result = router.resolveTargetProject('C001', projects);
      expect(result?.id).toBe('p1');
    });

    it('resolves by hint when provided', () => {
      const { router } = buildRouter();
      const projects = [
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
        buildProject('p2', 'Beta', '/repos/beta', 'C002'),
      ];
      const result = router.resolveTargetProject('C001', projects, 'beta');
      expect(result?.id).toBe('p2');
    });

    it('returns the only project when channel has no match and there is exactly one', () => {
      const { router } = buildRouter();
      const projects = [buildProject('p1', 'Alone', '/repos/alone')];
      const result = router.resolveTargetProject('C999', projects);
      expect(result?.id).toBe('p1');
    });

    it('returns null when multiple projects and no channel/hint match', () => {
      const { router } = buildRouter();
      const projects = [
        buildProject('p1', 'Alpha', '/repos/alpha'),
        buildProject('p2', 'Beta', '/repos/beta'),
      ];
      const result = router.resolveTargetProject('C999', projects);
      expect(result).toBeNull();
    });
  });

  describe('triggerIssueReviewIfFound', () => {
    it('returns false when text contains no GitHub issue URL', async () => {
      const { router } = buildRouter();
      const projects = [buildProject('p1', 'Alpha', '/repos/alpha', 'C001')];
      const result = await router.triggerIssueReviewIfFound(
        'C001',
        '1.0',
        'just a message',
        projects,
      );
      expect(result).toBe(false);
    });

    it('returns false when no matching project for channel', async () => {
      const { router } = buildRouter();
      const projects: IRegistryEntry[] = [];
      const result = await router.triggerIssueReviewIfFound(
        'C001',
        '1.0',
        'https://github.com/org/repo/issues/42',
        projects,
      );
      expect(result).toBe(false);
    });

    it('returns true and starts discussion for valid GitHub issue URL', async () => {
      const { router, engine } = buildRouter();
      const projects = [buildProject('p1', 'Repo', '/repos/repo', 'C001')];
      const result = await router.triggerIssueReviewIfFound(
        'C001',
        '1.0',
        'check out https://github.com/org/repo/issues/42',
        projects,
      );
      expect(result).toBe(true);
      // Give fire-and-forget promise time to resolve
      await new Promise((r) => setTimeout(r, 10));
      expect(engine.startDiscussion).toHaveBeenCalledTimes(1);
    });

    it('skips review when issue is on cooldown', async () => {
      const { router, state, engine } = buildRouter();
      const url = 'https://github.com/org/repo/issues/42';
      state.markIssueReviewed(url);
      const projects = [buildProject('p1', 'Repo', '/repos/repo', 'C001')];
      const result = await router.triggerIssueReviewIfFound(
        'C001',
        '1.0',
        `check out ${url}`,
        projects,
      );
      expect(result).toBe(false);
      expect(engine.startDiscussion).not.toHaveBeenCalled();
    });
  });

  describe('tryRoute', () => {
    it('returns false when no triggers match a plain conversational message', async () => {
      const { router } = buildRouter([buildProject('proj1', 'Alpha', '/repos/alpha', 'C001')]);
      const personas = [buildPersona('p1', 'Maya'), buildPersona('p2', 'Carlos')];
      const projects = [buildProject('proj1', 'Alpha', '/repos/alpha', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({ type: 'message', text: 'how is everyone doing today?' }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(false);
    });

    it('returns false for thread reply messages that do not match any trigger', async () => {
      const { router } = buildRouter([buildProject('proj1', 'Alpha', '/repos/alpha', 'C001')]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [buildProject('proj1', 'Alpha', '/repos/alpha', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({
          type: 'message',
          text: 'sounds good, thanks!',
          thread_ts: '1699999999.000',
        }),
        channel: 'C001',
        threadTs: '1699999999.000',
        messageTs: '1700000000.002',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(false);
    });
  });

  describe('Direct Provider Request (triggerDirectProviderIfRequested)', () => {
    it('returns false when no provider request is detected', async () => {
      const { router } = buildRouter([buildProject('p1', 'Alpha', '/repos/alpha', 'C001')]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [buildProject('p1', 'Alpha', '/repos/alpha', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({ type: 'message', text: 'hello there' }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(false);
    });

    it('handles claude direct provider request when addressed to bot', async () => {
      const { router, slackClient, jobSpawner, replyHandler } = buildRouter([
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
      ]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [buildProject('p1', 'Alpha', '/repos/alpha', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({ type: 'message', text: 'claude fix the tests' }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(true);
      expect(slackClient.postAsAgent).toHaveBeenCalled();
      expect(jobSpawner.spawnDirectProviderRequest).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'claude', prompt: 'fix the tests' }),
        projects[0],
        'C001',
        '1700000000.001',
        personas[0],
        expect.any(Object),
      );
      expect(replyHandler.applyHumanResponseTiming).toHaveBeenCalled();
    });

    it('handles codex direct provider request', async () => {
      const { router, slackClient, jobSpawner } = buildRouter([
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
      ]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [buildProject('p1', 'Alpha', '/repos/alpha', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({ type: 'app_mention', text: 'codex refactor this function' }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(true);
      expect(jobSpawner.spawnDirectProviderRequest).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'codex' }),
        projects[0],
        'C001',
        '1700000000.001',
        personas[0],
        expect.any(Object),
      );
    });

    it('handles provider request with project hint', async () => {
      const { router, jobSpawner } = buildRouter([
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
        buildProject('p2', 'Beta', '/repos/beta', 'C002'),
      ]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
        buildProject('p2', 'Beta', '/repos/beta', 'C002'),
      ];
      const ctx: ITriggerContext = {
        event: buildEvent({ type: 'message', text: 'claude on beta: fix bug' }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(true);
      expect(jobSpawner.spawnDirectProviderRequest).toHaveBeenCalledWith(
        expect.any(Object),
        projects[1], // Beta project
        'C001',
        '1700000000.001',
        personas[0],
        expect.any(Object),
      );
    });

    it('asks for project when ambiguous and posts clarification', async () => {
      const { router, slackClient, jobSpawner } = buildRouter([
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
        buildProject('p2', 'Beta', '/repos/beta', 'C002'),
      ]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
        buildProject('p2', 'Beta', '/repos/beta', 'C002'),
      ];
      const ctx: ITriggerContext = {
        event: buildEvent({ type: 'message', text: 'claude fix the bug' }),
        channel: 'C003', // Different channel not mapped to any project
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(true);
      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'C003',
        expect.stringContaining('Which project?'),
        personas[0],
        '1700000000.001',
      );
      expect(jobSpawner.spawnDirectProviderRequest).not.toHaveBeenCalled();
    });

    it('resolves project via AI matcher when regex fails but AI identifies it', async () => {
      const { router, jobSpawner } = buildRouter([
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
        buildProject('p2', 'Beta', '/repos/beta', 'C002'),
      ]);
      vi.mocked(projectMatcher.matchProjectToMessage).mockResolvedValue(
        buildProject('p2', 'Beta', '/repos/beta', 'C002'),
      );
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
        buildProject('p2', 'Beta', '/repos/beta', 'C002'),
      ];
      const ctx: ITriggerContext = {
        event: buildEvent({ type: 'message', text: 'claude investigate the beta pipeline issue' }),
        channel: 'C003', // No channel match
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(true);
      expect(jobSpawner.spawnDirectProviderRequest).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ name: 'Beta' }),
        'C003',
        '1700000000.001',
        personas[0],
        expect.any(Object),
      );
    });

    it('returns false for provider request without bot address or command', async () => {
      const { router, jobSpawner } = buildRouter([
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
      ]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [buildProject('p1', 'Alpha', '/repos/alpha', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({ type: 'message', text: 'maybe claude can help later' }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(false);
      expect(jobSpawner.spawnDirectProviderRequest).not.toHaveBeenCalled();
    });

    it('trims long prompt in preview message', async () => {
      const { router, slackClient } = buildRouter([
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
      ]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [buildProject('p1', 'Alpha', '/repos/alpha', 'C001')];
      const longPrompt = 'a'.repeat(150);
      const ctx: ITriggerContext = {
        event: buildEvent({ type: 'message', text: `claude ${longPrompt}` }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      await router.tryRoute(ctx);
      const postedMessage = vi.mocked(slackClient.postAsAgent).mock.calls[0]?.[1];
      expect(postedMessage).toBeDefined();
      expect(postedMessage).toContain('...');
      expect(postedMessage!.length).toBeLessThan(200);
    });
  });

  describe('Slack Job Request (triggerSlackJobIfRequested)', () => {
    it('returns false when no job request is detected', async () => {
      const { router } = buildRouter([buildProject('p1', 'Alpha', '/repos/alpha', 'C001')]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [buildProject('p1', 'Alpha', '/repos/alpha', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({ type: 'message', text: 'random message' }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(false);
    });

    it('handles run job request when addressed to bot', async () => {
      const { router, slackClient, jobSpawner } = buildRouter([
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
      ]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [buildProject('p1', 'Alpha', '/repos/alpha', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({ type: 'message', text: 'night watch run' }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(true);
      expect(jobSpawner.spawnNightWatchJob).toHaveBeenCalledWith(
        'run',
        projects[0],
        'C001',
        '1700000000.001',
        personas[0],
        expect.any(Object),
        expect.any(Object),
      );
      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'C001',
        expect.stringContaining('Starting the run'),
        personas[0],
        '1700000000.001',
      );
    });

    it('handles review job request and selects Carlos persona', async () => {
      const { router, jobSpawner } = buildRouter([
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
      ]);
      const personas = [
        buildPersona('p1', 'Maya'),
        buildPersona('p2', 'Carlos'),
        buildPersona('p3', 'Priya'),
      ];
      const projects = [buildProject('p1', 'Alpha', '/repos/alpha', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({ type: 'message', text: 'nw review' }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(true);
      expect(jobSpawner.spawnNightWatchJob).toHaveBeenCalledWith(
        'review',
        projects[0],
        'C001',
        '1700000000.001',
        personas[1], // Carlos
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('handles qa job request and selects Priya persona', async () => {
      const { router, jobSpawner } = buildRouter([
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
      ]);
      const personas = [
        buildPersona('p1', 'Maya'),
        buildPersona('p2', 'Carlos'),
        buildPersona('p3', 'Priya'),
      ];
      const projects = [buildProject('p1', 'Alpha', '/repos/alpha', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({ type: 'message', text: 'night watch qa' }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(true);
      expect(jobSpawner.spawnNightWatchJob).toHaveBeenCalledWith(
        'qa',
        projects[0],
        'C001',
        '1700000000.001',
        personas[2], // Priya
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('handles job request with PR number', async () => {
      const { router, jobSpawner } = buildRouter([
        buildProject('p1', 'alpha', '/repos/alpha', 'C001'),
      ]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [buildProject('p1', 'alpha', '/repos/alpha', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({
          type: 'message',
          text: 'https://github.com/org/alpha/pull/123 please review',
        }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(true);
      expect(jobSpawner.spawnNightWatchJob).toHaveBeenCalledWith(
        'review',
        projects[0],
        'C001',
        '1700000000.001',
        personas[0],
        expect.objectContaining({ prNumber: '123' }),
        expect.any(Object),
      );
    });

    it('handles job request with fix conflicts flag', async () => {
      const { router, jobSpawner } = buildRouter([
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
      ]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [buildProject('p1', 'Alpha', '/repos/alpha', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({
          type: 'message',
          text: 'https://github.com/org/alpha/pull/123 has merge conflicts',
        }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(true);
      expect(jobSpawner.spawnNightWatchJob).toHaveBeenCalledWith(
        'review',
        projects[0],
        'C001',
        '1700000000.001',
        personas[0],
        expect.objectContaining({ fixConflicts: true }),
        expect.any(Object),
      );
    });

    it('asks for project when ambiguous', async () => {
      const { router, slackClient, jobSpawner } = buildRouter([
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
        buildProject('p2', 'Beta', '/repos/beta', 'C002'),
      ]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
        buildProject('p2', 'Beta', '/repos/beta', 'C002'),
      ];
      const ctx: ITriggerContext = {
        event: buildEvent({ type: 'message', text: 'night watch run' }),
        channel: 'C003', // Channel not mapped to any project
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(true);
      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'C003',
        expect.stringContaining('Which project?'),
        personas[0],
        '1700000000.001',
      );
      expect(jobSpawner.spawnNightWatchJob).not.toHaveBeenCalled();
    });

    it('returns false for job request without proper trigger signals', async () => {
      const { router, jobSpawner } = buildRouter([
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
      ]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [buildProject('p1', 'Alpha', '/repos/alpha', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({ type: 'message', text: 'running some tests locally' }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(false);
      expect(jobSpawner.spawnNightWatchJob).not.toHaveBeenCalled();
    });
  });

  describe('Issue Pickup Request (triggerIssuePickupIfRequested)', () => {
    it('returns false when no issue pickup request is detected', async () => {
      const { router } = buildRouter([buildProject('p1', 'Alpha', '/repos/alpha', 'C001')]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [buildProject('p1', 'Alpha', '/repos/alpha', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({ type: 'message', text: 'random message' }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(false);
    });

    it('handles issue pickup request when addressed to bot', async () => {
      const { router, slackClient, jobSpawner } = buildRouter([
        buildProject('p1', 'alpha', '/repos/alpha', 'C001'),
      ]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [buildProject('p1', 'alpha', '/repos/alpha', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({
          type: 'message',
          text: 'night watch pick up https://github.com/org/alpha/issues/42',
        }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(true);
      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'C001',
        expect.stringContaining('picking up #42'),
        personas[0],
        '1700000000.001',
      );
      expect(jobSpawner.spawnNightWatchJob).toHaveBeenCalledWith(
        'run',
        projects[0],
        'C001',
        '1700000000.001',
        personas[0],
        expect.objectContaining({ issueNumber: '42' }),
        expect.any(Object),
      );
    });

    it('handles issue pickup with team request language', async () => {
      const { router, jobSpawner } = buildRouter([
        buildProject('p1', 'alpha', '/repos/alpha', 'C001'),
      ]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [buildProject('p1', 'alpha', '/repos/alpha', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({
          type: 'message',
          text: 'can someone please pick up https://github.com/org/alpha/issues/123',
        }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(true);
      expect(jobSpawner.spawnNightWatchJob).toHaveBeenCalledWith(
        'run',
        projects[0],
        'C001',
        '1700000000.001',
        personas[0],
        expect.objectContaining({ issueNumber: '123' }),
        expect.any(Object),
      );
    });

    it('triggers issue review for plain issue URL (not pickup)', async () => {
      const { router, engine, jobSpawner } = buildRouter([
        buildProject('p1', 'alpha', '/repos/alpha', 'C001'),
      ]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [buildProject('p1', 'alpha', '/repos/alpha', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({
          type: 'message',
          text: 'see https://github.com/org/alpha/issues/456',
        }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      // Should trigger issue review instead of pickup
      expect(result).toBe(true);
      // Give fire-and-forget promise time to resolve
      await new Promise((r) => setTimeout(r, 10));
      expect(engine.startDiscussion).toHaveBeenCalled();
      expect(jobSpawner.spawnNightWatchJob).not.toHaveBeenCalled();
    });

    it('asks for project when issue URL repo does not match any project', async () => {
      const { router, slackClient, jobSpawner } = buildRouter([
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
        buildProject('p2', 'Beta', '/repos/beta', 'C002'),
      ]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
        buildProject('p2', 'Beta', '/repos/beta', 'C002'),
      ];
      const ctx: ITriggerContext = {
        event: buildEvent({
          type: 'message',
          text: 'night watch pick up https://github.com/org/unknown/issues/42',
        }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(true);
      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'C001',
        expect.stringContaining('Which project?'),
        personas[0],
        '1700000000.001',
      );
      expect(jobSpawner.spawnNightWatchJob).not.toHaveBeenCalled();
    });

    it('remembers ad-hoc thread persona after issue pickup', async () => {
      const { router, state, jobSpawner } = buildRouter([
        buildProject('p1', 'alpha', '/repos/alpha', 'C001'),
      ]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [buildProject('p1', 'alpha', '/repos/alpha', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({
          type: 'message',
          text: 'nw pick up https://github.com/org/alpha/issues/42',
        }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      await router.tryRoute(ctx);
      const remembered = state.getRememberedAdHocPersona('C001', '1700000000.001', personas);
      expect(remembered?.id).toBe('p1');
      expect(jobSpawner.spawnNightWatchJob).toHaveBeenCalled();
    });
  });

  describe('Issue Review Integration (via tryRoute)', () => {
    it('triggers issue review for root message with GitHub issue URL', async () => {
      const { router, engine } = buildRouter([buildProject('p1', 'Repo', '/repos/repo', 'C001')]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [buildProject('p1', 'Repo', '/repos/repo', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({
          type: 'message',
          text: 'check this out https://github.com/org/repo/issues/42',
        }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(true);
      // Give fire-and-forget promise time to resolve
      await new Promise((r) => setTimeout(r, 10));
      expect(engine.startDiscussion).toHaveBeenCalledTimes(1);
    });

    it('does not trigger issue review for thread replies', async () => {
      const { router, engine } = buildRouter([buildProject('p1', 'Repo', '/repos/repo', 'C001')]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [buildProject('p1', 'Repo', '/repos/repo', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({
          type: 'message',
          text: 'see https://github.com/org/repo/issues/42',
          thread_ts: '1699999999.000',
        }),
        channel: 'C001',
        threadTs: '1699999999.000',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      const result = await router.tryRoute(ctx);
      expect(result).toBe(false);
      expect(engine.startDiscussion).not.toHaveBeenCalled();
    });
  });

  describe('resolveProjectByHint - edge cases', () => {
    it('matches project by name containing hint', () => {
      const { router } = buildRouter();
      const projects = [
        buildProject('p1', 'Night Watch CLI Core', '/repos/night-watch-cli'),
        buildProject('p2', 'Other Project', '/repos/other'),
      ];
      const result = router.resolveProjectByHint(projects, 'watch');
      expect(result?.id).toBe('p1');
    });

    it('matches project by path basename containing hint', () => {
      const { router } = buildRouter();
      const projects = [
        buildProject('p1', 'My App', '/repos/night-watch-cli'),
        buildProject('p2', 'Other', '/repos/other'),
      ];
      const result = router.resolveProjectByHint(projects, 'watch');
      expect(result?.id).toBe('p1');
    });

    it('returns null for projects array empty', () => {
      const { router } = buildRouter();
      const result = router.resolveProjectByHint([], 'any-hint');
      expect(result).toBeNull();
    });
  });

  describe('resolveTargetProject - edge cases', () => {
    it('returns null for empty projects array', () => {
      const { router } = buildRouter();
      const result = router.resolveTargetProject('C001', []);
      expect(result).toBeNull();
    });

    it('prioritizes hint over channel match when both provided', () => {
      const { router } = buildRouter();
      const projects = [
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
        buildProject('p2', 'Beta', '/repos/beta', 'C002'),
      ];
      const result = router.resolveTargetProject('C001', projects, 'beta');
      expect(result?.id).toBe('p2');
    });

    it('returns null when hint matches nothing and no channel match with multiple projects', () => {
      const { router } = buildRouter();
      const projects = [
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
        buildProject('p2', 'Beta', '/repos/beta', 'C002'),
      ];
      const result = router.resolveTargetProject('C003', projects, 'gamma');
      expect(result).toBeNull();
    });
  });

  describe('isMessageAddressedToBot - edge cases', () => {
    it('returns true for "night-watch" with hyphen', () => {
      const { router } = buildRouter();
      const event = buildEvent({ type: 'message', text: 'night-watch, help me' });
      expect(router.isMessageAddressedToBot(event)).toBe(true);
    });

    it('handles case-insensitive matching for bot name', () => {
      const { router } = buildRouter();
      const event = buildEvent({ type: 'message', text: 'NIGHT WATCH please run' });
      expect(router.isMessageAddressedToBot(event)).toBe(true);
    });

    it('handles case-insensitive matching for abbreviation', () => {
      const { router } = buildRouter();
      const event = buildEvent({ type: 'message', text: 'NW run tests' });
      expect(router.isMessageAddressedToBot(event)).toBe(true);
    });

    it('returns false when bot name appears in middle of text', () => {
      const { router } = buildRouter();
      const event = buildEvent({ type: 'message', text: 'I asked night watch to help earlier' });
      expect(router.isMessageAddressedToBot(event)).toBe(false);
    });

    it('returns false for empty text', () => {
      const { router } = buildRouter();
      const event = buildEvent({ type: 'message', text: '' });
      expect(router.isMessageAddressedToBot(event)).toBe(false);
    });

    it('returns false for undefined text', () => {
      const { router } = buildRouter();
      const event = buildEvent({ type: 'message', text: undefined });
      expect(router.isMessageAddressedToBot(event)).toBe(false);
    });
  });

  describe('Integration - multiple trigger priority order', () => {
    it('prioritizes direct provider over job request when both could match', async () => {
      const { router, jobSpawner } = buildRouter([
        buildProject('p1', 'Alpha', '/repos/alpha', 'C001'),
      ]);
      const personas = [buildPersona('p1', 'Dev')];
      const projects = [buildProject('p1', 'Alpha', '/repos/alpha', 'C001')];
      const ctx: ITriggerContext = {
        event: buildEvent({ type: 'message', text: 'claude run tests' }),
        channel: 'C001',
        threadTs: '1700000000.001',
        messageTs: '1700000000.001',
        personas,
        projects,
      };
      await router.tryRoute(ctx);
      expect(jobSpawner.spawnDirectProviderRequest).toHaveBeenCalled();
      expect(jobSpawner.spawnNightWatchJob).not.toHaveBeenCalled();
    });
  });
});

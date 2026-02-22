import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IAgentPersona, IDiscussionTrigger, INightWatchConfig } from '@night-watch/core';

// --- module mocks -------------------------------------------------------

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
  };
});

vi.mock('../../ai/index.js', () => ({
  callAIForContribution: vi.fn(),
}));

vi.mock('../../humanizer.js', () => ({
  humanizeSlackReply: vi.fn((text: string) => text),
  isSkipMessage: vi.fn((text: string) => text.trim().toUpperCase() === 'SKIP'),
}));

vi.mock('../../personas.js', () => ({
  findCarlos: vi.fn(),
  findDev: vi.fn(),
  getParticipatingPersonas: vi.fn(),
}));

vi.mock('../../deliberation-builders.js', () => ({
  MAX_ROUNDS: 2,
  MAX_AGENT_THREAD_REPLIES: 6,
  formatThreadHistory: vi.fn(() => 'Thread history'),
  countThreadReplies: vi.fn((messages: { ts: string }[]) => Math.max(0, messages.length - 1)),
  humanDelay: vi.fn(() => 0),
}));

vi.mock('../../utils.js', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
  extractErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));

// --- imports after mocks ------------------------------------------------

import { getRepositories } from '@night-watch/core';
import { callAIForContribution } from '../../ai/index.js';
import { humanizeSlackReply, isSkipMessage } from '../../humanizer.js';
import { findCarlos, findDev, getParticipatingPersonas } from '../../personas.js';
import { ConsensusEvaluator } from '../../consensus-evaluator.js';
import type { IConsensusCallbacks } from '../../consensus-evaluator.js';
import type { BoardIntegration } from '../../board-integration.js';
import type { SlackClient } from '../../client.js';
import { sleep } from '../../utils.js';

// --- helpers ------------------------------------------------------------

function buildPersona(overrides: Partial<IAgentPersona> = {}): IAgentPersona {
  return {
    id: 'p-carlos',
    name: 'Carlos',
    role: 'tech lead',
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

function buildConfig(): INightWatchConfig {
  return {
    provider: 'claude',
    claudeModel: 'sonnet',
    slack: {
      botToken: 'xoxb-test',
      appToken: 'xapp-test',
    },
    boardProvider: undefined,
    providerEnv: {},
  } as unknown as INightWatchConfig;
}

function buildSlackClient(): SlackClient {
  return {
    postAsAgent: vi.fn().mockResolvedValue({ ts: '123.456' }),
    getChannelHistory: vi.fn().mockResolvedValue([
      { ts: '1.0', channel: 'C01', text: 'Opening message', username: 'Dev' },
      { ts: '2.0', channel: 'C01', text: 'Reply one', username: 'Maya' },
      { ts: '3.0', channel: 'C01', text: 'Reply two', username: 'Priya' },
    ]),
  } as unknown as SlackClient;
}

function buildBoard(): BoardIntegration {
  return {
    triggerIssueOpener: vi.fn().mockResolvedValue(undefined),
    triggerIssueStatusUpdate: vi.fn().mockResolvedValue(undefined),
  } as unknown as BoardIntegration;
}

function buildDiscussion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'disc-1',
    channelId: 'C01',
    threadTs: '100.000',
    projectPath: '/projects/my-project',
    triggerType: 'pr_review',
    triggerRef: '42',
    status: 'active',
    round: 1,
    participants: [],
    consensusResult: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function buildRepos(discussionOverrides: Record<string, unknown> = {}) {
  const discussion = buildDiscussion(discussionOverrides);
  return {
    agentPersona: { getActive: vi.fn().mockReturnValue([buildPersona()]) },
    slackDiscussion: {
      getById: vi.fn().mockReturnValue(discussion),
      updateStatus: vi.fn(),
      updateRound: vi.fn(),
    },
    projectRegistry: { getAll: vi.fn().mockReturnValue([]) },
  };
}

function buildCallbacks(): IConsensusCallbacks {
  return {
    runContributionRound: vi.fn().mockResolvedValue(undefined),
    triggerPRRefinement: vi.fn().mockResolvedValue(undefined),
  };
}

function buildTrigger(overrides: Partial<IDiscussionTrigger> = {}): IDiscussionTrigger {
  return {
    type: 'pr_review',
    projectPath: '/projects/my-project',
    ref: '42',
    context: 'PR review context',
    ...overrides,
  };
}

// --- tests --------------------------------------------------------------

describe('ConsensusEvaluator', () => {
  let evaluator: ConsensusEvaluator;
  let slackClient: SlackClient;
  let board: BoardIntegration;
  let config: INightWatchConfig;

  beforeEach(() => {
    vi.resetAllMocks();
    slackClient = buildSlackClient();
    board = buildBoard();
    config = buildConfig();
    evaluator = new ConsensusEvaluator(slackClient, config, board);

    vi.mocked(humanizeSlackReply).mockImplementation((text) => text);
    vi.mocked(isSkipMessage).mockImplementation((text) => text.trim().toUpperCase() === 'SKIP');
  });

  // --- evaluateConsensus — early exit paths ---------------------------------

  describe('evaluateConsensus — early exit when discussion not found', () => {
    it('returns immediately when discussion is not found', async () => {
      const repos = buildRepos();
      repos.slackDiscussion.getById = vi.fn().mockReturnValue(null);
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );

      await evaluator.evaluateConsensus('disc-1', buildTrigger(), buildCallbacks());

      expect(slackClient.postAsAgent).not.toHaveBeenCalled();
      expect(repos.slackDiscussion.updateStatus).not.toHaveBeenCalled();
    });

    it('returns immediately when discussion status is not active', async () => {
      const repos = buildRepos({ status: 'consensus' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );

      await evaluator.evaluateConsensus('disc-1', buildTrigger(), buildCallbacks());

      expect(slackClient.postAsAgent).not.toHaveBeenCalled();
      expect(repos.slackDiscussion.updateStatus).not.toHaveBeenCalled();
    });
  });

  // --- evaluateConsensus — issue_review delegation -------------------------

  describe('evaluateConsensus — issue_review path', () => {
    it('delegates to evaluateIssueReviewConsensus when trigger type is issue_review', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ triggerType: 'issue_review' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('DRAFT: Needs more context.');

      const trigger = buildTrigger({ type: 'issue_review', ref: 'org/repo#5' });
      await evaluator.evaluateConsensus('disc-1', trigger, buildCallbacks());

      // Should update status via issue review path (DRAFT => 'consensus'/'approved')
      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'approved',
      );
    });
  });

  // --- evaluateConsensus — no Carlos persona -------------------------------

  describe('evaluateConsensus — no Carlos persona', () => {
    it('auto-approves when no Carlos persona is found', async () => {
      const repos = buildRepos();
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(null);

      await evaluator.evaluateConsensus('disc-1', buildTrigger(), buildCallbacks());

      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'approved',
      );
      expect(slackClient.postAsAgent).not.toHaveBeenCalled();
    });
  });

  // --- evaluateConsensus — APPROVE decision --------------------------------

  describe('evaluateConsensus — APPROVE decision', () => {
    it('marks discussion as consensus/approved on APPROVE', async () => {
      const carlos = buildPersona();
      const repos = buildRepos();
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('APPROVE: Clean. Ship it.');

      await evaluator.evaluateConsensus('disc-1', buildTrigger(), buildCallbacks());

      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'approved',
      );
      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'C01',
        'Clean. Ship it.',
        carlos,
        '100.000',
      );
    });

    it('triggers issue opener when code_watch trigger is approved', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ triggerType: 'code_watch' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('APPROVE: Looks good.');

      const trigger = buildTrigger({ type: 'code_watch' });
      await evaluator.evaluateConsensus('disc-1', trigger, buildCallbacks());

      expect(board.triggerIssueOpener).toHaveBeenCalledWith('disc-1', trigger);
    });
  });

  // --- evaluateConsensus — CHANGES decision --------------------------------

  describe('evaluateConsensus — CHANGES decision with rounds available', () => {
    it('runs another contribution round and continues loop when CHANGES and rounds remain', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ round: 1 });
      const callbacks = buildCallbacks();
      // First call returns CHANGES, second call returns APPROVE to end the loop
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(findDev).mockReturnValue(null);
      vi.mocked(getParticipatingPersonas).mockReturnValue([carlos]);
      vi.mocked(callAIForContribution)
        .mockResolvedValueOnce('CHANGES: Need to address security concerns.')
        .mockResolvedValueOnce('APPROVE: All good now.');

      // Only 1 message in thread so repliesUsed=0, repliesLeft=4 >= 3 (condition is met)
      vi.mocked(slackClient.getChannelHistory).mockResolvedValue([
        { ts: '1.0', channel: 'C01', text: 'Opening message', username: 'Dev' },
      ]);

      // getById returns round=1 first, then round=2 for the second loop iteration
      repos.slackDiscussion.getById = vi
        .fn()
        .mockReturnValueOnce(buildDiscussion({ round: 1 }))
        .mockReturnValueOnce(buildDiscussion({ round: 2 }));

      await evaluator.evaluateConsensus('disc-1', buildTrigger(), callbacks);

      expect(callbacks.runContributionRound).toHaveBeenCalledOnce();
      expect(repos.slackDiscussion.updateRound).toHaveBeenCalledWith('disc-1', 2);
      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'approved',
      );
    });

    it('marks changes_requested and triggers PR refinement when CHANGES and no rounds left', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ round: 2, triggerType: 'pr_review' }); // round=MAX_ROUNDS so no more rounds
      const callbacks = buildCallbacks();
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('CHANGES: Missing test coverage.');

      await evaluator.evaluateConsensus(
        'disc-1',
        buildTrigger({ type: 'pr_review', ref: '42' }),
        callbacks,
      );

      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'changes_requested',
      );
      expect(callbacks.triggerPRRefinement).toHaveBeenCalledWith(
        'disc-1',
        'Missing test coverage.',
        '42',
      );
    });
  });

  // --- evaluateConsensus — HUMAN decision ----------------------------------

  describe('evaluateConsensus — HUMAN decision', () => {
    it('marks discussion as blocked/human_needed on HUMAN', async () => {
      const carlos = buildPersona();
      const repos = buildRepos();
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue(
        'HUMAN: Ambiguous trade-off, needs product decision.',
      );

      await evaluator.evaluateConsensus('disc-1', buildTrigger(), buildCallbacks());

      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'blocked',
        'human_needed',
      );
      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'C01',
        'Need a human decision: Ambiguous trade-off, needs product decision.',
        carlos,
        '100.000',
      );
    });
  });

  // --- evaluateIssueReviewConsensus ----------------------------------------

  describe('evaluateIssueReviewConsensus — READY decision', () => {
    it('marks approved and triggers issue status update to ready', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ triggerType: 'issue_review', status: 'active' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('READY: Valid issue, moving to Ready.');

      const trigger = buildTrigger({ type: 'issue_review', ref: 'org/repo#10' });
      await evaluator.evaluateIssueReviewConsensus('disc-1', trigger);

      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'approved',
      );
      expect(board.triggerIssueStatusUpdate).toHaveBeenCalledWith('ready', 'disc-1', trigger);
    });
  });

  describe('evaluateIssueReviewConsensus — CLOSE decision', () => {
    it('marks approved and triggers issue status update to close', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ triggerType: 'issue_review', status: 'active' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('CLOSE: Duplicate of existing issue.');

      const trigger = buildTrigger({ type: 'issue_review', ref: 'org/repo#10' });
      await evaluator.evaluateIssueReviewConsensus('disc-1', trigger);

      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'approved',
      );
      expect(board.triggerIssueStatusUpdate).toHaveBeenCalledWith('close', 'disc-1', trigger);
    });
  });

  describe('evaluateIssueReviewConsensus — DRAFT decision', () => {
    it('marks approved without triggering board action on DRAFT', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ triggerType: 'issue_review', status: 'active' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('DRAFT: Valid but not urgent right now.');

      const trigger = buildTrigger({ type: 'issue_review', ref: 'org/repo#10' });
      await evaluator.evaluateIssueReviewConsensus('disc-1', trigger);

      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'approved',
      );
      expect(board.triggerIssueStatusUpdate).not.toHaveBeenCalled();
    });

    it('auto-approves when no lead persona is found', async () => {
      const repos = buildRepos({ triggerType: 'issue_review', status: 'active' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(null);

      const trigger = buildTrigger({ type: 'issue_review', ref: 'org/repo#10' });
      await evaluator.evaluateIssueReviewConsensus('disc-1', trigger);

      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'approved',
      );
      expect(board.triggerIssueStatusUpdate).not.toHaveBeenCalled();
      expect(slackClient.postAsAgent).not.toHaveBeenCalled();
    });

    it('returns early when discussion is not active', async () => {
      const repos = buildRepos({ triggerType: 'issue_review', status: 'consensus' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );

      const trigger = buildTrigger({ type: 'issue_review', ref: 'org/repo#10' });
      await evaluator.evaluateIssueReviewConsensus('disc-1', trigger);

      expect(repos.slackDiscussion.updateStatus).not.toHaveBeenCalled();
    });
  });

  // --- evaluateIssueReviewConsensus — error handling -------------------------

  describe('evaluateIssueReviewConsensus — error handling', () => {
    it('falls back to DRAFT when AI call fails', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ triggerType: 'issue_review', status: 'active' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockRejectedValue(new Error('AI service unavailable'));

      const trigger = buildTrigger({ type: 'issue_review', ref: 'org/repo#10' });
      await evaluator.evaluateIssueReviewConsensus('disc-1', trigger);

      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'approved',
      );
      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'C01',
        expect.stringContaining('AI evaluation failed'),
        carlos,
        '100.000',
      );
    });

    it('does not post when humanize returns SKIP', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ triggerType: 'issue_review', status: 'active' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('READY: Good to go.');
      vi.mocked(humanizeSlackReply).mockReturnValue('SKIP');
      vi.mocked(isSkipMessage).mockReturnValue(true);

      const trigger = buildTrigger({ type: 'issue_review', ref: 'org/repo#10' });
      await evaluator.evaluateIssueReviewConsensus('disc-1', trigger);

      expect(slackClient.postAsAgent).not.toHaveBeenCalled();
      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'approved',
      );
    });
  });

  // --- evaluateConsensus — thread reply limit -------------------------------

  describe('evaluateConsensus — thread reply limit', () => {
    it('blocks when max agent thread replies exceeded', async () => {
      const carlos = buildPersona();
      const repos = buildRepos();
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);

      // Mock 7 replies (6 agent replies + original message = 7, which exceeds MAX_AGENT_THREAD_REPLIES=6)
      vi.mocked(slackClient.getChannelHistory).mockResolvedValue([
        { ts: '1.0', channel: 'C01', text: 'Original', username: 'Dev' },
        { ts: '2.0', channel: 'C01', text: 'Reply 1', username: 'Maya' },
        { ts: '3.0', channel: 'C01', text: 'Reply 2', username: 'Carlos' },
        { ts: '4.0', channel: 'C01', text: 'Reply 3', username: 'Priya' },
        { ts: '5.0', channel: 'C01', text: 'Reply 4', username: 'Dev' },
        { ts: '6.0', channel: 'C01', text: 'Reply 5', username: 'Maya' },
        { ts: '7.0', channel: 'C01', text: 'Reply 6', username: 'Carlos' },
        { ts: '8.0', channel: 'C01', text: 'Reply 7', username: 'Priya' },
      ]);

      await evaluator.evaluateConsensus('disc-1', buildTrigger(), buildCallbacks());

      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'blocked',
        'human_needed',
      );
      expect(callAIForContribution).not.toHaveBeenCalled();
    });
  });

  // --- evaluateConsensus — AI error handling -------------------------------

  describe('evaluateConsensus — AI error handling', () => {
    it('falls back to HUMAN decision when AI call fails', async () => {
      const carlos = buildPersona();
      const repos = buildRepos();
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockRejectedValue(new Error('AI service unavailable'));

      await evaluator.evaluateConsensus('disc-1', buildTrigger(), buildCallbacks());

      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'blocked',
        'human_needed',
      );
      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'C01',
        expect.stringContaining('AI evaluation failed'),
        carlos,
        '100.000',
      );
    });
  });

  // --- evaluateConsensus — skip message handling ---------------------------

  describe('evaluateConsensus — skip message handling', () => {
    it('does not post when humanize returns SKIP for APPROVE', async () => {
      const carlos = buildPersona();
      const repos = buildRepos();
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('APPROVE: Looks good.');
      vi.mocked(humanizeSlackReply).mockReturnValue('SKIP');
      vi.mocked(isSkipMessage).mockReturnValue(true);

      await evaluator.evaluateConsensus('disc-1', buildTrigger(), buildCallbacks());

      expect(slackClient.postAsAgent).not.toHaveBeenCalled();
      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'approved',
      );
    });

    it('does not post when humanize returns SKIP for CHANGES', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ round: 1 });
      const callbacks = buildCallbacks();
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(findDev).mockReturnValue(null);
      vi.mocked(getParticipatingPersonas).mockReturnValue([carlos]);
      vi.mocked(humanizeSlackReply).mockImplementation((text) => {
        if (text.includes('CHANGES')) return 'SKIP';
        return text;
      });

      // First CHANGES (skip), then APPROVE to end loop
      vi.mocked(callAIForContribution)
        .mockResolvedValueOnce('CHANGES: Need fixes.')
        .mockResolvedValueOnce('APPROVE: OK now.');

      // Only 1 message so repliesLeft=4 >= 3, allowing another round
      vi.mocked(slackClient.getChannelHistory).mockResolvedValue([
        { ts: '1.0', channel: 'C01', text: 'Opening message', username: 'Dev' },
      ]);

      // getById returns round=1 first, then round=2 for the second loop iteration
      repos.slackDiscussion.getById = vi
        .fn()
        .mockReturnValueOnce(buildDiscussion({ round: 1 }))
        .mockReturnValueOnce(buildDiscussion({ round: 2 }));

      await evaluator.evaluateConsensus('disc-1', buildTrigger(), callbacks);

      // Should have called for CHANGES decision but skipped posting
      expect(repos.slackDiscussion.updateRound).toHaveBeenCalled();
    });
  });

  // --- evaluateConsensus — CHANGES with insufficient replies ----------------

  describe('evaluateConsensus — CHANGES with insufficient replies', () => {
    it('requests changes directly when repliesLeft < 3 but round < MAX_ROUNDS', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ round: 1 });
      const callbacks = buildCallbacks();
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('CHANGES: Fix the tests.');

      // With MAX_AGENT_THREAD_REPLIES=6: need repliesUsed>=4 for repliesLeft<3
      // 5 messages: repliesUsed=4, repliesLeft=6-4=2 which is < 3
      vi.mocked(slackClient.getChannelHistory).mockResolvedValue([
        { ts: '1.0', channel: 'C01', text: 'Original', username: 'Dev' },
        { ts: '2.0', channel: 'C01', text: 'Reply 1', username: 'Maya' },
        { ts: '3.0', channel: 'C01', text: 'Reply 2', username: 'Carlos' },
        { ts: '4.0', channel: 'C01', text: 'Reply 3', username: 'Priya' },
        { ts: '5.0', channel: 'C01', text: 'Reply 4', username: 'Dev' },
      ]);

      await evaluator.evaluateConsensus('disc-1', buildTrigger(), callbacks);

      // Should go to changes_requested instead of another round
      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'changes_requested',
      );
      expect(callbacks.runContributionRound).not.toHaveBeenCalled();
    });

    it('requests changes when at max rounds regardless of replies', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ round: 2 }); // MAX_ROUNDS
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('CHANGES: One more thing.');

      await evaluator.evaluateConsensus('disc-1', buildTrigger(), buildCallbacks());

      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'changes_requested',
      );
      expect(repos.slackDiscussion.updateRound).not.toHaveBeenCalled();
    });
  });

  // --- evaluateConsensus — various trigger types ---------------------------

  describe('evaluateConsensus — various trigger types', () => {
    it('handles build_failure trigger', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ triggerType: 'build_failure' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('APPROVE: Fix applied.');

      const trigger = buildTrigger({ type: 'build_failure', ref: 'main-123' });
      await evaluator.evaluateConsensus('disc-1', trigger, buildCallbacks());

      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'approved',
      );
    });

    it('handles prd_kickoff trigger', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ triggerType: 'prd_kickoff' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('APPROVE: Plan looks solid.');

      const trigger = buildTrigger({ type: 'prd_kickoff', ref: 'PRD-123' });
      await evaluator.evaluateConsensus('disc-1', trigger, buildCallbacks());

      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'approved',
      );
    });
  });

  // --- evaluateConsensus — empty/edge case AI responses --------------------

  describe('evaluateConsensus — empty/edge case AI responses', () => {
    it('handles empty APPROVE message with default text', async () => {
      const carlos = buildPersona();
      const repos = buildRepos();
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('APPROVE:');
      vi.mocked(humanizeSlackReply).mockImplementation((text) => text.trim());

      await evaluator.evaluateConsensus('disc-1', buildTrigger(), buildCallbacks());

      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'C01',
        'Clean. Ship it.',
        carlos,
        '100.000',
      );
    });

    it('handles empty CHANGES message with default text', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ round: 2, triggerType: 'pr_review' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('CHANGES:');
      vi.mocked(humanizeSlackReply).mockImplementation((text) => text.trim());

      await evaluator.evaluateConsensus('disc-1', buildTrigger(), buildCallbacks());

      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'changes_requested',
      );
      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'C01',
        expect.stringContaining('Need changes'),
        carlos,
        '100.000',
      );
    });

    it('handles empty HUMAN message with default text', async () => {
      const carlos = buildPersona();
      const repos = buildRepos();
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('HUMAN:');
      vi.mocked(humanizeSlackReply).mockImplementation((text) => text.trim());

      await evaluator.evaluateConsensus('disc-1', buildTrigger(), buildCallbacks());

      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'blocked',
        'human_needed',
      );
      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'C01',
        expect.stringContaining('Need a human decision'),
        carlos,
        '100.000',
      );
    });
  });

  // --- evaluateConsensus — board integration error handling ---------------

  describe('evaluateConsensus — board integration error handling', () => {
    it('continues when board.triggerIssueOpener fails', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ triggerType: 'code_watch' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('APPROVE: Looks good.');
      vi.mocked(board.triggerIssueOpener).mockRejectedValue(new Error('Board API error'));

      const trigger = buildTrigger({ type: 'code_watch' });
      await evaluator.evaluateConsensus('disc-1', trigger, buildCallbacks());

      // Should still approve despite board error
      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'approved',
      );
    });

    it('continues when PR refinement trigger fails', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ round: 2, triggerType: 'pr_review', triggerRef: '42' });
      const callbacks = buildCallbacks();
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('CHANGES: Fix tests.');
      vi.mocked(callbacks.triggerPRRefinement).mockRejectedValue(new Error('PR API error'));

      await evaluator.evaluateConsensus('disc-1', buildTrigger(), callbacks);

      // Should still mark as changes_requested despite callback error
      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'changes_requested',
      );
    });
  });

  // --- evaluateIssueReviewConsensus — edge case responses -----------------

  describe('evaluateIssueReviewConsensus — edge case responses', () => {
    it('handles empty READY message with default text', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ triggerType: 'issue_review', status: 'active' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('READY:');
      vi.mocked(humanizeSlackReply).mockImplementation((text) => text.trim());

      const trigger = buildTrigger({ type: 'issue_review', ref: 'org/repo#10' });
      await evaluator.evaluateIssueReviewConsensus('disc-1', trigger);

      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'C01',
        'Looks good — moving to Ready.',
        carlos,
        '100.000',
      );
    });

    it('handles empty CLOSE message with default text', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ triggerType: 'issue_review', status: 'active' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('CLOSE:');
      vi.mocked(humanizeSlackReply).mockImplementation((text) => text.trim());

      const trigger = buildTrigger({ type: 'issue_review', ref: 'org/repo#10' });
      await evaluator.evaluateIssueReviewConsensus('disc-1', trigger);

      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'C01',
        'Closing this — not worth tracking.',
        carlos,
        '100.000',
      );
    });

    it('handles empty DRAFT message with default text', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ triggerType: 'issue_review', status: 'active' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('DRAFT:');
      vi.mocked(humanizeSlackReply).mockImplementation((text) => text.trim());

      const trigger = buildTrigger({ type: 'issue_review', ref: 'org/repo#10' });
      await evaluator.evaluateIssueReviewConsensus('disc-1', trigger);

      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'C01',
        'Leaving in Draft — needs more context.',
        carlos,
        '100.000',
      );
    });

    it('handles unknown decision prefix as DRAFT fallback', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ triggerType: 'issue_review', status: 'active' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('UNKNOWN: Some unexpected response.');

      const trigger = buildTrigger({ type: 'issue_review', ref: 'org/repo#10' });
      await evaluator.evaluateIssueReviewConsensus('disc-1', trigger);

      // Unknown prefixes fall through to DRAFT handling
      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'approved',
      );
      expect(slackClient.postAsAgent).toHaveBeenCalled();
    });
  });

  // --- evaluateIssueReviewConsensus — board error handling -----------------

  describe('evaluateIssueReviewConsensus — board error handling', () => {
    it('continues when triggerIssueStatusUpdate fails for READY', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ triggerType: 'issue_review', status: 'active' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('READY: Valid issue.');
      vi.mocked(board.triggerIssueStatusUpdate).mockRejectedValue(new Error('Board API error'));

      const trigger = buildTrigger({ type: 'issue_review', ref: 'org/repo#10' });
      await evaluator.evaluateIssueReviewConsensus('disc-1', trigger);

      // Should still approve despite board error
      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'approved',
      );
    });
  });

  // --- evaluateConsensus — loop state changes ------------------------------

  describe('evaluateConsensus — loop state changes', () => {
    it('re-fetches discussion state on each loop iteration', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ round: 1 });
      const callbacks = buildCallbacks();
      const getByIdMock = vi
        .fn()
        .mockReturnValueOnce(buildDiscussion({ round: 1, status: 'active' }))
        .mockReturnValueOnce(buildDiscussion({ round: 2, status: 'active' })); // Second call gets updated round

      vi.mocked(getRepositories).mockReturnValue({
        ...repos,
        slackDiscussion: { ...repos.slackDiscussion, getById: getByIdMock },
      } as unknown as ReturnType<typeof getRepositories>);
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(findDev).mockReturnValue(null);
      vi.mocked(getParticipatingPersonas).mockReturnValue([carlos]);
      vi.mocked(callAIForContribution)
        .mockResolvedValueOnce('CHANGES: Need more context.')
        .mockResolvedValueOnce('APPROVE: Good now.');

      vi.mocked(slackClient.getChannelHistory).mockResolvedValue([
        { ts: '1.0', channel: 'C01', text: 'Original', username: 'Dev' },
      ]);

      await evaluator.evaluateConsensus('disc-1', buildTrigger(), callbacks);

      // Should have called getById twice (start, and after CHANGES before next iteration)
      expect(getByIdMock).toHaveBeenCalledTimes(2);
    });

    it('exits loop when discussion status changes to non-active on next iteration', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ round: 1 });
      const callbacks = buildCallbacks();
      const getByIdMock = vi
        .fn()
        .mockReturnValueOnce(buildDiscussion({ round: 1, status: 'active' }))
        .mockReturnValueOnce(buildDiscussion({ round: 2, status: 'consensus' })); // Status changed externally after round update

      vi.mocked(getRepositories).mockReturnValue({
        ...repos,
        slackDiscussion: { ...repos.slackDiscussion, getById: getByIdMock },
      } as unknown as ReturnType<typeof getRepositories>);
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(findDev).mockReturnValue(null);
      vi.mocked(getParticipatingPersonas).mockReturnValue([carlos]);
      vi.mocked(callAIForContribution).mockResolvedValue('CHANGES: Need more context.');

      vi.mocked(slackClient.getChannelHistory).mockResolvedValue([
        { ts: '1.0', channel: 'C01', text: 'Original', username: 'Dev' },
      ]);

      await evaluator.evaluateConsensus('disc-1', buildTrigger(), callbacks);

      // Should have called contribution round once (before detecting status change)
      expect(callbacks.runContributionRound).toHaveBeenCalledOnce();
      // Should NOT have called AI a second time (exited on status check)
      expect(callAIForContribution).toHaveBeenCalledOnce();
    });
  });

  // --- evaluateConsensus — non-code_watch triggers -------------------------

  describe('evaluateConsensus — non-code_watch triggers do not trigger issue opener', () => {
    it('does not trigger issue opener for pr_review approval', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ triggerType: 'pr_review' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('APPROVE: LGTM.');

      const trigger = buildTrigger({ type: 'pr_review', ref: '42' });
      await evaluator.evaluateConsensus('disc-1', trigger, buildCallbacks());

      expect(board.triggerIssueOpener).not.toHaveBeenCalled();
      expect(repos.slackDiscussion.updateStatus).toHaveBeenCalledWith(
        'disc-1',
        'consensus',
        'approved',
      );
    });

    it('does not trigger issue opener for build_failure approval', async () => {
      const carlos = buildPersona();
      const repos = buildRepos({ triggerType: 'build_failure' });
      vi.mocked(getRepositories).mockReturnValue(
        repos as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findCarlos).mockReturnValue(carlos);
      vi.mocked(callAIForContribution).mockResolvedValue('APPROVE: Fixed.');

      const trigger = buildTrigger({ type: 'build_failure', ref: 'main' });
      await evaluator.evaluateConsensus('disc-1', trigger, buildCallbacks());

      expect(board.triggerIssueOpener).not.toHaveBeenCalled();
    });
  });
});

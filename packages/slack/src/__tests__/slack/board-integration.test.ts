import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IAgentPersona, IBoardProviderConfig, INightWatchConfig } from '@night-watch/core';

// --- module mocks -------------------------------------------------------

vi.mock('@night-watch/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@night-watch/core')>();
  return {
    ...actual,
    loadConfig: vi.fn(),
    getRepositories: vi.fn(),
    createBoardProvider: vi.fn(),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn(),
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
  findDev: vi.fn(),
  findCarlos: vi.fn(),
}));

vi.mock('../../deliberation-builders.js', () => ({
  buildIssueTitleFromTrigger: vi.fn(() => 'fix: test signal at src/foo.ts'),
}));

vi.mock('../../utils.js', () => ({
  buildCurrentCliInvocation: vi.fn(),
}));

// --- imports after mocks ------------------------------------------------

import { loadConfig, getRepositories, createBoardProvider } from '@night-watch/core';
import { execFileSync } from 'node:child_process';
import { callAIForContribution } from '../../ai/index.js';
import { humanizeSlackReply, isSkipMessage } from '../../humanizer.js';
import { findDev, findCarlos } from '../../personas.js';
import { BoardIntegration } from '../../board-integration.js';
import type { SlackClient } from '../../client.js';

// --- helpers ------------------------------------------------------------

function buildPersona(overrides: Partial<IAgentPersona> = {}): IAgentPersona {
  return {
    id: 'p-dev',
    name: 'Dev',
    role: 'implementer',
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

function buildCarlosPersona(): IAgentPersona {
  return buildPersona({
    id: 'p-carlos',
    name: 'Carlos',
    role: 'tech lead',
  });
}

function buildConfig(): INightWatchConfig {
  return {
    provider: 'claude',
    claudeModel: 'sonnet',
    slack: {
      botToken: 'xoxb-test',
      appToken: 'xapp-test',
      channels: { eng: 'C01', prs: 'C02', incidents: 'C03' },
    },
    boardProvider: undefined,
    providerEnv: {},
  } as unknown as INightWatchConfig;
}

function buildSlackClient(): SlackClient {
  return {
    postAsAgent: vi.fn().mockResolvedValue({ ts: '123.456' }),
    getChannelHistory: vi.fn().mockResolvedValue([]),
  } as unknown as SlackClient;
}

function buildDiscussion(overrides = {}) {
  return {
    id: 'disc-1',
    channelId: 'C01',
    threadTs: '100.000',
    projectPath: '/projects/my-project',
    triggerType: 'code_watch',
    triggerRef: 'ref-abc',
    status: 'active',
    round: 1,
    participants: [],
    consensusResult: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function buildRepos(overrides: Record<string, unknown> = {}) {
  return {
    agentPersona: { getActive: vi.fn().mockReturnValue([buildPersona()]) },
    slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
    projectRegistry: { getAll: vi.fn().mockReturnValue([]) },
    ...overrides,
  };
}

// --- tests --------------------------------------------------------------

describe('BoardIntegration', () => {
  let board: BoardIntegration;
  let slackClient: SlackClient;
  let config: INightWatchConfig;

  beforeEach(() => {
    vi.resetAllMocks();
    slackClient = buildSlackClient();
    config = buildConfig();
    board = new BoardIntegration(slackClient, config);

    // Default: humanizeSlackReply passes text through, isSkipMessage checks SKIP
    vi.mocked(humanizeSlackReply).mockImplementation((text) => text);
    vi.mocked(isSkipMessage).mockImplementation((text) => text.trim().toUpperCase() === 'SKIP');
  });

  // --- resolveBoardConfig -----------------------------------------------

  describe('resolveBoardConfig', () => {
    it('returns null when loadConfig throws', () => {
      vi.mocked(loadConfig).mockImplementation(() => {
        throw new Error('file not found');
      });

      const result = board.resolveBoardConfig('/projects/missing');

      expect(result).toBeNull();
    });

    it('returns null when boardProvider is absent', () => {
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: undefined,
      } as unknown as INightWatchConfig);

      const result = board.resolveBoardConfig('/projects/no-board');

      expect(result).toBeNull();
    });

    it('returns null when boardProvider.enabled is false', () => {
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: { enabled: false, projectNumber: 42 },
      } as unknown as INightWatchConfig);

      const result = board.resolveBoardConfig('/projects/disabled-board');

      expect(result).toBeNull();
    });

    it('returns null when projectNumber is not a number', () => {
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: { enabled: true, projectNumber: 'not-a-number' },
      } as unknown as INightWatchConfig);

      const result = board.resolveBoardConfig('/projects/bad-config');

      expect(result).toBeNull();
    });

    it('returns null when projectNumber is missing', () => {
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: { enabled: true },
      } as unknown as INightWatchConfig);

      const result = board.resolveBoardConfig('/projects/no-project-number');

      expect(result).toBeNull();
    });

    it('returns the board config when enabled with a valid projectNumber', () => {
      const boardConfig: IBoardProviderConfig = {
        enabled: true,
        projectNumber: 7,
        type: 'github',
        owner: 'org',
        repo: 'repo',
      } as unknown as IBoardProviderConfig;
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: boardConfig,
      } as unknown as INightWatchConfig);

      const result = board.resolveBoardConfig('/projects/has-board');

      expect(result).toBe(boardConfig);
    });
  });

  // --- generateIssueBody -------------------------------------------------

  describe('generateIssueBody', () => {
    it('generates a structured GitHub issue body with proper prompt', async () => {
      const dev = buildPersona({ name: 'Dev', role: 'implementer' });
      const trigger = {
        type: 'code_watch' as const,
        projectPath: '/projects/test',
        ref: 'ref-123',
        context: 'Signal: unused variable\nLocation: src/index.ts',
      };

      vi.mocked(callAIForContribution).mockResolvedValue(
        '## Context\nProblem: ...\n\n## Proposed Fix\n...',
      );

      const result = await board.generateIssueBody(trigger, dev);

      expect(callAIForContribution).toHaveBeenCalledWith(
        dev,
        config,
        expect.stringContaining('You are Dev, implementer'),
      );
      expect(callAIForContribution).toHaveBeenCalledWith(
        dev,
        config,
        expect.stringContaining('PRD rigor'),
      );
      expect(callAIForContribution).toHaveBeenCalledWith(
        dev,
        config,
        expect.stringContaining('implementation plan'),
      );
      expect(callAIForContribution).toHaveBeenCalledWith(
        dev,
        config,
        expect.stringContaining('## Context'),
      );
      expect(callAIForContribution).toHaveBeenCalledWith(
        dev,
        config,
        expect.stringContaining('## Proposed Fix'),
      );
      expect(callAIForContribution).toHaveBeenCalledWith(
        dev,
        config,
        expect.stringContaining('## Execution Plan'),
      );
      expect(callAIForContribution).toHaveBeenCalledWith(
        dev,
        config,
        expect.stringContaining('## Verification'),
      );
      expect(callAIForContribution).toHaveBeenCalledWith(
        dev,
        config,
        expect.stringContaining('## Done Criteria'),
      );
      expect(result).toBe('## Context\nProblem: ...\n\n## Proposed Fix\n...');
    });

    it('includes trigger context in the prompt', async () => {
      const dev = buildPersona();
      const trigger = {
        type: 'code_watch' as const,
        projectPath: '/projects/test',
        ref: 'ref-456',
        context: 'Signal: SQL injection\nLocation: src/db.ts\nCode: SELECT * FROM...',
      };

      vi.mocked(callAIForContribution).mockResolvedValue('Issue body here');

      await board.generateIssueBody(trigger, dev);

      expect(callAIForContribution).toHaveBeenCalledWith(
        dev,
        config,
        expect.stringContaining(
          'Signal: SQL injection\nLocation: src/db.ts\nCode: SELECT * FROM...',
        ),
      );
    });

    it('trims the AI response', async () => {
      const dev = buildPersona();
      const trigger = {
        type: 'code_watch' as const,
        projectPath: '/projects/test',
        ref: 'ref-789',
        context: 'Some context',
      };

      vi.mocked(callAIForContribution).mockResolvedValue('  ## Issue\n\n  Body here  \n  ');

      const result = await board.generateIssueBody(trigger, dev);

      expect(result).toBe('## Issue\n\n  Body here');
    });

    it('passes through persona details correctly', async () => {
      const dev = buildPersona({ name: 'Alice', role: 'security engineer' });
      const trigger = {
        type: 'code_watch' as const,
        projectPath: '/projects/test',
        ref: 'ref-abc',
        context: 'Context',
      };

      vi.mocked(callAIForContribution).mockResolvedValue('Issue body');

      await board.generateIssueBody(trigger, dev);

      expect(callAIForContribution).toHaveBeenCalledWith(
        dev,
        config,
        expect.stringContaining('You are Alice, security engineer'),
      );
    });
  });

  // --- analyzeCodeCandidate --------------------------------------------

  describe('analyzeCodeCandidate', () => {
    it('returns null when no dev persona is found', async () => {
      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(null);

      const result = await board.analyzeCodeCandidate('code here', 'missing token', 'src/auth.ts');

      expect(result).toBeNull();
    });

    it('returns null when AI returns SKIP', async () => {
      const dev = buildPersona();
      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution).mockResolvedValue('SKIP');

      const result = await board.analyzeCodeCandidate('code here', 'unused var', 'src/index.ts');

      expect(result).toBeNull();
    });

    it('returns null when AI returns empty string', async () => {
      const dev = buildPersona();
      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution).mockResolvedValue('');

      const result = await board.analyzeCodeCandidate('code', 'signal', 'file.ts');

      expect(result).toBeNull();
    });

    it('returns null when AI call throws', async () => {
      const dev = buildPersona();
      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution).mockRejectedValue(new Error('network error'));

      const result = await board.analyzeCodeCandidate('code', 'signal', 'file.ts');

      expect(result).toBeNull();
    });

    it('returns humanized text when AI returns a valid non-SKIP message', async () => {
      const dev = buildPersona();
      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution).mockResolvedValue(
        'There is a potential SQL injection here.',
      );
      vi.mocked(humanizeSlackReply).mockReturnValue('Humanized: potential SQL injection here.');

      const result = await board.analyzeCodeCandidate(
        'const q = `SELECT * WHERE id=${id}`',
        'sql injection',
        'src/db.ts',
      );

      expect(result).toBe('Humanized: potential SQL injection here.');
      expect(humanizeSlackReply).toHaveBeenCalledWith('There is a potential SQL injection here.', {
        allowEmoji: false,
        maxSentences: 2,
      });
    });

    it('includes file context, signal summary, and location in AI prompt', async () => {
      const dev = buildPersona();
      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution).mockResolvedValue('Real concern found');

      await board.analyzeCodeCandidate('const x = 42', 'hardcoded value', 'src/config.ts');

      expect(callAIForContribution).toHaveBeenCalledWith(
        dev,
        config,
        expect.stringContaining('Signal: hardcoded value'),
      );
      expect(callAIForContribution).toHaveBeenCalledWith(
        dev,
        config,
        expect.stringContaining('Location: src/config.ts'),
      );
      expect(callAIForContribution).toHaveBeenCalledWith(
        dev,
        config,
        expect.stringContaining('const x = 42'),
      );
    });

    it('truncates file context to 3000 chars', async () => {
      const dev = buildPersona();
      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution).mockResolvedValue('Concern');

      const longCode = 'a'.repeat(5000);
      await board.analyzeCodeCandidate(longCode, 'signal', 'file.ts');

      expect(callAIForContribution).toHaveBeenCalledWith(
        dev,
        config,
        expect.stringContaining('a'.repeat(3000)),
      );
      expect(callAIForContribution).not.toHaveBeenCalledWith(
        dev,
        config,
        expect.stringContaining('a'.repeat(4000)),
      );
    });

    it('uses skip message rules in prompt', async () => {
      const dev = buildPersona();
      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution).mockResolvedValue('SKIP');

      await board.analyzeCodeCandidate('test code', 'signal', 'test.ts');

      expect(callAIForContribution).toHaveBeenCalledWith(
        dev,
        config,
        expect.stringContaining('respond with exactly: SKIP'),
      );
    });
  });

  // --- handleAuditReport -----------------------------------------------

  describe('handleAuditReport', () => {
    it('does nothing when report is empty', async () => {
      await board.handleAuditReport('', 'my-project', '/projects/my-project', 'C01');

      expect(callAIForContribution).not.toHaveBeenCalled();
    });

    it('does nothing when report is NO_ISSUES_FOUND', async () => {
      await board.handleAuditReport('NO_ISSUES_FOUND', 'my-project', '/projects/my-project', 'C01');

      expect(callAIForContribution).not.toHaveBeenCalled();
    });

    it('does nothing when dev persona is not found', async () => {
      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(null);

      await board.handleAuditReport('Found critical XSS vulnerability.', 'my-project', '/p', 'C01');

      expect(callAIForContribution).not.toHaveBeenCalled();
    });

    it('does nothing when AI triage returns SKIP', async () => {
      const dev = buildPersona();
      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution).mockResolvedValue('SKIP');

      await board.handleAuditReport('Minor lint warnings.', 'proj', '/proj', 'C01');

      expect(slackClient.postAsAgent).not.toHaveBeenCalled();
    });

    it('does nothing when AI triage does not start with FILE:', async () => {
      const dev = buildPersona();
      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution).mockResolvedValue('This is fine.');

      await board.handleAuditReport('Some report content.', 'proj', '/proj', 'C01');

      expect(slackClient.postAsAgent).not.toHaveBeenCalled();
    });

    it('does nothing when triage AI call fails', async () => {
      const dev = buildPersona();
      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution).mockRejectedValue(new Error('AI error'));

      await board.handleAuditReport('Critical issues found.', 'proj', '/proj', 'C01');

      expect(slackClient.postAsAgent).not.toHaveBeenCalled();
    });

    it('posts to Slack when triage returns FILE: and no board is configured', async () => {
      const dev = buildPersona();
      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(dev);
      // First call: triage -> FILE; second call: issue body generation
      vi.mocked(callAIForContribution)
        .mockResolvedValueOnce('FILE: found unhandled error in auth flow')
        .mockResolvedValueOnce('## Issue body\nDetails here.');
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: undefined,
      } as unknown as INightWatchConfig);

      await board.handleAuditReport('Critical auth error not handled.', 'proj', '/proj', 'C01');

      expect(slackClient.postAsAgent).toHaveBeenCalledOnce();
      const call = vi.mocked(slackClient.postAsAgent).mock.calls[0];
      expect(call[0]).toBe('C01');
      expect(call[1]).toContain('unhandled error in auth flow');
      expect(call[2]).toBe(dev);
    });

    it('creates GitHub issue when board is configured and triage approves', async () => {
      const dev = buildPersona();
      const boardConfig = { enabled: true, projectNumber: 5 } as unknown as IBoardProviderConfig;
      const mockProvider = {
        createIssue: vi.fn().mockResolvedValue({
          number: 42,
          title: 'fix: unhandled error in auth flow',
          url: 'https://github.com/org/repo/issues/42',
          column: 'Draft',
        }),
      };

      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution)
        .mockResolvedValueOnce('FILE: found unhandled error in auth flow')
        .mockResolvedValueOnce('fix: unhandled error in auth flow') // title generation
        .mockResolvedValueOnce('## Issue body');
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: boardConfig,
      } as unknown as INightWatchConfig);
      vi.mocked(createBoardProvider).mockReturnValue(
        mockProvider as unknown as ReturnType<typeof createBoardProvider>,
      );

      await board.handleAuditReport('Critical auth error not handled.', 'proj', '/proj', 'C01');

      expect(mockProvider.createIssue).toHaveBeenCalledWith({
        title: expect.stringContaining('unhandled error in auth flow'),
        body: '## Issue body',
        column: 'Draft',
      });
      expect(slackClient.postAsAgent).toHaveBeenCalledOnce();
      const call = vi.mocked(slackClient.postAsAgent).mock.calls[0];
      expect(call[1]).toContain('https://github.com/org/repo/issues/42');
    });

    it('generates proper issue title from audit triage output using LLM', async () => {
      const dev = buildPersona();
      const boardConfig = { enabled: true, projectNumber: 5 } as unknown as IBoardProviderConfig;
      const mockProvider = {
        createIssue: vi.fn().mockResolvedValue({
          number: 42,
          url: 'https://github.com/org/repo/issues/42',
          column: 'Draft',
        }),
      };

      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution)
        .mockResolvedValueOnce('FILE: Found hardcoded credentials in config file.')
        .mockResolvedValueOnce('remove hardcoded credentials from config file') // LLM title
        .mockResolvedValueOnce('## Issue body');
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: boardConfig,
      } as unknown as INightWatchConfig);
      vi.mocked(createBoardProvider).mockReturnValue(
        mockProvider as unknown as ReturnType<typeof createBoardProvider>,
      );

      await board.handleAuditReport('Issues found.', 'proj', '/proj', 'C01');

      expect(mockProvider.createIssue).toHaveBeenCalledWith({
        title: 'fix: remove hardcoded credentials from config file',
        body: '## Issue body',
        column: 'Draft',
      });
    });

    it('LLM title generation prompt contains the triage one-liner', async () => {
      const dev = buildPersona();
      const boardConfig = { enabled: true, projectNumber: 5 } as unknown as IBoardProviderConfig;
      const mockProvider = {
        createIssue: vi.fn().mockResolvedValue({
          number: 42,
          url: 'https://github.com/org/repo/issues/42',
          column: 'Draft',
        }),
      };

      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution)
        .mockResolvedValueOnce('FILE: Flagging potential memory leak in cache.')
        .mockResolvedValueOnce('fix memory leak in cache layer') // LLM title
        .mockResolvedValueOnce('## Issue body');
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: boardConfig,
      } as unknown as INightWatchConfig);
      vi.mocked(createBoardProvider).mockReturnValue(
        mockProvider as unknown as ReturnType<typeof createBoardProvider>,
      );

      await board.handleAuditReport('Issues found.', 'proj', '/proj', 'C01');

      // Second callAIForContribution call is the title prompt
      const titlePromptCall = vi.mocked(callAIForContribution).mock.calls[1];
      expect(titlePromptCall[2]).toContain('Flagging potential memory leak in cache.');
      expect(titlePromptCall[2]).toContain('imperative-mood');
      expect(mockProvider.createIssue).toHaveBeenCalledWith({
        title: 'fix: fix memory leak in cache layer',
        body: '## Issue body',
        column: 'Draft',
      });
    });

    it('truncates issue title to 85 chars (including "fix: " prefix)', async () => {
      const dev = buildPersona();
      const boardConfig = { enabled: true, projectNumber: 5 } as unknown as IBoardProviderConfig;
      const mockProvider = {
        createIssue: vi.fn().mockResolvedValue({
          number: 42,
          url: 'https://github.com/org/repo/issues/42',
          column: 'Draft',
        }),
      };

      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(dev);
      const longSentence = 'a'.repeat(100);
      vi.mocked(callAIForContribution)
        .mockResolvedValueOnce(`FILE: ${longSentence}`)
        .mockResolvedValueOnce(longSentence) // LLM returns a long title
        .mockResolvedValueOnce('## Issue body');
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: boardConfig,
      } as unknown as INightWatchConfig);
      vi.mocked(createBoardProvider).mockReturnValue(
        mockProvider as unknown as ReturnType<typeof createBoardProvider>,
      );

      await board.handleAuditReport('Issues found.', 'proj', '/proj', 'C01');

      const titleArg = mockProvider.createIssue.mock.calls[0][0].title;
      // Title is "fix: " + up to 80 chars of the LLM-generated title = max 85 chars
      expect(titleArg.length).toBeLessThanOrEqual(85);
      expect(titleArg).toMatch(/^fix: /);
      // The content part after "fix: " should be max 80 chars
      expect(titleArg.slice(5).length).toBeLessThanOrEqual(80);
    });

    it('falls back to raw report when issue body generation fails', async () => {
      const dev = buildPersona();
      const boardConfig = { enabled: true, projectNumber: 5 } as unknown as IBoardProviderConfig;
      const mockProvider = {
        createIssue: vi.fn().mockResolvedValue({
          number: 42,
          url: 'https://github.com/org/repo/issues/42',
          column: 'Draft',
        }),
      };

      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution)
        .mockResolvedValueOnce('FILE: issue found')
        .mockResolvedValueOnce('fix issue in auth handler') // LLM title
        .mockRejectedValueOnce(new Error('Body generation failed'));
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: boardConfig,
      } as unknown as INightWatchConfig);
      vi.mocked(createBoardProvider).mockReturnValue(
        mockProvider as unknown as ReturnType<typeof createBoardProvider>,
      );

      await board.handleAuditReport(
        'Detailed audit report with findings here.',
        'proj',
        '/proj',
        'C01',
      );

      expect(mockProvider.createIssue).toHaveBeenCalledWith({
        title: expect.any(String),
        body: 'Detailed audit report with findings here.',
        column: 'Draft',
      });
    });

    it('handles board createIssue failure gracefully', async () => {
      const dev = buildPersona();
      const boardConfig = { enabled: true, projectNumber: 5 } as unknown as IBoardProviderConfig;
      const mockProvider = {
        createIssue: vi.fn().mockRejectedValue(new Error('GitHub API error')),
      };

      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution)
        .mockResolvedValueOnce('FILE: issue found')
        .mockResolvedValueOnce('fix issue in handler') // LLM title
        .mockResolvedValueOnce('## Issue body');
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: boardConfig,
      } as unknown as INightWatchConfig);
      vi.mocked(createBoardProvider).mockReturnValue(
        mockProvider as unknown as ReturnType<typeof createBoardProvider>,
      );
      vi.mocked(humanizeSlackReply).mockImplementation((text) => text);

      await board.handleAuditReport('Audit findings.', 'proj', '/proj', 'C01');

      expect(mockProvider.createIssue).toHaveBeenCalled();
      expect(slackClient.postAsAgent).toHaveBeenCalledOnce();
      const call = vi.mocked(slackClient.postAsAgent).mock.calls[0];
      expect(call[1]).toContain('issue found');
      expect(call[1]).not.toContain('http');
    });

    it('posts humanized message when board config exists but issue creation fails', async () => {
      const dev = buildPersona();
      const boardConfig = { enabled: true, projectNumber: 5 } as unknown as IBoardProviderConfig;
      const mockProvider = {
        createIssue: vi.fn().mockRejectedValue(new Error('Board error')),
      };

      vi.mocked(getRepositories).mockReturnValue(
        buildRepos() as unknown as ReturnType<typeof getRepositories>,
      );
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution)
        .mockResolvedValueOnce('FILE: Found security vulnerability')
        .mockResolvedValueOnce('fix security vulnerability in auth') // LLM title
        .mockResolvedValueOnce('## Issue body');
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: boardConfig,
      } as unknown as INightWatchConfig);
      vi.mocked(createBoardProvider).mockReturnValue(
        mockProvider as unknown as ReturnType<typeof createBoardProvider>,
      );
      vi.mocked(humanizeSlackReply).mockReturnValue('Found security vulnerability');

      await board.handleAuditReport('Audit findings.', 'proj', '/proj', 'C01');

      expect(humanizeSlackReply).toHaveBeenCalledWith('Found security vulnerability', {
        allowEmoji: false,
        maxSentences: 2,
      });
    });
  });

  // --- triggerIssueOpener ----------------------------------------------

  describe('triggerIssueOpener', () => {
    it('does nothing when discussion is not found', async () => {
      vi.mocked(getRepositories).mockReturnValue({
        ...buildRepos(),
        slackDiscussion: { getById: vi.fn().mockReturnValue(null) },
        agentPersona: { getActive: vi.fn().mockReturnValue([buildPersona()]) },
      } as unknown as ReturnType<typeof getRepositories>);

      await board.triggerIssueOpener('disc-missing', {
        type: 'code_watch',
        projectPath: '/projects/my-project',
        ref: 'ref-abc',
        context: 'Signal: unused export\nLocation: src/foo.ts',
      });

      expect(slackClient.postAsAgent).not.toHaveBeenCalled();
    });

    it('does nothing when no dev persona is found', async () => {
      vi.mocked(getRepositories).mockReturnValue({
        ...buildRepos(),
        slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
        agentPersona: { getActive: vi.fn().mockReturnValue([]) },
      } as unknown as ReturnType<typeof getRepositories>);
      vi.mocked(findDev).mockReturnValue(null);

      await board.triggerIssueOpener('disc-1', {
        type: 'code_watch',
        projectPath: '/projects/my-project',
        ref: 'ref-abc',
        context: 'Signal: unused export\nLocation: src/foo.ts',
      });

      expect(slackClient.postAsAgent).not.toHaveBeenCalled();
    });

    it('posts "writing up an issue" message when discussion and dev persona exist', async () => {
      const dev = buildPersona();
      vi.mocked(getRepositories).mockReturnValue({
        ...buildRepos(),
        slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
        agentPersona: { getActive: vi.fn().mockReturnValue([dev]) },
      } as unknown as ReturnType<typeof getRepositories>);
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution).mockResolvedValue('## Generated issue body.');
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: undefined,
      } as unknown as INightWatchConfig);

      await board.triggerIssueOpener('disc-1', {
        type: 'code_watch',
        projectPath: '/projects/my-project',
        ref: 'ref-abc',
        context: 'Signal: unused export\nLocation: src/foo.ts',
      });

      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'C01',
        'Agreed. Writing up an issue for this.',
        dev,
        '100.000',
      );
    });

    it('creates board issue when board config is present', async () => {
      const dev = buildPersona();
      const boardConfig = { enabled: true, projectNumber: 5 } as unknown as IBoardProviderConfig;
      const mockProvider = {
        createIssue: vi.fn().mockResolvedValue({
          number: 42,
          title: 'fix: unused export',
          url: 'https://github.com/org/repo/issues/42',
          column: 'Draft',
        }),
        moveIssue: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(getRepositories).mockReturnValue({
        ...buildRepos(),
        slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
        agentPersona: { getActive: vi.fn().mockReturnValue([dev]) },
      } as unknown as ReturnType<typeof getRepositories>);
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution).mockResolvedValue('## Generated issue body.');
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: boardConfig,
      } as unknown as INightWatchConfig);
      vi.mocked(createBoardProvider).mockReturnValue(
        mockProvider as unknown as ReturnType<typeof createBoardProvider>,
      );

      await board.triggerIssueOpener('disc-1', {
        type: 'code_watch',
        projectPath: '/projects/my-project',
        ref: 'ref-abc',
        context: 'Signal: unused export\nLocation: src/foo.ts',
      });

      expect(mockProvider.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({ column: 'Draft' }),
      );
      const calls = vi.mocked(slackClient.postAsAgent).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[1]).toContain('Opened #42');
      expect(lastCall[1]).toContain('Draft');
    });

    it('moves issue to Draft when createIssue returns different column', async () => {
      const dev = buildPersona();
      const boardConfig = { enabled: true, projectNumber: 5 } as unknown as IBoardProviderConfig;
      const mockProvider = {
        createIssue: vi.fn().mockResolvedValue({
          number: 42,
          title: 'fix: something',
          url: 'https://github.com/org/repo/issues/42',
          column: 'Ready',
        }),
        moveIssue: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(getRepositories).mockReturnValue({
        ...buildRepos(),
        slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
        agentPersona: { getActive: vi.fn().mockReturnValue([dev]) },
      } as unknown as ReturnType<typeof getRepositories>);
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution).mockResolvedValue('## Issue body.');
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: boardConfig,
      } as unknown as INightWatchConfig);
      vi.mocked(createBoardProvider).mockReturnValue(
        mockProvider as unknown as ReturnType<typeof createBoardProvider>,
      );

      await board.triggerIssueOpener('disc-1', {
        type: 'code_watch',
        projectPath: '/projects/my-project',
        ref: 'ref-abc',
        context: 'Signal: something\nLocation: src/file.ts',
      });

      expect(mockProvider.moveIssue).toHaveBeenCalledWith(42, 'Draft');
    });

    it('handles board createIssue failure gracefully by posting truncated body', async () => {
      const dev = buildPersona();
      const boardConfig = { enabled: true, projectNumber: 5 } as unknown as IBoardProviderConfig;
      const mockProvider = {
        createIssue: vi.fn().mockRejectedValue(new Error('Board error')),
      };

      vi.mocked(getRepositories).mockReturnValue({
        ...buildRepos(),
        slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
        agentPersona: { getActive: vi.fn().mockReturnValue([dev]) },
      } as unknown as ReturnType<typeof getRepositories>);
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution).mockResolvedValue(
        '## Context\n...\n\n## Full issue body that should be truncated\n' + 'x'.repeat(1300),
      );
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: boardConfig,
      } as unknown as INightWatchConfig);
      vi.mocked(createBoardProvider).mockReturnValue(
        mockProvider as unknown as ReturnType<typeof createBoardProvider>,
      );

      await board.triggerIssueOpener('disc-1', {
        type: 'code_watch',
        projectPath: '/projects/my-project',
        ref: 'ref-abc',
        context: 'Signal: issue\nLocation: src/file.ts',
      });

      const calls = vi.mocked(slackClient.postAsAgent).mock.calls;
      const errorCall = calls.find((c) => c[1]?.includes('configured'));
      expect(errorCall).toBeDefined();
      expect(errorCall![1]).toContain("Here's the writeup:");
      // The body part should be truncated - the original is 1300+ chars but we should only see 1200
      const bodyPart = errorCall![1].split("Here's the writeup:\n\n")[1];
      // Verify truncation: body part should be max 1200 chars (implementation uses body.slice(0, 1200))
      expect(bodyPart.length).toBeLessThanOrEqual(1200);
      // And importantly, it shouldn't contain all 1300 'x' characters from the original body
      expect(bodyPart).not.toContain('x'.repeat(1200)); // if it had all 1300, it would have 1200+ in a row
    });

    it('posts writeup when no board is configured', async () => {
      const dev = buildPersona();
      vi.mocked(getRepositories).mockReturnValue({
        ...buildRepos(),
        slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
        agentPersona: { getActive: vi.fn().mockReturnValue([dev]) },
      } as unknown as ReturnType<typeof getRepositories>);
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution).mockResolvedValue('## Issue body here.');
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: undefined,
      } as unknown as INightWatchConfig);

      await board.triggerIssueOpener('disc-1', {
        type: 'code_watch',
        projectPath: '/projects/my-project',
        ref: 'ref-abc',
        context: 'Signal: issue\nLocation: src/file.ts',
      });

      const calls = vi.mocked(slackClient.postAsAgent).mock.calls;
      const bodyCall = calls.find((c) => c[1]?.includes('No board configured'));
      expect(bodyCall).toBeDefined();
      expect(bodyCall![1]).toContain('## Issue body here.');
    });

    it('should use longer body preview (1200 chars) when no board configured', async () => {
      const dev = buildPersona();
      vi.mocked(getRepositories).mockReturnValue({
        ...buildRepos(),
        slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
        agentPersona: { getActive: vi.fn().mockReturnValue([dev]) },
      } as unknown as ReturnType<typeof getRepositories>);
      vi.mocked(findDev).mockReturnValue(dev);
      // AI generates a body longer than 1200 chars
      const longBody = 'x'.repeat(1500);
      vi.mocked(callAIForContribution).mockResolvedValue(longBody);
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: undefined,
      } as unknown as INightWatchConfig);

      await board.triggerIssueOpener('disc-1', {
        type: 'code_watch',
        projectPath: '/projects/my-project',
        ref: 'ref-abc',
        context: 'Signal: issue\nLocation: src/file.ts',
      });

      const calls = vi.mocked(slackClient.postAsAgent).mock.calls;
      const bodyCall = calls.find((c) => c[1]?.includes('No board configured'));
      expect(bodyCall).toBeDefined();
      const bodyPart = bodyCall![1].split('here:\n\n')[1];
      // Should contain up to 1200 chars, not more
      expect(bodyPart.length).toBeLessThanOrEqual(1200);
      // Should not contain 1500 x's (confirms truncation at 1200)
      expect(bodyPart).not.toContain('x'.repeat(1201));
    });

    it('uses buildIssueTitleFromTrigger for issue title', async () => {
      const dev = buildPersona();
      const boardConfig = { enabled: true, projectNumber: 5 } as unknown as IBoardProviderConfig;
      const mockProvider = {
        createIssue: vi.fn().mockResolvedValue({
          number: 42,
          url: 'https://github.com/org/repo/issues/42',
          column: 'Draft',
        }),
      };

      vi.mocked(getRepositories).mockReturnValue({
        ...buildRepos(),
        slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
        agentPersona: { getActive: vi.fn().mockReturnValue([dev]) },
      } as unknown as ReturnType<typeof getRepositories>);
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution).mockResolvedValue('## Body');
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: boardConfig,
      } as unknown as INightWatchConfig);
      vi.mocked(createBoardProvider).mockReturnValue(
        mockProvider as unknown as ReturnType<typeof createBoardProvider>,
      );

      const { buildIssueTitleFromTrigger } = await import('../../deliberation-builders.js');
      vi.mocked(buildIssueTitleFromTrigger).mockReturnValue('fix: custom title from trigger');

      await board.triggerIssueOpener('disc-1', {
        type: 'code_watch',
        projectPath: '/projects/my-project',
        ref: 'ref-abc',
        context: 'Signal: issue\nLocation: src/file.ts',
      });

      expect(mockProvider.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'fix: custom title from trigger' }),
      );
    });

    it('ignores moveIssue errors when initial column is wrong', async () => {
      const dev = buildPersona();
      const boardConfig = { enabled: true, projectNumber: 5 } as unknown as IBoardProviderConfig;
      const mockProvider = {
        createIssue: vi.fn().mockResolvedValue({
          number: 42,
          url: 'https://github.com/org/repo/issues/42',
          column: 'Ready',
        }),
        moveIssue: vi.fn().mockRejectedValue(new Error('Move failed')),
      };

      vi.mocked(getRepositories).mockReturnValue({
        ...buildRepos(),
        slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
        agentPersona: { getActive: vi.fn().mockReturnValue([dev]) },
      } as unknown as ReturnType<typeof getRepositories>);
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(callAIForContribution).mockResolvedValue('## Body');
      vi.mocked(loadConfig).mockReturnValue({
        boardProvider: boardConfig,
      } as unknown as INightWatchConfig);
      vi.mocked(createBoardProvider).mockReturnValue(
        mockProvider as unknown as ReturnType<typeof createBoardProvider>,
      );

      await board.triggerIssueOpener('disc-1', {
        type: 'code_watch',
        projectPath: '/projects/my-project',
        ref: 'ref-abc',
        context: 'Signal: issue\nLocation: src/file.ts',
      });

      expect(mockProvider.moveIssue).toHaveBeenCalled();
      expect(slackClient.postAsAgent).toHaveBeenCalled();
    });
  });

  // --- triggerIssueStatusUpdate ----------------------------------------

  describe('triggerIssueStatusUpdate', () => {
    it('does nothing when discussion is not found', async () => {
      vi.mocked(getRepositories).mockReturnValue({
        ...buildRepos(),
        slackDiscussion: { getById: vi.fn().mockReturnValue(null) },
        agentPersona: { getActive: vi.fn().mockReturnValue([buildPersona()]) },
      } as unknown as ReturnType<typeof getRepositories>);

      await board.triggerIssueStatusUpdate('ready', 'disc-missing', {
        type: 'issue_review',
        projectPath: '/projects/my-project',
        ref: 'org/repo#123',
        context: '',
      });

      expect(slackClient.postAsAgent).not.toHaveBeenCalled();
    });

    it('does nothing when no executor persona is found', async () => {
      vi.mocked(getRepositories).mockReturnValue({
        ...buildRepos(),
        slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
        agentPersona: { getActive: vi.fn().mockReturnValue([]) },
      } as unknown as ReturnType<typeof getRepositories>);
      vi.mocked(findDev).mockReturnValue(null);
      vi.mocked(findCarlos).mockReturnValue(null);

      await board.triggerIssueStatusUpdate('ready', 'disc-1', {
        type: 'issue_review',
        projectPath: '/projects/my-project',
        ref: 'org/repo#123',
        context: '',
      });

      expect(slackClient.postAsAgent).not.toHaveBeenCalled();
    });

    it('logs a warning and does nothing when trigger.ref format is unexpected', async () => {
      const dev = buildPersona();
      vi.mocked(getRepositories).mockReturnValue({
        ...buildRepos(),
        slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
        agentPersona: { getActive: vi.fn().mockReturnValue([dev]) },
      } as unknown as ReturnType<typeof getRepositories>);
      vi.mocked(findDev).mockReturnValue(dev);
      vi.mocked(findCarlos).mockReturnValue(null);

      await board.triggerIssueStatusUpdate('ready', 'disc-1', {
        type: 'issue_review',
        projectPath: '/projects/my-project',
        ref: 'bad-ref-format',
        context: '',
      });

      expect(slackClient.postAsAgent).not.toHaveBeenCalled();
    });

    describe('verdict === "ready"', () => {
      it('moves issue to Ready using board provider when config exists', async () => {
        const dev = buildPersona();
        const boardConfig = { enabled: true, projectNumber: 5 } as unknown as IBoardProviderConfig;
        const mockProvider = {
          moveIssue: vi.fn().mockResolvedValue(undefined),
        };

        vi.mocked(getRepositories).mockReturnValue({
          ...buildRepos(),
          slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
          agentPersona: { getActive: vi.fn().mockReturnValue([dev]) },
        } as unknown as ReturnType<typeof getRepositories>);
        vi.mocked(findDev).mockReturnValue(dev);
        vi.mocked(loadConfig).mockReturnValue({
          boardProvider: boardConfig,
        } as unknown as INightWatchConfig);
        vi.mocked(createBoardProvider).mockReturnValue(
          mockProvider as unknown as ReturnType<typeof createBoardProvider>,
        );

        await board.triggerIssueStatusUpdate('ready', 'disc-1', {
          type: 'issue_review',
          projectPath: '/projects/my-project',
          ref: 'org/repo#123',
          context: '',
        });

        expect(mockProvider.moveIssue).toHaveBeenCalledWith(123, 'Ready');
        expect(slackClient.postAsAgent).toHaveBeenCalledWith(
          'C01',
          'Moved #123 to Ready.',
          dev,
          '100.000',
        );
      });

      it('falls back to CLI when board provider moveIssue fails', async () => {
        const dev = buildPersona();
        const boardConfig = { enabled: true, projectNumber: 5 } as unknown as IBoardProviderConfig;
        const mockProvider = {
          moveIssue: vi.fn().mockRejectedValue(new Error('Board API failed')),
        };
        const cliArgs = ['/path/to/cli', 'board', 'move-issue', '123', '--column', 'Ready'];

        vi.mocked(getRepositories).mockReturnValue({
          ...buildRepos(),
          slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
          agentPersona: { getActive: vi.fn().mockReturnValue([dev]) },
        } as unknown as ReturnType<typeof getRepositories>);
        vi.mocked(findDev).mockReturnValue(dev);
        vi.mocked(loadConfig).mockReturnValue({
          boardProvider: boardConfig,
        } as unknown as INightWatchConfig);
        vi.mocked(createBoardProvider).mockReturnValue(
          mockProvider as unknown as ReturnType<typeof createBoardProvider>,
        );
        const { buildCurrentCliInvocation } = await import('../../utils.js');
        vi.mocked(buildCurrentCliInvocation).mockReturnValue(cliArgs);
        vi.mocked(execFileSync).mockReturnValue(Buffer.from('Success'));

        await board.triggerIssueStatusUpdate('ready', 'disc-1', {
          type: 'issue_review',
          projectPath: '/projects/my-project',
          ref: 'org/repo#456',
          context: '',
        });

        expect(buildCurrentCliInvocation).toHaveBeenCalledWith([
          'board',
          'move-issue',
          '456',
          '--column',
          'Ready',
        ]);
        expect(execFileSync).toHaveBeenCalledWith(process.execPath, cliArgs, {
          cwd: '/projects/my-project',
          timeout: 15_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        expect(slackClient.postAsAgent).toHaveBeenCalledWith(
          'C01',
          'Moved #456 to Ready.',
          dev,
          '100.000',
        );
      });

      it('uses CLI fallback when no board config exists', async () => {
        const dev = buildPersona();
        const cliArgs = ['/path/to/cli', 'board', 'move-issue', '789', '--column', 'Ready'];

        vi.mocked(getRepositories).mockReturnValue({
          ...buildRepos(),
          slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
          agentPersona: { getActive: vi.fn().mockReturnValue([dev]) },
        } as unknown as ReturnType<typeof getRepositories>);
        vi.mocked(findDev).mockReturnValue(dev);
        vi.mocked(loadConfig).mockReturnValue({
          boardProvider: undefined,
        } as unknown as INightWatchConfig);
        const { buildCurrentCliInvocation } = await import('../../utils.js');
        vi.mocked(buildCurrentCliInvocation).mockReturnValue(cliArgs);
        vi.mocked(execFileSync).mockReturnValue(Buffer.from('Success'));

        await board.triggerIssueStatusUpdate('ready', 'disc-1', {
          type: 'issue_review',
          projectPath: '/projects/my-project',
          ref: 'owner/repo#789',
          context: '',
        });

        expect(execFileSync).toHaveBeenCalledWith(process.execPath, cliArgs, expect.any(Object));
        expect(slackClient.postAsAgent).toHaveBeenCalledWith(
          'C01',
          'Moved #789 to Ready.',
          dev,
          '100.000',
        );
      });

      it('does nothing when buildCurrentCliInvocation returns null', async () => {
        const dev = buildPersona();
        const boardConfig = { enabled: true, projectNumber: 5 } as unknown as IBoardProviderConfig;
        const mockProvider = {
          moveIssue: vi.fn().mockRejectedValue(new Error('Board failed')),
        };

        vi.mocked(getRepositories).mockReturnValue({
          ...buildRepos(),
          slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
          agentPersona: { getActive: vi.fn().mockReturnValue([dev]) },
        } as unknown as ReturnType<typeof getRepositories>);
        vi.mocked(findDev).mockReturnValue(dev);
        vi.mocked(loadConfig).mockReturnValue({
          boardProvider: boardConfig,
        } as unknown as INightWatchConfig);
        vi.mocked(createBoardProvider).mockReturnValue(
          mockProvider as unknown as ReturnType<typeof createBoardProvider>,
        );
        const { buildCurrentCliInvocation } = await import('../../utils.js');
        vi.mocked(buildCurrentCliInvocation).mockReturnValue(null);

        await board.triggerIssueStatusUpdate('ready', 'disc-1', {
          type: 'issue_review',
          projectPath: '/projects/my-project',
          ref: 'org/repo#999',
          context: '',
        });

        expect(execFileSync).not.toHaveBeenCalled();
        expect(slackClient.postAsAgent).not.toHaveBeenCalledWith(
          'C01',
          expect.stringContaining('Moved'),
          dev,
          '100.000',
        );
      });

      it('handles CLI fallback failure gracefully', async () => {
        const dev = buildPersona();
        const cliArgs = ['/path/to/cli', 'board', 'move-issue', '111', '--column', 'Ready'];

        vi.mocked(getRepositories).mockReturnValue({
          ...buildRepos(),
          slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
          agentPersona: { getActive: vi.fn().mockReturnValue([dev]) },
        } as unknown as ReturnType<typeof getRepositories>);
        vi.mocked(findDev).mockReturnValue(dev);
        vi.mocked(loadConfig).mockReturnValue({
          boardProvider: undefined,
        } as unknown as INightWatchConfig);
        const { buildCurrentCliInvocation } = await import('../../utils.js');
        vi.mocked(buildCurrentCliInvocation).mockReturnValue(cliArgs);
        vi.mocked(execFileSync).mockImplementation(() => {
          throw new Error('CLI failed');
        });

        await board.triggerIssueStatusUpdate('ready', 'disc-1', {
          type: 'issue_review',
          projectPath: '/projects/my-project',
          ref: 'org/repo#111',
          context: '',
        });

        expect(slackClient.postAsAgent).not.toHaveBeenCalledWith(
          'C01',
          expect.stringContaining('Moved'),
          dev,
          '100.000',
        );
      });

      it('falls back to Carlos when Dev is not available', async () => {
        const carlos = buildCarlosPersona();
        const cliArgs = ['/path/to/cli', 'board', 'move-issue', '222', '--column', 'Ready'];

        vi.mocked(getRepositories).mockReturnValue({
          ...buildRepos(),
          slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
          agentPersona: { getActive: vi.fn().mockReturnValue([carlos]) },
        } as unknown as ReturnType<typeof getRepositories>);
        vi.mocked(findDev).mockReturnValue(null);
        vi.mocked(findCarlos).mockReturnValue(carlos);
        vi.mocked(loadConfig).mockReturnValue({
          boardProvider: undefined,
        } as unknown as INightWatchConfig);
        const { buildCurrentCliInvocation } = await import('../../utils.js');
        vi.mocked(buildCurrentCliInvocation).mockReturnValue(cliArgs);
        vi.mocked(execFileSync).mockReturnValue(Buffer.from('Success'));

        await board.triggerIssueStatusUpdate('ready', 'disc-1', {
          type: 'issue_review',
          projectPath: '/projects/my-project',
          ref: 'org/repo#222',
          context: '',
        });

        expect(slackClient.postAsAgent).toHaveBeenCalledWith(
          'C01',
          'Moved #222 to Ready.',
          carlos,
          '100.000',
        );
      });

      it('falls back to first available persona when Dev and Carlos are not available', async () => {
        const otherPersona = buildPersona({ id: 'p-other', name: 'Maya', role: 'security' });
        const cliArgs = ['/path/to/cli', 'board', 'move-issue', '333', '--column', 'Ready'];

        vi.mocked(getRepositories).mockReturnValue({
          ...buildRepos(),
          slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
          agentPersona: { getActive: vi.fn().mockReturnValue([otherPersona]) },
        } as unknown as ReturnType<typeof getRepositories>);
        vi.mocked(findDev).mockReturnValue(null);
        vi.mocked(findCarlos).mockReturnValue(null);
        vi.mocked(loadConfig).mockReturnValue({
          boardProvider: undefined,
        } as unknown as INightWatchConfig);
        const { buildCurrentCliInvocation } = await import('../../utils.js');
        vi.mocked(buildCurrentCliInvocation).mockReturnValue(cliArgs);
        vi.mocked(execFileSync).mockReturnValue(Buffer.from('Success'));

        await board.triggerIssueStatusUpdate('ready', 'disc-1', {
          type: 'issue_review',
          projectPath: '/projects/my-project',
          ref: 'org/repo#333',
          context: '',
        });

        expect(slackClient.postAsAgent).toHaveBeenCalledWith(
          'C01',
          'Moved #333 to Ready.',
          otherPersona,
          '100.000',
        );
      });

      it('parses trigger.ref correctly with owner/repo#number format', async () => {
        const dev = buildPersona();
        const mockProvider = {
          moveIssue: vi.fn().mockResolvedValue(undefined),
        };

        vi.mocked(getRepositories).mockReturnValue({
          ...buildRepos(),
          slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
          agentPersona: { getActive: vi.fn().mockReturnValue([dev]) },
        } as unknown as ReturnType<typeof getRepositories>);
        vi.mocked(findDev).mockReturnValue(dev);
        vi.mocked(loadConfig).mockReturnValue({
          boardProvider: { enabled: true, projectNumber: 1 },
        } as unknown as INightWatchConfig);
        vi.mocked(createBoardProvider).mockReturnValue(
          mockProvider as unknown as ReturnType<typeof createBoardProvider>,
        );

        await board.triggerIssueStatusUpdate('ready', 'disc-1', {
          type: 'issue_review',
          projectPath: '/projects/my-project',
          ref: 'facebook/react#444',
          context: '',
        });

        expect(mockProvider.moveIssue).toHaveBeenCalledWith(444, 'Ready');
      });
    });

    describe('verdict === "close"', () => {
      it('closes issue using gh CLI', async () => {
        const dev = buildPersona();

        vi.mocked(getRepositories).mockReturnValue({
          ...buildRepos(),
          slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
          agentPersona: { getActive: vi.fn().mockReturnValue([dev]) },
        } as unknown as ReturnType<typeof getRepositories>);
        vi.mocked(findDev).mockReturnValue(dev);
        vi.mocked(execFileSync).mockReturnValue(Buffer.from('Closed'));

        await board.triggerIssueStatusUpdate('close', 'disc-1', {
          type: 'issue_review',
          projectPath: '/projects/my-project',
          ref: 'org/repo#555',
          context: '',
        });

        expect(execFileSync).toHaveBeenCalledWith(
          'gh',
          ['issue', 'close', '555', '-R', 'org/repo'],
          {
            cwd: '/projects/my-project',
            timeout: 15_000,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        expect(slackClient.postAsAgent).toHaveBeenCalledWith('C01', 'Closed #555.', dev, '100.000');
      });

      it('handles gh CLI failure gracefully', async () => {
        const dev = buildPersona();

        vi.mocked(getRepositories).mockReturnValue({
          ...buildRepos(),
          slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
          agentPersona: { getActive: vi.fn().mockReturnValue([dev]) },
        } as unknown as ReturnType<typeof getRepositories>);
        vi.mocked(findDev).mockReturnValue(dev);
        vi.mocked(execFileSync).mockImplementation(() => {
          throw new Error('gh not found');
        });

        await board.triggerIssueStatusUpdate('close', 'disc-1', {
          type: 'issue_review',
          projectPath: '/projects/my-project',
          ref: 'org/repo#666',
          context: '',
        });

        expect(slackClient.postAsAgent).not.toHaveBeenCalledWith(
          'C01',
          expect.stringContaining('Closed'),
          dev,
          '100.000',
        );
      });

      it('uses Carlos as executor when Dev is not available', async () => {
        const carlos = buildCarlosPersona();

        vi.mocked(getRepositories).mockReturnValue({
          ...buildRepos(),
          slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
          agentPersona: { getActive: vi.fn().mockReturnValue([carlos]) },
        } as unknown as ReturnType<typeof getRepositories>);
        vi.mocked(findDev).mockReturnValue(null);
        vi.mocked(findCarlos).mockReturnValue(carlos);
        vi.mocked(execFileSync).mockReturnValue(Buffer.from('Closed'));

        await board.triggerIssueStatusUpdate('close', 'disc-1', {
          type: 'issue_review',
          projectPath: '/projects/my-project',
          ref: 'org/repo#777',
          context: '',
        });

        expect(slackClient.postAsAgent).toHaveBeenCalledWith(
          'C01',
          'Closed #777.',
          carlos,
          '100.000',
        );
      });

      it('uses first available persona when Dev and Carlos are not available', async () => {
        const otherPersona = buildPersona({ id: 'p-priya', name: 'Priya', role: 'qa' });

        vi.mocked(getRepositories).mockReturnValue({
          ...buildRepos(),
          slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
          agentPersona: { getActive: vi.fn().mockReturnValue([otherPersona]) },
        } as unknown as ReturnType<typeof getRepositories>);
        vi.mocked(findDev).mockReturnValue(null);
        vi.mocked(findCarlos).mockReturnValue(null);
        vi.mocked(execFileSync).mockReturnValue(Buffer.from('Closed'));

        await board.triggerIssueStatusUpdate('close', 'disc-1', {
          type: 'issue_review',
          projectPath: '/projects/my-project',
          ref: 'org/repo#888',
          context: '',
        });

        expect(slackClient.postAsAgent).toHaveBeenCalledWith(
          'C01',
          'Closed #888.',
          otherPersona,
          '100.000',
        );
      });

      it('parses multi-segment repo names correctly', async () => {
        const dev = buildPersona();

        vi.mocked(getRepositories).mockReturnValue({
          ...buildRepos(),
          slackDiscussion: { getById: vi.fn().mockReturnValue(buildDiscussion()) },
          agentPersona: { getActive: vi.fn().mockReturnValue([dev]) },
        } as unknown as ReturnType<typeof getRepositories>);
        vi.mocked(findDev).mockReturnValue(dev);
        vi.mocked(execFileSync).mockReturnValue(Buffer.from('Closed'));

        await board.triggerIssueStatusUpdate('close', 'disc-1', {
          type: 'issue_review',
          projectPath: '/projects/my-project',
          ref: 'company-name/team-repo#999',
          context: '',
        });

        expect(execFileSync).toHaveBeenCalledWith(
          'gh',
          ['issue', 'close', '999', '-R', 'company-name/team-repo'],
          expect.any(Object),
        );
      });
    });
  });
});

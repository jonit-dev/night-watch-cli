import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IAgentPersona,
  IDiscussionTrigger,
  ISlackDiscussion,
} from '@night-watch/core/shared/types.js';
import type { INightWatchConfig } from '@night-watch/core/types.js';

const { mockLoadConfig, mockCreateBoardProvider, mockGetRepositories } = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
  mockCreateBoardProvider: vi.fn(),
  mockGetRepositories: vi.fn(),
}));

vi.mock('@night-watch/core/config.js', () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock('@night-watch/core/board/factory.js', () => ({
  createBoardProvider: mockCreateBoardProvider,
}));

vi.mock('@night-watch/core/storage/repositories/index.js', () => ({
  getRepositories: mockGetRepositories,
}));

import { DeliberationEngine } from '../../deliberation.js';

function buildDevPersona(): IAgentPersona {
  return {
    id: 'dev-1',
    name: 'Dev',
    role: 'Implementer',
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
      emojiUsage: {
        frequency: 'never',
        favorites: [],
        contextRules: '',
      },
      quickReactions: {},
      rhetoricalMoves: [],
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

function buildDiscussion(projectPath: string): ISlackDiscussion {
  return {
    id: 'disc-1',
    projectPath,
    triggerType: 'code_watch',
    triggerRef: 'signal-1',
    channelId: 'CENG',
    threadTs: '1700000000.0001',
    status: 'active',
    round: 1,
    participants: ['dev-1'],
    consensusResult: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function buildTrigger(projectPath: string): IDiscussionTrigger {
  return {
    type: 'code_watch',
    projectPath,
    ref: 'signal-1',
    context: 'Potential issue detected',
  };
}

describe('DeliberationEngine board routing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('uses the target project board config when opening issue from Slack trigger', async () => {
    const targetProjectPath = '/home/joao/projects/autopilotrank.com';

    const provider = {
      createIssue: vi.fn().mockResolvedValue({
        number: 52,
        title: 'Guard condition can throw in parser',
        url: 'https://github.com/jonit-dev/autopilotrank.com/issues/52',
        column: 'In Progress',
      }),
      moveIssue: vi.fn().mockResolvedValue(undefined),
    };
    mockCreateBoardProvider.mockReturnValue(provider);
    mockLoadConfig.mockReturnValue({
      boardProvider: { enabled: true, provider: 'github', projectNumber: 77 },
    });

    mockGetRepositories.mockReturnValue({
      slackDiscussion: {
        getById: vi.fn().mockReturnValue(buildDiscussion(targetProjectPath)),
      },
      agentPersona: {
        getActive: vi.fn().mockReturnValue([buildDevPersona()]),
      },
      projectRegistry: {
        getAll: vi.fn().mockReturnValue([]),
      },
    });

    const slackClient = {
      postAsAgent: vi.fn().mockResolvedValue({ channel: 'CENG', ts: '1700000000.0002' }),
    } as any;

    const globalConfig = {
      boardProvider: { enabled: true, provider: 'github', projectNumber: 41 },
    } as INightWatchConfig;

    const engine = new DeliberationEngine(slackClient, globalConfig);
    vi.spyOn((engine as any).board, 'generateIssueBody').mockResolvedValue('Issue details');

    await engine.triggerIssueOpener('disc-1', buildTrigger(targetProjectPath));

    expect(mockLoadConfig).toHaveBeenCalledWith(targetProjectPath);
    expect(mockCreateBoardProvider).toHaveBeenCalledWith(
      { enabled: true, provider: 'github', projectNumber: 77 },
      targetProjectPath,
    );
    expect(provider.createIssue).toHaveBeenCalledWith({
      title: expect.any(String),
      body: 'Issue details',
      column: 'In Progress',
    });
  });

  it('does not fall back to listener config board when target project board is missing', async () => {
    const targetProjectPath = '/home/joao/projects/autopilotrank.com';

    mockLoadConfig.mockReturnValue({
      boardProvider: { enabled: true, provider: 'github' },
    });
    mockGetRepositories.mockReturnValue({
      slackDiscussion: {
        getById: vi.fn().mockReturnValue(buildDiscussion(targetProjectPath)),
      },
      agentPersona: {
        getActive: vi.fn().mockReturnValue([buildDevPersona()]),
      },
      projectRegistry: {
        getAll: vi.fn().mockReturnValue([]),
      },
    });

    const slackClient = {
      postAsAgent: vi.fn().mockResolvedValue({ channel: 'CENG', ts: '1700000000.0002' }),
    } as any;

    const globalConfig = {
      boardProvider: { enabled: true, provider: 'github', projectNumber: 41 },
    } as INightWatchConfig;

    const engine = new DeliberationEngine(slackClient, globalConfig);
    vi.spyOn((engine as any).board, 'generateIssueBody').mockResolvedValue('Issue details');

    await engine.triggerIssueOpener('disc-1', buildTrigger(targetProjectPath));

    expect(mockCreateBoardProvider).not.toHaveBeenCalled();
    const postedMessages = slackClient.postAsAgent.mock.calls.map((call: unknown[]) =>
      String(call[1]),
    );
    expect(postedMessages.some((msg: string) => msg.includes('No board configured'))).toBe(true);
  });
});

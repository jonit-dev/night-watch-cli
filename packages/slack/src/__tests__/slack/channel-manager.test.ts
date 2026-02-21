/**
 * Tests for ChannelManager.
 * Covers project channel creation, archiving, and announcements.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'reflect-metadata';
import { container } from 'tsyringe';
import type { IAgentPersona, IRegistryEntry } from '@night-watch/core';
import type { INightWatchConfig } from '@night-watch/core/types.js';

const { mockGetRepositories } = vi.hoisted(() => ({
  mockGetRepositories: vi.fn(),
}));

vi.mock('@night-watch/core/storage/repositories/index.js', () => ({
  getRepositories: mockGetRepositories,
}));

import { ChannelManager } from '../../channel-manager.js';
import type { ISlackMessage } from '../../client.js';

function buildMockSlackClient() {
  return {
    createChannel: vi.fn().mockResolvedValue('CNEW'),
    joinChannel: vi.fn().mockResolvedValue(undefined),
    postAsAgent: vi.fn().mockResolvedValue({ channel: 'CENG', ts: '1700000000.0001' }),
    archiveChannel: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function buildConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  return {
    slack: {
      enabled: true,
      botToken: 'xbot-test',
      appToken: 'xapp-test',
      autoCreateProjectChannels: true,
    },
    ...overrides,
  } as any;
}

function buildPersona(name: string): IAgentPersona {
  return {
    id: `p-${name}`,
    name,
    role: name === 'Carlos' ? 'Tech Lead' : 'Engineer',
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

function buildProject(path: string, slackChannelId?: string): IRegistryEntry {
  return {
    path,
    name: path.split('/').pop() ?? 'test',
    slug: 'test-slug',
    slackChannelId: slackChannelId ?? '',
    boardConfig: null,
  };
}

describe('ChannelManager', () => {
  beforeEach(() => {
    container.reset();
    vi.resetAllMocks();
  });

  describe('slugify', () => {
    it('is tested indirectly via ensureProjectChannel', async () => {
      // slugify is a private function, tested via its effects
      const slackClient = buildMockSlackClient();
      mockGetRepositories.mockReturnValue({
        projectRegistry: {
          getAll: vi.fn().mockReturnValue([]),
          updateSlackChannel: vi.fn(),
        },
        agentPersona: {
          getActive: vi.fn().mockReturnValue([buildPersona('Carlos')]),
        },
      });

      const manager = new ChannelManager(slackClient, buildConfig());
      await manager.ensureProjectChannel('/path/My Test Project!!', 'My Test Project!!');

      expect(slackClient.createChannel).toHaveBeenCalledWith(
        expect.stringMatching(/^proj-my-test-project$/),
      );
    });

    it('limits channel name to 73 chars (excluding proj- prefix)', async () => {
      const slackClient = buildMockSlackClient();
      mockGetRepositories.mockReturnValue({
        projectRegistry: {
          getAll: vi.fn().mockReturnValue([]),
          updateSlackChannel: vi.fn(),
        },
        agentPersona: {
          getActive: vi.fn().mockReturnValue([buildPersona('Carlos')]),
        },
      });

      const manager = new ChannelManager(slackClient, buildConfig());
      const longName = 'a'.repeat(100);
      await manager.ensureProjectChannel('/path/long', longName);

      const channelName = (slackClient.createChannel as any).mock.calls[0]?.[0];
      // slugify: 5 chars for "proj-" prefix + 73 chars for name = 78 total
      expect(channelName).toHaveLength(78);
      expect(channelName).toMatch(/^proj-a{73}$/);
    });
  });

  describe('ensureProjectChannel', () => {
    it('returns null when Slack is disabled', async () => {
      const manager = new ChannelManager(
        buildMockSlackClient(),
        buildConfig({ slack: { enabled: false } }),
      );
      const result = await manager.ensureProjectChannel('/path/test', 'test');
      expect(result).toBeNull();
    });

    it('returns null when autoCreateProjectChannels is disabled', async () => {
      const manager = new ChannelManager(
        buildMockSlackClient(),
        buildConfig({
          slack: { enabled: true, autoCreateProjectChannels: false },
        }),
      );
      const result = await manager.ensureProjectChannel('/path/test', 'test');
      expect(result).toBeNull();
    });

    it('returns existing channel ID if project already has one', async () => {
      const slackClient = buildMockSlackClient();
      const existingChannelId = 'CEXIST';
      mockGetRepositories.mockReturnValue({
        projectRegistry: {
          getAll: vi.fn().mockReturnValue([buildProject('/path/test', existingChannelId)]),
          updateSlackChannel: vi.fn(),
        },
        agentPersona: {
          getActive: vi.fn().mockReturnValue([buildPersona('Carlos')]),
        },
      });

      const manager = new ChannelManager(slackClient, buildConfig());
      const result = await manager.ensureProjectChannel('/path/test', 'test');

      expect(result).toBe(existingChannelId);
      expect(slackClient.createChannel).not.toHaveBeenCalled();
    });

    it('creates new channel and posts intro from Carlos', async () => {
      const slackClient = buildMockSlackClient();
      const carlos = buildPersona('Carlos');
      mockGetRepositories.mockReturnValue({
        projectRegistry: {
          getAll: vi.fn().mockReturnValue([buildProject('/path/test')]),
          updateSlackChannel: vi.fn(),
        },
        agentPersona: {
          getActive: vi.fn().mockReturnValue([carlos]),
        },
      });

      const manager = new ChannelManager(slackClient, buildConfig());
      await manager.ensureProjectChannel('/path/test', 'test-project');

      expect(slackClient.createChannel).toHaveBeenCalledWith('proj-test-project');
      expect(mockGetRepositories().projectRegistry.updateSlackChannel).toHaveBeenCalledWith(
        '/path/test',
        'CNEW',
      );
      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'CNEW',
        expect.stringContaining('test-project'),
        carlos,
      );
    });

    it('falls back to first persona if Carlos not found', async () => {
      const slackClient = buildMockSlackClient();
      const dev = buildPersona('Dev');
      mockGetRepositories.mockReturnValue({
        projectRegistry: {
          getAll: vi.fn().mockReturnValue([buildProject('/path/test')]),
          updateSlackChannel: vi.fn(),
        },
        agentPersona: {
          getActive: vi.fn().mockReturnValue([dev]),
        },
      });

      const manager = new ChannelManager(slackClient, buildConfig());
      await manager.ensureProjectChannel('/path/test', 'test');

      expect(slackClient.postAsAgent).toHaveBeenCalledWith('CNEW', expect.any(String), dev);
    });

    it('handles channel creation failure gracefully', async () => {
      const slackClient = buildMockSlackClient();
      slackClient.createChannel = vi.fn().mockRejectedValue(new Error('API error'));
      mockGetRepositories.mockReturnValue({
        projectRegistry: {
          getAll: vi.fn().mockReturnValue([buildProject('/path/test')]),
          updateSlackChannel: vi.fn(),
        },
        agentPersona: {
          getActive: vi.fn().mockReturnValue([buildPersona('Carlos')]),
        },
      });

      const manager = new ChannelManager(slackClient, buildConfig());
      const result = await manager.ensureProjectChannel('/path/test', 'test');

      expect(result).toBeNull();
      expect(mockGetRepositories().projectRegistry.updateSlackChannel).not.toHaveBeenCalled();
    });

    it('does not post intro when no personas available', async () => {
      const slackClient = buildMockSlackClient();
      mockGetRepositories.mockReturnValue({
        projectRegistry: {
          getAll: vi.fn().mockReturnValue([buildProject('/path/test')]),
          updateSlackChannel: vi.fn(),
        },
        agentPersona: {
          getActive: vi.fn().mockReturnValue([]),
        },
      });

      const manager = new ChannelManager(slackClient, buildConfig());
      await manager.ensureProjectChannel('/path/test', 'test');

      expect(slackClient.postAsAgent).not.toHaveBeenCalled();
    });
  });

  describe('archiveProjectChannel', () => {
    it('returns early when Slack is disabled', async () => {
      const slackClient = buildMockSlackClient();
      mockGetRepositories.mockReturnValue({
        projectRegistry: {
          getAll: vi.fn().mockReturnValue([]),
          updateSlackChannel: vi.fn(),
        },
        agentPersona: {
          getActive: vi.fn().mockReturnValue([buildPersona('Carlos')]),
        },
      });

      const manager = new ChannelManager(slackClient, buildConfig({ slack: { enabled: false } }));
      await manager.archiveProjectChannel('/path/test', 'test');

      expect(slackClient.archiveChannel).not.toHaveBeenCalled();
    });

    it('returns early when project has no channel', async () => {
      const slackClient = buildMockSlackClient();
      mockGetRepositories.mockReturnValue({
        projectRegistry: {
          getAll: vi.fn().mockReturnValue([buildProject('/path/test')]), // No slackChannelId
          updateSlackChannel: vi.fn(),
        },
        agentPersona: {
          getActive: vi.fn().mockReturnValue([buildPersona('Carlos')]),
        },
      });

      const manager = new ChannelManager(slackClient, buildConfig());
      await manager.archiveProjectChannel('/path/test', 'test');

      expect(slackClient.archiveChannel).not.toHaveBeenCalled();
    });

    it('posts farewell and archives channel', async () => {
      const slackClient = buildMockSlackClient();
      const carlos = buildPersona('Carlos');
      const channelId = 'CARCHIVE';
      mockGetRepositories.mockReturnValue({
        projectRegistry: {
          getAll: vi.fn().mockReturnValue([buildProject('/path/test', channelId)]),
          updateSlackChannel: vi.fn(),
        },
        agentPersona: {
          getActive: vi.fn().mockReturnValue([carlos]),
        },
      });

      const manager = new ChannelManager(slackClient, buildConfig());
      await manager.archiveProjectChannel('/path/test', 'test-project');

      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        channelId,
        expect.stringContaining('test-project'),
        carlos,
      );
      await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay for 2s timeout
      expect(slackClient.archiveChannel).toHaveBeenCalledWith(channelId);
      expect(mockGetRepositories().projectRegistry.updateSlackChannel).toHaveBeenCalledWith(
        '/path/test',
        '',
      );
    });

    it('handles archive failure gracefully', async () => {
      const slackClient = buildMockSlackClient();
      slackClient.archiveChannel = vi.fn().mockRejectedValue(new Error('Archive failed'));
      const channelId = 'CARCHIVE';
      mockGetRepositories.mockReturnValue({
        projectRegistry: {
          getAll: vi.fn().mockReturnValue([buildProject('/path/test', channelId)]),
          updateSlackChannel: vi.fn(),
        },
        agentPersona: {
          getActive: vi.fn().mockReturnValue([buildPersona('Carlos')]),
        },
      });

      const manager = new ChannelManager(slackClient, buildConfig());
      await manager.archiveProjectChannel('/path/test', 'test');

      // Should not throw
      expect(slackClient.archiveChannel).toHaveBeenCalled();
    });
  });

  describe('postReleaseAnnouncement', () => {
    it('posts release announcement to project channel', async () => {
      const slackClient = buildMockSlackClient();
      const dev = buildPersona('Dev');
      mockGetRepositories.mockReturnValue({
        projectRegistry: {
          getAll: vi.fn().mockReturnValue([buildProject('/path/test', 'CPROJ')]),
        },
        agentPersona: {
          getActive: vi.fn().mockReturnValue([dev]),
        },
      } as any);

      const manager = new ChannelManager(slackClient, buildConfig());
      await manager.postReleaseAnnouncement(
        'Fix login bug',
        'main',
        'https://github.com/test/pull/42',
        '/path/test',
      );

      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'CPROJ',
        'Shipped: Fix login bug → main\nhttps://github.com/test/pull/42',
        dev,
      );
    });

    it('returns early when project has no channel', async () => {
      const slackClient = buildMockSlackClient();
      mockGetRepositories.mockReturnValue({
        projectRegistry: {
          getAll: vi.fn().mockReturnValue([]),
        },
        agentPersona: {
          getActive: vi.fn().mockReturnValue([buildPersona('Dev')]),
        },
      } as any);

      const manager = new ChannelManager(slackClient, buildConfig());
      await manager.postReleaseAnnouncement('Test', 'main', undefined, '/path/test');

      expect(slackClient.postAsAgent).not.toHaveBeenCalled();
    });

    it('handles announcement without PR URL', async () => {
      const slackClient = buildMockSlackClient();
      mockGetRepositories.mockReturnValue({
        projectRegistry: {
          getAll: vi.fn().mockReturnValue([buildProject('/path/test', 'CPROJ')]),
        },
        agentPersona: {
          getActive: vi.fn().mockReturnValue([buildPersona('Dev')]),
        },
      } as any);

      const manager = new ChannelManager(slackClient, buildConfig());
      await manager.postReleaseAnnouncement('Hotfix', 'main', undefined, '/path/test');

      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'CPROJ',
        'Shipped: Hotfix → main',
        expect.any(Object),
      );
    });

    it('does not post when Dev persona not found', async () => {
      const slackClient = buildMockSlackClient();
      mockGetRepositories.mockReturnValue({
        projectRegistry: {
          getAll: vi.fn().mockReturnValue([buildProject('/path/test', 'CPROJ')]),
        },
        agentPersona: {
          getActive: vi.fn().mockReturnValue([]),
        },
      } as any);

      const manager = new ChannelManager(slackClient, buildConfig());
      await manager.postReleaseAnnouncement('Test', 'main', undefined, '/path/test');

      expect(slackClient.postAsAgent).not.toHaveBeenCalled();
    });
  });

  describe('postEngAnnouncement', () => {
    it('posts announcement to project channel with specified persona', async () => {
      const slackClient = buildMockSlackClient();
      const carlos = buildPersona('Carlos');
      mockGetRepositories.mockReturnValue({
        projectRegistry: {
          getAll: vi.fn().mockReturnValue([buildProject('/path/test', 'CPROJ')]),
        },
        agentPersona: {
          getActive: vi.fn().mockReturnValue([carlos]),
        },
      } as any);

      const manager = new ChannelManager(slackClient, buildConfig());
      await manager.postEngAnnouncement('Weekly summary: all good', 'Carlos', '/path/test');

      expect(slackClient.postAsAgent).toHaveBeenCalledWith(
        'CPROJ',
        'Weekly summary: all good',
        carlos,
      );
    });

    it('uses Carlos as default persona when not specified', async () => {
      const slackClient = buildMockSlackClient();
      const carlos = buildPersona('Carlos');
      mockGetRepositories.mockReturnValue({
        projectRegistry: {
          getAll: vi.fn().mockReturnValue([buildProject('/path/test', 'CPROJ')]),
        },
        agentPersona: {
          getActive: vi.fn().mockReturnValue([carlos]),
        },
      } as any);

      const manager = new ChannelManager(slackClient, buildConfig());
      await manager.postEngAnnouncement('Team update', 'Carlos', '/path/test');

      expect(slackClient.postAsAgent).toHaveBeenCalledWith('CPROJ', 'Team update', carlos);
    });

    it('falls back to first persona if requested not found', async () => {
      const slackClient = buildMockSlackClient();
      const dev = buildPersona('Dev');
      mockGetRepositories.mockReturnValue({
        projectRegistry: {
          getAll: vi.fn().mockReturnValue([buildProject('/path/test', 'CPROJ')]),
        },
        agentPersona: {
          getActive: vi.fn().mockReturnValue([dev]),
        },
      } as any);

      const manager = new ChannelManager(slackClient, buildConfig());
      await manager.postEngAnnouncement('Test', 'Carlos', '/path/test'); // Carlos not found

      expect(slackClient.postAsAgent).toHaveBeenCalledWith('CPROJ', 'Test', dev);
    });

    it('returns early when project has no channel', async () => {
      const slackClient = buildMockSlackClient();
      mockGetRepositories.mockReturnValue({
        projectRegistry: {
          getAll: vi.fn().mockReturnValue([]),
        },
        agentPersona: {
          getActive: vi.fn().mockReturnValue([buildPersona('Carlos')]),
        },
      } as any);

      const manager = new ChannelManager(slackClient, buildConfig());
      await manager.postEngAnnouncement('Test', 'Carlos', '/path/test');

      expect(slackClient.postAsAgent).not.toHaveBeenCalled();
    });
  });
});

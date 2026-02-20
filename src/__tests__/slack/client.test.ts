import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockWebClientCtor,
  mockPostMessage,
  mockUsersList,
  mockInvite,
} = vi.hoisted(() => ({
  mockWebClientCtor: vi.fn(),
  mockPostMessage: vi.fn(),
  mockUsersList: vi.fn(),
  mockInvite: vi.fn(),
}));

vi.mock("@slack/web-api", () => ({
  WebClient: class {
    chat = { postMessage: mockPostMessage };
    reactions = { add: vi.fn() };
    users = { list: mockUsersList };
    conversations = {
      create: vi.fn(),
      archive: vi.fn(),
      replies: vi.fn(),
      list: vi.fn(),
      invite: mockInvite,
    };

    constructor(token: string) {
      mockWebClientCtor(token);
    }
  },
}));

import { SlackClient } from "../../slack/client.js";
import type { IAgentPersona } from "../../../shared/types.js";

function buildPersona(input: Partial<IAgentPersona>): IAgentPersona {
  return {
    id: 'p1',
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
      emojiUsage: { frequency: 'never', favorites: [], contextRules: '' },
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
    ...input,
  };
}

describe("SlackClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses fallback persona avatar URL when no avatar is configured", async () => {
    mockPostMessage.mockResolvedValueOnce({ ts: '1.23', channel: 'C123' });

    const client = new SlackClient("xoxb-test-token");
    await client.postAsAgent('C123', 'hello', buildPersona({ name: 'Maya', role: 'Security Reviewer', avatarUrl: null }));

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const payload = mockPostMessage.mock.calls[0][0] as { icon_url?: string };
    expect(payload.icon_url).toContain('ui-avatars.com');
    expect(payload.icon_url).toContain('name=Maya');
  });

  it("prefers explicit persona avatar URL when provided", async () => {
    mockPostMessage.mockResolvedValueOnce({ ts: '1.24', channel: 'C123' });

    const client = new SlackClient("xoxb-test-token");
    await client.postAsAgent(
      'C123',
      'hello',
      buildPersona({ avatarUrl: 'https://cdn.example.com/maya.png' }),
    );

    const payload = mockPostMessage.mock.calls[0][0] as { icon_url?: string };
    expect(payload.icon_url).toBe('https://cdn.example.com/maya.png');
  });

  it("supports posting bot/system message into a thread", async () => {
    mockPostMessage.mockResolvedValueOnce({ ts: '1.25', channel: 'C123' });

    const client = new SlackClient("xoxb-test-token");
    await client.postMessage('C123', '[job] started', '1700000000.100');

    const payload = mockPostMessage.mock.calls[0][0] as { thread_ts?: string; text: string };
    expect(payload.text).toBe('[job] started');
    expect(payload.thread_ts).toBe('1700000000.100');
  });

  it("paginates users.list and filters bot/deleted/system users", async () => {
    mockUsersList
      .mockResolvedValueOnce({
        members: [
          { id: "U1", name: "alice" },
          { id: "USLACKBOT", name: "slackbot" },
        ],
        response_metadata: { next_cursor: "cursor-1" },
      })
      .mockResolvedValueOnce({
        members: [
          { id: "U2", name: "botty", is_bot: true },
          { id: "U3", real_name: "Carlos" },
          { id: "U4", name: "gone", deleted: true },
        ],
        response_metadata: { next_cursor: "" },
      });

    const client = new SlackClient("xoxb-test-token");
    const users = await client.listUsers();

    expect(mockWebClientCtor).toHaveBeenCalledWith("xoxb-test-token");
    expect(mockUsersList).toHaveBeenCalledTimes(2);
    expect(users).toEqual([
      { id: "U1", name: "alice" },
      { id: "U3", name: "Carlos" },
    ]);
  });

  it("invites users in 1000-sized batches and returns invited count", async () => {
    const userIds = Array.from({ length: 1205 }, (_, i) => `U${i + 1}`);

    const client = new SlackClient("xoxb-test-token");
    const invitedCount = await client.inviteUsers("C123", [...userIds, "U1"]);

    expect(invitedCount).toBe(1205);
    expect(mockInvite).toHaveBeenCalledTimes(2);

    const firstCall = mockInvite.mock.calls[0][0] as { channel: string; users: string };
    const secondCall = mockInvite.mock.calls[1][0] as { channel: string; users: string };

    expect(firstCall.channel).toBe("C123");
    expect(firstCall.users.split(",")).toHaveLength(1000);
    expect(secondCall.channel).toBe("C123");
    expect(secondCall.users.split(",")).toHaveLength(205);
  });
});

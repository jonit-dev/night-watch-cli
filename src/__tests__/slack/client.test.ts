import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockWebClientCtor,
  mockUsersList,
  mockInvite,
} = vi.hoisted(() => ({
  mockWebClientCtor: vi.fn(),
  mockUsersList: vi.fn(),
  mockInvite: vi.fn(),
}));

vi.mock("@slack/web-api", () => ({
  WebClient: class {
    chat = { postMessage: vi.fn() };
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

describe("SlackClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

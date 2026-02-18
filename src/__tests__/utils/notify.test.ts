/**
 * Tests for notification utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock chalk to disable colors for easier assertions
vi.mock("chalk", () => ({
  default: {
    green: (msg: string) => msg,
    red: (msg: string) => msg,
    yellow: (msg: string) => msg,
    cyan: (msg: string) => msg,
    dim: (msg: string) => msg,
    bold: (msg: string) => msg,
  },
  green: (msg: string) => msg,
  red: (msg: string) => msg,
  yellow: (msg: string) => msg,
  cyan: (msg: string) => msg,
  dim: (msg: string) => msg,
  bold: (msg: string) => msg,
}));

import {
  formatSlackPayload,
  formatDiscordPayload,
  formatTelegramPayload,
  sendWebhook,
  sendNotifications,
  NotificationContext,
} from "../../utils/notify.js";
import { INightWatchConfig, IWebhookConfig } from "../../types.js";

describe("notification utilities", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockFetch: ReturnType<typeof vi.fn>;

  const baseCtx: NotificationContext = {
    event: "run_succeeded",
    projectName: "my-project",
    prdName: "add-auth",
    branchName: "night-watch/add-auth",
    exitCode: 0,
    duration: 120,
    provider: "claude",
  };

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("formatSlackPayload", () => {
    it("should include project name", () => {
      const payload = formatSlackPayload(baseCtx) as any;
      const text = payload.attachments[0].blocks[0].text.text;
      expect(text).toContain("my-project");
    });

    it("should set green color for success", () => {
      const payload = formatSlackPayload({ ...baseCtx, event: "run_succeeded" }) as any;
      expect(payload.attachments[0].color).toBe("#00ff00");
    });

    it("should set red color for failure", () => {
      const payload = formatSlackPayload({ ...baseCtx, event: "run_failed" }) as any;
      expect(payload.attachments[0].color).toBe("#ff0000");
    });
  });

  describe("formatDiscordPayload", () => {
    it("should set color based on event", () => {
      const successPayload = formatDiscordPayload({
        ...baseCtx,
        event: "run_succeeded",
      }) as any;
      expect(successPayload.embeds[0].color).toBe(0x00ff00);

      const failPayload = formatDiscordPayload({ ...baseCtx, event: "run_failed" }) as any;
      expect(failPayload.embeds[0].color).toBe(0xff0000);
    });

    it("should include timestamp", () => {
      const payload = formatDiscordPayload(baseCtx) as any;
      expect(payload.embeds[0].timestamp).toBeDefined();
      expect(typeof payload.embeds[0].timestamp).toBe("string");
    });
  });

  describe("formatTelegramPayload", () => {
    it("should use MarkdownV2", () => {
      const payload = formatTelegramPayload(baseCtx);
      expect(payload.parse_mode).toBe("MarkdownV2");
    });

    it("should use structured template when prUrl is present", () => {
      const enrichedCtx: NotificationContext = {
        ...baseCtx,
        prUrl: "https://github.com/user/repo/pull/42",
        prTitle: "feat: add auth",
        prNumber: 42,
        prBody: "Added JWT authentication with login and register endpoints.",
        filesChanged: 12,
        additions: 340,
        deletions: 28,
      };

      const payload = formatTelegramPayload(enrichedCtx);
      expect(payload.parse_mode).toBe("MarkdownV2");
      // Should contain PR title, URL, summary, and stats
      expect(payload.text).toContain("feat: add auth");
      expect(payload.text).toContain("github\\.com");
      expect(payload.text).toContain("JWT authentication");
      expect(payload.text).toContain("340");
      expect(payload.text).toContain("28");
      expect(payload.text).toContain("12");
    });

    it("should fall back to basic format when no PR details", () => {
      const payload = formatTelegramPayload(baseCtx);
      // Should contain basic info but not structured PR sections
      expect(payload.text).toContain("my\\-project");
      expect(payload.text).not.toContain("Stats");
      expect(payload.text).not.toContain("Summary");
    });

    it("should truncate long PR body", () => {
      const longBody = "A".repeat(1000);
      const enrichedCtx: NotificationContext = {
        ...baseCtx,
        prUrl: "https://github.com/user/repo/pull/42",
        prTitle: "feat: long PR",
        prNumber: 42,
        prBody: longBody,
        filesChanged: 5,
        additions: 100,
        deletions: 10,
      };

      const payload = formatTelegramPayload(enrichedCtx);
      // The summary should be truncated (extractSummary limits to 500 chars)
      expect(payload.text.length).toBeLessThan(longBody.length + 500);
    });

    it("should handle empty PR body", () => {
      const enrichedCtx: NotificationContext = {
        ...baseCtx,
        prUrl: "https://github.com/user/repo/pull/42",
        prTitle: "feat: no body",
        prNumber: 42,
        prBody: "",
        filesChanged: 3,
        additions: 50,
        deletions: 5,
      };

      const payload = formatTelegramPayload(enrichedCtx);
      expect(payload.parse_mode).toBe("MarkdownV2");
      // Should not crash, should not have Summary section
      expect(payload.text).toContain("feat: no body");
      expect(payload.text).not.toContain("Summary");
    });
  });

  describe("sendWebhook", () => {
    it("should skip events not in config", async () => {
      const webhook: IWebhookConfig = {
        type: "slack",
        url: "https://hooks.slack.com/test",
        events: ["run_failed"],
      };

      await sendWebhook(webhook, { ...baseCtx, event: "run_succeeded" });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should call fetch for matching events", async () => {
      const webhook: IWebhookConfig = {
        type: "slack",
        url: "https://hooks.slack.com/test",
        events: ["run_failed"],
      };

      await sendWebhook(webhook, { ...baseCtx, event: "run_failed" });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://hooks.slack.com/test",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    it("should not throw on fetch failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const webhook: IWebhookConfig = {
        type: "slack",
        url: "https://hooks.slack.com/test",
        events: ["run_failed"],
      };

      // Should not throw
      await expect(
        sendWebhook(webhook, { ...baseCtx, event: "run_failed" })
      ).resolves.toBeUndefined();
    });
  });

  describe("sendNotifications", () => {
    it("should handle empty webhooks", async () => {
      const config = {
        notifications: { webhooks: [] },
      } as INightWatchConfig;

      // Should not throw or call fetch
      await sendNotifications(config, baseCtx);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should send to all configured webhooks", async () => {
      const config = {
        notifications: {
          webhooks: [
            {
              type: "slack" as const,
              url: "https://hooks.slack.com/test1",
              events: ["run_succeeded" as const],
            },
            {
              type: "discord" as const,
              url: "https://discord.com/api/webhooks/test2",
              events: ["run_succeeded" as const],
            },
          ],
        },
      } as INightWatchConfig;

      await sendNotifications(config, baseCtx);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});

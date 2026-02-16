/**
 * Tests for doctor command — validateWebhook
 */

import { describe, it, expect } from "vitest";
import { validateWebhook } from "../../commands/doctor.js";
import { WebhookConfig } from "../../types.js";

describe("doctor command", () => {
  describe("validateWebhook", () => {
    it("should pass valid slack webhook", () => {
      const webhook: WebhookConfig = {
        type: "slack",
        url: "https://hooks.slack.com/services/T00/B00/xxx",
        events: ["run_succeeded", "run_failed"],
      };
      expect(validateWebhook(webhook)).toEqual([]);
    });

    it("should fail slack webhook with invalid URL", () => {
      const webhook: WebhookConfig = {
        type: "slack",
        url: "https://example.com/webhook",
        events: ["run_failed"],
      };
      const issues = validateWebhook(webhook);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]).toContain("hooks.slack.com");
    });

    it("should fail slack webhook with missing URL", () => {
      const webhook: WebhookConfig = {
        type: "slack",
        events: ["run_failed"],
      };
      const issues = validateWebhook(webhook);
      expect(issues).toContain("Missing URL");
    });

    it("should pass valid discord webhook", () => {
      const webhook: WebhookConfig = {
        type: "discord",
        url: "https://discord.com/api/webhooks/123/abc",
        events: ["run_failed"],
      };
      expect(validateWebhook(webhook)).toEqual([]);
    });

    it("should fail discord webhook with invalid URL", () => {
      const webhook: WebhookConfig = {
        type: "discord",
        url: "https://example.com/hook",
        events: ["run_failed"],
      };
      const issues = validateWebhook(webhook);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]).toContain("discord.com/api/webhooks");
    });

    it("should fail discord webhook with missing URL", () => {
      const webhook: WebhookConfig = {
        type: "discord",
        events: ["run_failed"],
      };
      const issues = validateWebhook(webhook);
      expect(issues).toContain("Missing URL");
    });

    it("should pass valid telegram webhook", () => {
      const webhook: WebhookConfig = {
        type: "telegram",
        botToken: "123456:ABC-DEF",
        chatId: "-1001234567890",
        events: ["run_failed"],
      };
      expect(validateWebhook(webhook)).toEqual([]);
    });

    it("should fail telegram without botToken", () => {
      const webhook: WebhookConfig = {
        type: "telegram",
        chatId: "-100123",
        events: ["run_failed"],
      };
      const issues = validateWebhook(webhook);
      expect(issues).toContain("Missing botToken");
    });

    it("should fail telegram without chatId", () => {
      const webhook: WebhookConfig = {
        type: "telegram",
        botToken: "123:ABC",
        events: ["run_failed"],
      };
      const issues = validateWebhook(webhook);
      expect(issues).toContain("Missing chatId");
    });

    it("should fail telegram without both botToken and chatId", () => {
      const webhook: WebhookConfig = {
        type: "telegram",
        events: ["run_failed"],
      };
      const issues = validateWebhook(webhook);
      expect(issues).toContain("Missing botToken");
      expect(issues).toContain("Missing chatId");
    });

    it("should fail with no events configured", () => {
      const webhook: WebhookConfig = {
        type: "slack",
        url: "https://hooks.slack.com/services/T00/B00/xxx",
        events: [],
      };
      const issues = validateWebhook(webhook);
      expect(issues).toContain("No events configured");
    });

    it("should fail with invalid event name", () => {
      const webhook: WebhookConfig = {
        type: "slack",
        url: "https://hooks.slack.com/services/T00/B00/xxx",
        events: ["invalid_event" as any],
      };
      const issues = validateWebhook(webhook);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]).toContain("Invalid event");
    });

    it("should fail with unknown webhook type", () => {
      const webhook: WebhookConfig = {
        type: "teams" as any,
        url: "https://example.com/webhook",
        events: ["run_failed"],
      };
      const issues = validateWebhook(webhook);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]).toContain("Unknown webhook type");
    });

    it("should report multiple issues at once", () => {
      const webhook: WebhookConfig = {
        type: "slack",
        url: "https://example.com/bad-url",
        events: ["invalid_event" as any],
      };
      const issues = validateWebhook(webhook);
      // Should have both an invalid event issue and a bad URL issue
      expect(issues.length).toBe(2);
      expect(issues.some((i) => i.includes("Invalid event"))).toBe(true);
      expect(issues.some((i) => i.includes("hooks.slack.com"))).toBe(true);
    });

    it("should accept all valid event types", () => {
      const webhook: WebhookConfig = {
        type: "slack",
        url: "https://hooks.slack.com/services/T00/B00/xxx",
        events: [
          "run_succeeded",
          "run_failed",
          "run_timeout",
          "review_completed",
        ],
      };
      expect(validateWebhook(webhook)).toEqual([]);
    });
  });
});

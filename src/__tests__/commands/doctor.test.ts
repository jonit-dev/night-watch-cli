/**
 * Tests for doctor command — validateWebhook and CLI
 */

import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { validateWebhook } from "../../commands/doctor.js";
import { IIWebhookConfig } from "../../types.js";

describe("doctor command", () => {
  describe("validateWebhook", () => {
    it("should pass valid slack webhook", () => {
      const webhook: IIWebhookConfig = {
        type: "slack",
        url: "https://hooks.slack.com/services/T00/B00/xxx",
        events: ["run_succeeded", "run_failed"],
      };
      expect(validateWebhook(webhook)).toEqual([]);
    });

    it("should fail slack webhook with invalid URL", () => {
      const webhook: IIWebhookConfig = {
        type: "slack",
        url: "https://example.com/webhook",
        events: ["run_failed"],
      };
      const issues = validateWebhook(webhook);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]).toContain("hooks.slack.com");
    });

    it("should fail slack webhook with missing URL", () => {
      const webhook: IIWebhookConfig = {
        type: "slack",
        events: ["run_failed"],
      };
      const issues = validateWebhook(webhook);
      expect(issues).toContain("Missing URL");
    });

    it("should pass valid discord webhook", () => {
      const webhook: IWebhookConfig = {
        type: "discord",
        url: "https://discord.com/api/webhooks/123/abc",
        events: ["run_failed"],
      };
      expect(validateWebhook(webhook)).toEqual([]);
    });

    it("should fail discord webhook with invalid URL", () => {
      const webhook: IWebhookConfig = {
        type: "discord",
        url: "https://example.com/hook",
        events: ["run_failed"],
      };
      const issues = validateWebhook(webhook);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]).toContain("discord.com/api/webhooks");
    });

    it("should fail discord webhook with missing URL", () => {
      const webhook: IWebhookConfig = {
        type: "discord",
        events: ["run_failed"],
      };
      const issues = validateWebhook(webhook);
      expect(issues).toContain("Missing URL");
    });

    it("should pass valid telegram webhook", () => {
      const webhook: IWebhookConfig = {
        type: "telegram",
        botToken: "123456:ABC-DEF",
        chatId: "-1001234567890",
        events: ["run_failed"],
      };
      expect(validateWebhook(webhook)).toEqual([]);
    });

    it("should fail telegram without botToken", () => {
      const webhook: IWebhookConfig = {
        type: "telegram",
        chatId: "-100123",
        events: ["run_failed"],
      };
      const issues = validateWebhook(webhook);
      expect(issues).toContain("Missing botToken");
    });

    it("should fail telegram without chatId", () => {
      const webhook: IWebhookConfig = {
        type: "telegram",
        botToken: "123:ABC",
        events: ["run_failed"],
      };
      const issues = validateWebhook(webhook);
      expect(issues).toContain("Missing chatId");
    });

    it("should fail telegram without both botToken and chatId", () => {
      const webhook: IWebhookConfig = {
        type: "telegram",
        events: ["run_failed"],
      };
      const issues = validateWebhook(webhook);
      expect(issues).toContain("Missing botToken");
      expect(issues).toContain("Missing chatId");
    });

    it("should fail with no events configured", () => {
      const webhook: IWebhookConfig = {
        type: "slack",
        url: "https://hooks.slack.com/services/T00/B00/xxx",
        events: [],
      };
      const issues = validateWebhook(webhook);
      expect(issues).toContain("No events configured");
    });

    it("should fail with invalid event name", () => {
      const webhook: IWebhookConfig = {
        type: "slack",
        url: "https://hooks.slack.com/services/T00/B00/xxx",
        events: ["invalid_event" as any],
      };
      const issues = validateWebhook(webhook);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]).toContain("Invalid event");
    });

    it("should fail with unknown webhook type", () => {
      const webhook: IWebhookConfig = {
        type: "teams" as any,
        url: "https://example.com/webhook",
        events: ["run_failed"],
      };
      const issues = validateWebhook(webhook);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]).toContain("Unknown webhook type");
    });

    it("should report multiple issues at once", () => {
      const webhook: IWebhookConfig = {
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
      const webhook: IWebhookConfig = {
        type: "slack",
        url: "https://hooks.slack.com/services/T00/B00/xxx",
        events: [
          "run_started",
          "run_succeeded",
          "run_failed",
          "run_timeout",
          "review_completed",
        ],
      };
      expect(validateWebhook(webhook)).toEqual([]);
    });
  });

  describe("CLI", () => {
    it("should show doctor command in help", () => {
      const output = execSync("npx tsx src/cli.ts --help", {
        encoding: "utf-8",
        cwd: process.cwd(),
      });

      expect(output).toContain("doctor");
    });

    it("should show help text with --fix option", () => {
      const output = execSync("npx tsx src/cli.ts doctor --help", {
        encoding: "utf-8",
        cwd: process.cwd(),
      });

      expect(output).toContain("Check Night Watch configuration");
      expect(output).toContain("--fix");
    });

    it("should run all checks and show pass/fail indicators", () => {
      // Doctor command may exit with code 1 if checks fail, so we need to handle that
      let output: string;
      try {
        output = execSync("npx tsx src/cli.ts doctor", {
          encoding: "utf-8",
          cwd: process.cwd(),
          stdio: "pipe",
        });
      } catch (error) {
        const err = error as { stdout?: string };
        output = err.stdout || "";
      }

      // Should show check names
      expect(output).toContain("Node.js version");
      expect(output).toContain("git repository");
      expect(output).toContain("GitHub CLI");
      expect(output).toContain("provider CLI");
      expect(output).toContain("config file");
      expect(output).toContain("PRD directory");
      expect(output).toContain("logs directory");
      expect(output).toContain("webhook configuration");

      // Should show summary
      expect(output).toContain("Summary");
      expect(output).toContain("Checks passed");
    });

    it("should show git repo check success in project dir", () => {
      // Doctor command may exit with code 1 if checks fail, so we need to handle that
      let output: string;
      try {
        output = execSync("npx tsx src/cli.ts doctor", {
          encoding: "utf-8",
          cwd: process.cwd(),
          stdio: "pipe",
        });
      } catch (error) {
        const err = error as { stdout?: string };
        output = err.stdout || "";
      }

      // This project IS a git repo, so should pass
      expect(output).toContain("Git repository found");
    });
  });
});

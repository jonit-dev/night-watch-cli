/**
 * Tests for the Night Watch CLI configuration loader
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadConfig, getDefaultConfig } from "../config.js";
import { INightWatchConfig } from "../types.js";

describe("config", () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Create a temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "night-watch-test-"));

    // Save original environment
    originalEnv = { ...process.env };

    // Clear NW_* environment variables
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("NW_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Restore original environment
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("NW_")) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (key.startsWith("NW_")) {
        process.env[key] = value;
      }
    }
  });

  describe("getDefaultConfig", () => {
    it("should return all default values", () => {
      const config = getDefaultConfig();

      expect(config.defaultBranch).toBe("");
      expect(config.prdDir).toBe("docs/PRDs/night-watch");
      expect(config.maxRuntime).toBe(7200);
      expect(config.reviewerMaxRuntime).toBe(3600);
      expect(config.branchPrefix).toBe("night-watch");
      expect(config.branchPatterns).toEqual(["feat/", "night-watch/"]);
      expect(config.minReviewScore).toBe(80);
      expect(config.maxLogSize).toBe(524288);
      expect(config.cronSchedule).toBe("0 0-21 * * *");
      expect(config.reviewerSchedule).toBe("0 0,3,6,9,12,15,18,21 * * *");
    });

    it("should return defaults with provider and reviewerEnabled", () => {
      const config = getDefaultConfig();

      expect(config.provider).toBe("claude");
      expect(config.reviewerEnabled).toBe(true);
    });
  });

  describe("loadConfig", () => {
    it("should return defaults when no config file exists", () => {
      const config = loadConfig(tempDir);
      const defaults = getDefaultConfig();

      expect(config.defaultBranch).toBe(defaults.defaultBranch);
      expect(config.prdDir).toBe(defaults.prdDir);
      expect(config.maxRuntime).toBe(defaults.maxRuntime);
      expect(config.reviewerMaxRuntime).toBe(defaults.reviewerMaxRuntime);
      expect(config.branchPrefix).toBe(defaults.branchPrefix);
      expect(config.branchPatterns).toEqual(defaults.branchPatterns);
      expect(config.minReviewScore).toBe(defaults.minReviewScore);
      expect(config.maxLogSize).toBe(defaults.maxLogSize);
      expect(config.cronSchedule).toBe(defaults.cronSchedule);
      expect(config.reviewerSchedule).toBe(defaults.reviewerSchedule);
      expect(config.provider).toBe("claude");
      expect(config.reviewerEnabled).toBe(true);
    });

    it("should merge config file with defaults", () => {
      // Write a config file with some overrides
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          prdDir: "custom/prds",
          maxRuntime: 3600,
          branchPatterns: ["custom/", "feature/"],
          provider: "claude",
          reviewerEnabled: true,
        })
      );

      const config = loadConfig(tempDir);

      // Check file overrides
      expect(config.prdDir).toBe("custom/prds");
      expect(config.maxRuntime).toBe(3600);
      expect(config.branchPatterns).toEqual(["custom/", "feature/"]);

      // Check defaults preserved
      expect(config.reviewerMaxRuntime).toBe(3600);
      expect(config.branchPrefix).toBe("night-watch");
      expect(config.minReviewScore).toBe(80);
      expect(config.maxLogSize).toBe(524288);
      expect(config.cronSchedule).toBe("0 0-21 * * *");
      expect(config.reviewerSchedule).toBe("0 0,3,6,9,12,15,18,21 * * *");
    });

    it("should support nested init/template config format", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          provider: "codex",
          reviewerEnabled: false,
          prdDirectory: "docs/custom-prds",
          maxRuntime: 1800,
          reviewerMaxRuntime: 900,
          cron: {
            executorSchedule: "*/10 * * * *",
            reviewerSchedule: "*/30 * * * *",
          },
          review: {
            minScore: 72,
            branchPatterns: ["bot/", "auto/"],
          },
          logging: {
            maxLogSize: 123456,
          },
        })
      );

      const config = loadConfig(tempDir);

      expect(config.provider).toBe("codex");
      expect(config.reviewerEnabled).toBe(false);
      expect(config.prdDir).toBe("docs/custom-prds");
      expect(config.maxRuntime).toBe(1800);
      expect(config.reviewerMaxRuntime).toBe(900);
      expect(config.cronSchedule).toBe("*/10 * * * *");
      expect(config.reviewerSchedule).toBe("*/30 * * * *");
      expect(config.minReviewScore).toBe(72);
      expect(config.branchPatterns).toEqual(["bot/", "auto/"]);
      expect(config.maxLogSize).toBe(123456);
    });

    it("should let env vars override config file", () => {
      // Write a config file
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          maxRuntime: 3600,
          cronSchedule: "0 * * * *",
          provider: "claude",
          reviewerEnabled: true,
        })
      );

      // Set env vars to override
      process.env.NW_MAX_RUNTIME = "1800";
      process.env.NW_CRON_SCHEDULE = "0 0 * * *";

      const config = loadConfig(tempDir);

      // Env vars should win
      expect(config.maxRuntime).toBe(1800);
      expect(config.cronSchedule).toBe("0 0 * * *");
    });

    it("should merge provider from config file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          provider: "codex",
          reviewerEnabled: false,
        })
      );

      const config = loadConfig(tempDir);

      expect(config.provider).toBe("codex");
      expect(config.reviewerEnabled).toBe(false);
    });

    it("should handle NW_PROVIDER env var", () => {
      process.env.NW_PROVIDER = "codex";

      const config = loadConfig(tempDir);

      expect(config.provider).toBe("codex");
    });

    it("should handle NW_REVIEWER_ENABLED env var", () => {
      process.env.NW_REVIEWER_ENABLED = "false";

      const config = loadConfig(tempDir);

      expect(config.reviewerEnabled).toBe(false);
    });

    it("should fallback to default for invalid NW_PROVIDER", () => {
      process.env.NW_PROVIDER = "invalid";

      const config = loadConfig(tempDir);

      expect(config.provider).toBe("claude");
    });

    it("should handle NW_REVIEWER_ENABLED with '1' value", () => {
      process.env.NW_REVIEWER_ENABLED = "0";

      const config = loadConfig(tempDir);

      expect(config.reviewerEnabled).toBe(false);
    });

    it("should handle NW_REVIEWER_ENABLED with 'true' value", () => {
      // First set reviewerEnabled to false in a config file
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          provider: "claude",
          reviewerEnabled: false,
        })
      );

      // Then override with env var
      process.env.NW_REVIEWER_ENABLED = "true";

      const config = loadConfig(tempDir);

      expect(config.reviewerEnabled).toBe(true);
    });

    it("should handle NW_REVIEWER_MAX_RUNTIME env var", () => {
      process.env.NW_REVIEWER_MAX_RUNTIME = "7200";

      const config = loadConfig(tempDir);

      expect(config.reviewerMaxRuntime).toBe(7200);
    });

    it("should handle NW_REVIEWER_SCHEDULE env var", () => {
      process.env.NW_REVIEWER_SCHEDULE = "0 */2 * * *";

      const config = loadConfig(tempDir);

      expect(config.reviewerSchedule).toBe("0 */2 * * *");
    });

    it("should ignore NW_MAX_RETRIES values below 1", () => {
      process.env.NW_MAX_RETRIES = "0";

      const config = loadConfig(tempDir);
      const defaults = getDefaultConfig();

      expect(config.maxRetries).toBe(defaults.maxRetries);
    });

    it("should sanitize maxRetries from config file when invalid", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          maxRetries: 0,
        })
      );

      const config = loadConfig(tempDir);
      const defaults = getDefaultConfig();

      expect(config.maxRetries).toBe(defaults.maxRetries);
    });

    it("should handle NW_BRANCH_PREFIX env var", () => {
      process.env.NW_BRANCH_PREFIX = "auto";

      const config = loadConfig(tempDir);

      expect(config.branchPrefix).toBe("auto");
    });

    it("should handle NW_BRANCH_PATTERNS as JSON array", () => {
      process.env.NW_BRANCH_PATTERNS = '["auto/", "bot/"]';

      const config = loadConfig(tempDir);

      expect(config.branchPatterns).toEqual(["auto/", "bot/"]);
    });

    it("should handle NW_BRANCH_PATTERNS as comma-separated string", () => {
      process.env.NW_BRANCH_PATTERNS = "auto/, bot/";

      const config = loadConfig(tempDir);

      expect(config.branchPatterns).toEqual(["auto/", "bot/"]);
    });

    it("should handle NW_MIN_REVIEW_SCORE env var", () => {
      process.env.NW_MIN_REVIEW_SCORE = "90";

      const config = loadConfig(tempDir);

      expect(config.minReviewScore).toBe(90);
    });

    it("should handle NW_MAX_LOG_SIZE env var", () => {
      process.env.NW_MAX_LOG_SIZE = "1048576";

      const config = loadConfig(tempDir);

      expect(config.maxLogSize).toBe(1048576);
    });

    it("should handle NW_PRD_DIR env var", () => {
      process.env.NW_PRD_DIR = "docs/prd";

      const config = loadConfig(tempDir);

      expect(config.prdDir).toBe("docs/prd");
    });

    it("should load defaultBranch from config file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          defaultBranch: "master",
        })
      );

      const config = loadConfig(tempDir);

      expect(config.defaultBranch).toBe("master");
    });

    it("should handle NW_DEFAULT_BRANCH env var", () => {
      process.env.NW_DEFAULT_BRANCH = "develop";

      const config = loadConfig(tempDir);

      expect(config.defaultBranch).toBe("develop");
    });

    it("should let NW_DEFAULT_BRANCH env var override config file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          defaultBranch: "master",
        })
      );

      process.env.NW_DEFAULT_BRANCH = "develop";

      const config = loadConfig(tempDir);

      expect(config.defaultBranch).toBe("develop");
    });

    it("should ignore invalid JSON config file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(configPath, "{ invalid json }");

      // Should not throw and return defaults
      const config = loadConfig(tempDir);
      const defaults = getDefaultConfig();

      expect(config.maxRuntime).toBe(defaults.maxRuntime);
    });

    it("should ignore invalid numeric env vars", () => {
      process.env.NW_MAX_RUNTIME = "also-not-a-number";

      const config = loadConfig(tempDir);
      const defaults = getDefaultConfig();

      // Should fall back to defaults for invalid values
      expect(config.maxRuntime).toBe(defaults.maxRuntime);
    });

    it("should handle all NW_* env vars together", () => {
      process.env.NW_DEFAULT_BRANCH = "master";
      process.env.NW_PRD_DIR = "custom/prds";
      process.env.NW_MAX_RUNTIME = "14400";
      process.env.NW_REVIEWER_MAX_RUNTIME = "7200";
      process.env.NW_BRANCH_PREFIX = "bot";
      process.env.NW_BRANCH_PATTERNS = '["bot/", "auto/"]';
      process.env.NW_MIN_REVIEW_SCORE = "70";
      process.env.NW_MAX_LOG_SIZE = "2097152";
      process.env.NW_CRON_SCHEDULE = "0 */6 * * *";
      process.env.NW_REVIEWER_SCHEDULE = "0 */3 * * *";
      process.env.NW_PROVIDER = "codex";
      process.env.NW_REVIEWER_ENABLED = "false";

      const config = loadConfig(tempDir);

      expect(config.defaultBranch).toBe("master");
      expect(config.prdDir).toBe("custom/prds");
      expect(config.maxRuntime).toBe(14400);
      expect(config.reviewerMaxRuntime).toBe(7200);
      expect(config.branchPrefix).toBe("bot");
      expect(config.branchPatterns).toEqual(["bot/", "auto/"]);
      expect(config.minReviewScore).toBe(70);
      expect(config.maxLogSize).toBe(2097152);
      expect(config.cronSchedule).toBe("0 */6 * * *");
      expect(config.reviewerSchedule).toBe("0 */3 * * *");
      expect(config.provider).toBe("codex");
      expect(config.reviewerEnabled).toBe(false);
    });
  });

  describe("notifications config", () => {
    it("should load notifications from config file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          notifications: {
            webhooks: [
              {
                type: "slack",
                url: "https://hooks.slack.com/services/test",
                events: ["run_succeeded", "run_failed"],
              },
              {
                type: "telegram",
                botToken: "123456:ABC",
                chatId: "-100123",
                events: ["review_completed"],
              },
            ],
          },
        })
      );

      const config = loadConfig(tempDir);

      expect(config.notifications.webhooks).toHaveLength(2);
      expect(config.notifications.webhooks[0]).toEqual({
        type: "slack",
        url: "https://hooks.slack.com/services/test",
        botToken: undefined,
        chatId: undefined,
        events: ["run_succeeded", "run_failed"],
      });
      expect(config.notifications.webhooks[1]).toEqual({
        type: "telegram",
        url: undefined,
        botToken: "123456:ABC",
        chatId: "-100123",
        events: ["review_completed"],
      });
    });

    it("should default to empty webhooks", () => {
      const config = loadConfig(tempDir);

      expect(config.notifications).toBeDefined();
      expect(config.notifications.webhooks).toEqual([]);
    });

    it("should parse NW_NOTIFICATIONS env var", () => {
      const notifications = {
        webhooks: [
          {
            type: "discord",
            url: "https://discord.com/api/webhooks/test",
            events: ["run_timeout"],
          },
        ],
      };
      process.env.NW_NOTIFICATIONS = JSON.stringify(notifications);

      const config = loadConfig(tempDir);

      expect(config.notifications.webhooks).toHaveLength(1);
      expect(config.notifications.webhooks[0].type).toBe("discord");
      expect(config.notifications.webhooks[0].url).toBe("https://discord.com/api/webhooks/test");
      expect(config.notifications.webhooks[0].events).toEqual(["run_timeout"]);
    });
  });
});

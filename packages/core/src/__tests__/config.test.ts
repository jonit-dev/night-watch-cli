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

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Should not throw and return defaults
      const config = loadConfig(tempDir);
      const defaults = getDefaultConfig();

      expect(config.maxRuntime).toBe(defaults.maxRuntime);
      expect(warnSpy).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
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

    it("should return default templatesDir", () => {
      const config = loadConfig(tempDir);

      expect(config.templatesDir).toBe(".night-watch/templates");
    });

    it("should load templatesDir from config file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          templatesDir: "custom/templates",
        })
      );

      const config = loadConfig(tempDir);

      expect(config.templatesDir).toBe("custom/templates");
    });

    it("should handle NW_TEMPLATES_DIR env var", () => {
      process.env.NW_TEMPLATES_DIR = "env/templates";

      const config = loadConfig(tempDir);

      expect(config.templatesDir).toBe("env/templates");
    });

    it("should let NW_TEMPLATES_DIR env var override config file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          templatesDir: "file/templates",
        })
      );

      process.env.NW_TEMPLATES_DIR = "env/templates";

      const config = loadConfig(tempDir);

      expect(config.templatesDir).toBe("env/templates");
    });
  });

  describe("autoMerge config", () => {
    it("should default autoMerge to false", () => {
      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(false);
    });

    it("should default autoMergeMethod to squash", () => {
      const config = loadConfig(tempDir);

      expect(config.autoMergeMethod).toBe("squash");
    });

    it("should load autoMerge from config file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMerge: true,
        })
      );

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(true);
    });

    it("should load autoMergeMethod from config file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMergeMethod: "merge",
        })
      );

      const config = loadConfig(tempDir);

      expect(config.autoMergeMethod).toBe("merge");
    });

    it("should handle NW_AUTO_MERGE env var with true", () => {
      process.env.NW_AUTO_MERGE = "true";

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(true);
    });

    it("should handle NW_AUTO_MERGE env var with 1", () => {
      process.env.NW_AUTO_MERGE = "1";

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(true);
    });

    it("should handle NW_AUTO_MERGE env var with false", () => {
      // First set autoMerge to true in config file
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMerge: true,
        })
      );

      process.env.NW_AUTO_MERGE = "false";

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(false);
    });

    it("should handle NW_AUTO_MERGE_METHOD env var with valid values", () => {
      process.env.NW_AUTO_MERGE_METHOD = "rebase";

      const config = loadConfig(tempDir);

      expect(config.autoMergeMethod).toBe("rebase");
    });

    it("should reject invalid merge method from env var", () => {
      process.env.NW_AUTO_MERGE_METHOD = "invalid";

      const config = loadConfig(tempDir);

      // Should fallback to default
      expect(config.autoMergeMethod).toBe("squash");
    });

    it("should reject invalid merge method from config file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMergeMethod: "invalid",
        })
      );

      const config = loadConfig(tempDir);

      // Should fallback to default
      expect(config.autoMergeMethod).toBe("squash");
    });

    it("should let NW_AUTO_MERGE env var override config file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMerge: false,
        })
      );

      process.env.NW_AUTO_MERGE = "true";

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(true);
    });

    it("should let NW_AUTO_MERGE_METHOD env var override config file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMergeMethod: "merge",
        })
      );

      process.env.NW_AUTO_MERGE_METHOD = "rebase";

      const config = loadConfig(tempDir);

      expect(config.autoMergeMethod).toBe("rebase");
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

  describe("slicer config", () => {
    it("should load slicerSchedule from config file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          roadmapScanner: {
            enabled: true,
            slicerSchedule: "0 */4 * * *",
          },
        })
      );

      const config = loadConfig(tempDir);

      expect(config.roadmapScanner.slicerSchedule).toBe("0 */4 * * *");
    });

    it("should use default slicerMaxRuntime", () => {
      const config = loadConfig(tempDir);

      expect(config.roadmapScanner.slicerMaxRuntime).toBe(600);
    });

    it("should override slicerSchedule from env", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          roadmapScanner: {
            enabled: true,
            slicerSchedule: "0 */4 * * *",
          },
        })
      );

      const envValue = "0 */2 * * *";
      process.env.NW_SLICER_SCHEDULE = envValue;

      const config = loadConfig(tempDir);

      expect(config.roadmapScanner.slicerSchedule).toBe(envValue);
    });
  });

  describe("autoMerge config", () => {
    it("should default autoMerge to false", () => {
      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(false);
    });

    it("should default autoMergeMethod to squash", () => {
      const config = loadConfig(tempDir);

      expect(config.autoMergeMethod).toBe("squash");
    });

    it("should load autoMerge from config file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMerge: true,
        })
      );

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(true);
    });

    it("should load autoMergeMethod from config file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMergeMethod: "rebase",
        })
      );

      const config = loadConfig(tempDir);

      expect(config.autoMergeMethod).toBe("rebase");
    });

    it("should handle NW_AUTO_MERGE env var", () => {
      process.env.NW_AUTO_MERGE = "true";

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(true);
    });

    it("should handle NW_AUTO_MERGE env var with '1' value", () => {
      process.env.NW_AUTO_MERGE = "1";

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(true);
    });

    it("should handle NW_AUTO_MERGE env var with '0' value", () => {
      // First set autoMerge to true in config file
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMerge: true,
        })
      );

      process.env.NW_AUTO_MERGE = "0";

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(false);
    });

    it("should handle NW_AUTO_MERGE_METHOD env var", () => {
      process.env.NW_AUTO_MERGE_METHOD = "merge";

      const config = loadConfig(tempDir);

      expect(config.autoMergeMethod).toBe("merge");
    });

    it("should reject invalid merge method", () => {
      process.env.NW_AUTO_MERGE_METHOD = "invalid";

      const config = loadConfig(tempDir);

      // Should fall back to default
      expect(config.autoMergeMethod).toBe("squash");
    });

    it("should let NW_AUTO_MERGE env var override config file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMerge: false,
        })
      );

      process.env.NW_AUTO_MERGE = "true";

      const config = loadConfig(tempDir);

      expect(config.autoMerge).toBe(true);
    });

    it("should let NW_AUTO_MERGE_METHOD env var override config file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          autoMergeMethod: "squash",
        })
      );

      process.env.NW_AUTO_MERGE_METHOD = "rebase";

      const config = loadConfig(tempDir);

      expect(config.autoMergeMethod).toBe("rebase");
    });

    it("should accept all valid merge methods", () => {
      const validMethods = ["squash", "merge", "rebase"] as const;

      for (const method of validMethods) {
        const configPath = path.join(tempDir, "night-watch.config.json");
        fs.writeFileSync(
          configPath,
          JSON.stringify({
            autoMergeMethod: method,
          })
        );

        const config = loadConfig(tempDir);
        expect(config.autoMergeMethod).toBe(method);
      }
    });
  });

  describe("qa config", () => {
    it("should load QA defaults when no qa config present", () => {
      const config = loadConfig(tempDir);

      expect(config.qa).toBeDefined();
      expect(config.qa.enabled).toBe(true);
      expect(config.qa.schedule).toBe("30 1,7,13,19 * * *");
      expect(config.qa.maxRuntime).toBe(3600);
      expect(config.qa.branchPatterns).toEqual([]);
      expect(config.qa.artifacts).toBe("both");
      expect(config.qa.skipLabel).toBe("skip-qa");
      expect(config.qa.autoInstallPlaywright).toBe(true);
    });

    it("should load QA config from file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          qa: {
            enabled: false,
            schedule: "0 */4 * * *",
            maxRuntime: 1800,
            artifacts: "screenshot",
            skipLabel: "no-qa",
            autoInstallPlaywright: false,
          },
        })
      );

      const config = loadConfig(tempDir);

      expect(config.qa.enabled).toBe(false);
      expect(config.qa.schedule).toBe("0 */4 * * *");
      expect(config.qa.maxRuntime).toBe(1800);
      expect(config.qa.artifacts).toBe("screenshot");
      expect(config.qa.skipLabel).toBe("no-qa");
      expect(config.qa.autoInstallPlaywright).toBe(false);
    });

    it("should override QA config from env vars", () => {
      process.env.NW_QA_ENABLED = "false";

      const config = loadConfig(tempDir);

      expect(config.qa.enabled).toBe(false);
    });

    it("should override QA schedule from env var", () => {
      process.env.NW_QA_SCHEDULE = "0 */2 * * *";

      const config = loadConfig(tempDir);

      expect(config.qa.schedule).toBe("0 */2 * * *");
    });

    it("should override QA max runtime from env var", () => {
      process.env.NW_QA_MAX_RUNTIME = "7200";

      const config = loadConfig(tempDir);

      expect(config.qa.maxRuntime).toBe(7200);
    });

    it("should override QA artifacts from env var", () => {
      process.env.NW_QA_ARTIFACTS = "video";

      const config = loadConfig(tempDir);

      expect(config.qa.artifacts).toBe("video");
    });

    it("should override QA skip label from env var", () => {
      process.env.NW_QA_SKIP_LABEL = "no-tests";

      const config = loadConfig(tempDir);

      expect(config.qa.skipLabel).toBe("no-tests");
    });

    it("should override QA auto install playwright from env var", () => {
      process.env.NW_QA_AUTO_INSTALL_PLAYWRIGHT = "false";

      const config = loadConfig(tempDir);

      expect(config.qa.autoInstallPlaywright).toBe(false);
    });

    it("should override qa.branchPatterns from NW_QA_BRANCH_PATTERNS env var", () => {
      process.env.NW_QA_BRANCH_PATTERNS = "qa/,test/";

      const config = loadConfig(tempDir);

      expect(config.qa.branchPatterns).toEqual(["qa/", "test/"]);
    });

    it("should let env vars override QA config from file", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          qa: {
            enabled: true,
            schedule: "0 */4 * * *",
          },
        })
      );

      process.env.NW_QA_ENABLED = "false";

      const config = loadConfig(tempDir);

      expect(config.qa.enabled).toBe(false);
    });

    it("should preserve file QA fields when only one QA env var is provided", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          qa: {
            enabled: false,
            schedule: "5 * * * *",
            maxRuntime: 900,
            branchPatterns: ["custom/"],
            artifacts: "video",
            skipLabel: "custom-skip",
            autoInstallPlaywright: false,
          },
        })
      );

      process.env.NW_QA_BRANCH_PATTERNS = "qa/";

      const config = loadConfig(tempDir);

      expect(config.qa.enabled).toBe(false);
      expect(config.qa.schedule).toBe("5 * * * *");
      expect(config.qa.maxRuntime).toBe(900);
      expect(config.qa.artifacts).toBe("video");
      expect(config.qa.skipLabel).toBe("custom-skip");
      expect(config.qa.autoInstallPlaywright).toBe(false);
      expect(config.qa.branchPatterns).toEqual(["qa/"]);
    });

    it("should fall back to default QA artifacts when config has invalid value", () => {
      const configPath = path.join(tempDir, "night-watch.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          qa: {
            artifacts: "invalid-artifacts-mode",
          },
        })
      );

      const config = loadConfig(tempDir);

      expect(config.qa.artifacts).toBe("both");
    });
  });
});

/**
 * Doctor command for Night Watch CLI
 * Validates webhook configuration and checks system health
 */

import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { loadConfig } from "../config.js";
import { IWebhookConfig } from "../types.js";
import {
  header,
  info,
  step,
  success,
  error as uiError,
  warn,
} from "../utils/ui.js";

/**
 * Validate a single webhook configuration and return a list of issues.
 * Returns an empty array if the webhook is valid.
 */
export function validateWebhook(webhook: IWebhookConfig): string[] {
  const issues: string[] = [];

  // Validate events
  if (!webhook.events || webhook.events.length === 0) {
    issues.push("No events configured");
  } else {
    const validEvents = [
      "run_succeeded",
      "run_failed",
      "run_timeout",
      "review_completed",
    ];
    for (const event of webhook.events) {
      if (!validEvents.includes(event)) {
        issues.push(`Invalid event: ${event}`);
      }
    }
  }

  // Platform-specific validation
  switch (webhook.type) {
    case "slack":
      if (!webhook.url) {
        issues.push("Missing URL");
      } else if (!webhook.url.startsWith("https://hooks.slack.com/")) {
        issues.push("URL should start with https://hooks.slack.com/");
      }
      break;
    case "discord":
      if (!webhook.url) {
        issues.push("Missing URL");
      } else if (
        !webhook.url.startsWith("https://discord.com/api/webhooks/")
      ) {
        issues.push("URL should start with https://discord.com/api/webhooks/");
      }
      break;
    case "telegram":
      if (!webhook.botToken) {
        issues.push("Missing botToken");
      }
      if (!webhook.chatId) {
        issues.push("Missing chatId");
      }
      break;
    default:
      issues.push(`Unknown webhook type: ${webhook.type}`);
  }

  return issues;
}

/**
 * Register the doctor command on the program
 */
export function doctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check Night Watch configuration and system health")
    .action(async () => {
      const projectDir = process.cwd();
      let hasErrors = false;

      header("Night Watch Doctor");

      // Check 1: Git repository
      step(1, 5, "Checking git repository...");
      try {
        execSync("git rev-parse --is-inside-work-tree", {
          cwd: projectDir,
          stdio: "pipe",
        });
        success("Git repository detected");
      } catch {
        uiError("Not a git repository");
        hasErrors = true;
      }

      // Check 2: GitHub CLI
      step(2, 5, "Checking GitHub CLI...");
      try {
        execSync("gh auth status", { stdio: "pipe" });
        success("GitHub CLI authenticated");
      } catch {
        warn("GitHub CLI not authenticated (run: gh auth login)");
      }

      // Check 3: Provider CLI
      step(3, 5, "Checking provider CLI...");
      const config = loadConfig(projectDir);
      try {
        execSync(`which ${config.provider}`, { stdio: "pipe" });
        success(`Provider CLI found: ${config.provider}`);
      } catch {
        uiError(`Provider CLI not found: ${config.provider}`);
        hasErrors = true;
      }

      // Check 4: PRD directory
      step(4, 5, "Checking PRD directory...");
      const prdDir = path.join(projectDir, config.prdDir);
      if (fs.existsSync(prdDir)) {
        const prds = fs
          .readdirSync(prdDir)
          .filter(
            (f) => f.endsWith(".md") && f !== "NIGHT-WATCH-SUMMARY.md"
          );
        success(`PRD directory found (${prds.length} PRDs)`);
      } else {
        warn(
          `PRD directory not found: ${config.prdDir} (run: night-watch init)`
        );
      }

      // Check 5: Webhook configuration
      step(5, 5, "Checking webhook configuration...");
      if (
        !config.notifications ||
        config.notifications.webhooks.length === 0
      ) {
        info("No webhooks configured (optional)");
      } else {
        let webhookErrors = 0;
        for (const webhook of config.notifications.webhooks) {
          const issues = validateWebhook(webhook);
          if (issues.length === 0) {
            success(`${webhook.type} webhook: OK`);
          } else {
            for (const issue of issues) {
              warn(`${webhook.type} webhook: ${issue}`);
            }
            webhookErrors++;
          }
        }
        if (webhookErrors === 0) {
          success(
            `All ${config.notifications.webhooks.length} webhook(s) valid`
          );
        }
      }

      // Summary
      console.log();
      if (hasErrors) {
        uiError(
          "Issues found — fix errors above before running Night Watch"
        );
        process.exit(1);
      } else {
        success("All checks passed");
      }
    });
}

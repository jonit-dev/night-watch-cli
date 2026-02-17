/**
 * Shared validation utilities for Night Watch CLI
 * Used by init, doctor, and other commands that need to verify environment
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { Provider } from "../types.js";
import { CONFIG_FILE_NAME, LOG_DIR, VALID_PROVIDERS } from "../constants.js";

/**
 * Result of an environment check
 */
export interface ICheckResult {
  passed: boolean;
  message: string;
  fixable: boolean;
  fix?: () => void;
}

/**
 * Check if directory is a git repository
 */
export function checkGitRepo(cwd: string): ICheckResult {
  const isRepo = fs.existsSync(path.join(cwd, ".git"));
  return {
    passed: isRepo,
    message: isRepo ? "Git repository found" : "Not a git repository",
    fixable: false,
  };
}

/**
 * Check if GitHub CLI is authenticated
 */
export function checkGhCli(): ICheckResult {
  try {
    execSync("gh auth status", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      passed: true,
      message: "GitHub CLI authenticated",
      fixable: false,
    };
  } catch {
    return {
      passed: false,
      message: "GitHub CLI not authenticated (run: gh auth login)",
      fixable: false,
    };
  }
}

/**
 * Check if a specific provider CLI is available
 */
export function checkProviderCli(provider: Provider): ICheckResult {
  try {
    execSync(`which ${provider}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      passed: true,
      message: `Provider CLI found: ${provider}`,
      fixable: false,
    };
  } catch {
    return {
      passed: false,
      message: `Provider CLI not found: ${provider}`,
      fixable: false,
    };
  }
}

/**
 * Detect which AI provider CLIs are installed
 */
export function detectProviders(): Provider[] {
  const providers: Provider[] = [];
  for (const provider of VALID_PROVIDERS) {
    try {
      execSync(`which ${provider}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      providers.push(provider);
    } catch {
      // Provider not available
    }
  }
  return providers;
}

/**
 * Check if Node.js version meets minimum requirement
 */
export function checkNodeVersion(minMajor: number): ICheckResult {
  const nodeVersion = process.version;
  const match = nodeVersion.match(/^v?(\d+)/);

  if (!match) {
    return {
      passed: false,
      message: `Could not determine Node.js version (got: ${nodeVersion})`,
      fixable: false,
    };
  }

  const major = parseInt(match[1], 10);
  const passed = major >= minMajor;

  return {
    passed,
    message: passed
      ? `Node.js version ${nodeVersion} (>= ${minMajor}.0.0)`
      : `Node.js version ${nodeVersion} is too old (minimum: ${minMajor}.0.0)`,
    fixable: false,
  };
}

/**
 * Check if config file exists and is valid JSON
 */
export function checkConfigFile(projectDir: string): ICheckResult {
  const configPath = path.join(projectDir, CONFIG_FILE_NAME);

  if (!fs.existsSync(configPath)) {
    return {
      passed: false,
      message: `Config file not found: ${CONFIG_FILE_NAME} (run: night-watch init)`,
      fixable: false,
    };
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    JSON.parse(content);
    return {
      passed: true,
      message: `Config file valid: ${CONFIG_FILE_NAME}`,
      fixable: false,
    };
  } catch (err) {
    const errorMsg =
      err instanceof Error ? err.message : String(err);
    return {
      passed: false,
      message: `Config file has invalid JSON: ${errorMsg}`,
      fixable: false,
    };
  }
}

/**
 * Check if PRD directory exists
 */
export function checkPrdDirectory(
  projectDir: string,
  prdDir: string
): ICheckResult {
  const prdPath = path.join(projectDir, prdDir);

  if (!fs.existsSync(prdPath)) {
    return {
      passed: false,
      message: `PRD directory not found: ${prdDir}`,
      fixable: true,
      fix: () => {
        fs.mkdirSync(prdPath, { recursive: true });
        // Also create the done subdirectory
        fs.mkdirSync(path.join(prdPath, "done"), { recursive: true });
      },
    };
  }

  // Count PRD files (exclude summary and files in done/)
  const prds = fs
    .readdirSync(prdPath)
    .filter((f) => f.endsWith(".md") && f !== "NIGHT-WATCH-SUMMARY.md");

  return {
    passed: true,
    message: `PRD directory found: ${prdDir} (${prds.length} PRDs)`,
    fixable: false,
  };
}

/**
 * Check if logs directory exists
 */
export function checkLogsDirectory(projectDir: string): ICheckResult {
  const logsPath = path.join(projectDir, LOG_DIR);

  if (!fs.existsSync(logsPath)) {
    return {
      passed: false,
      message: `Logs directory not found: ${LOG_DIR}`,
      fixable: true,
      fix: () => {
        fs.mkdirSync(logsPath, { recursive: true });
      },
    };
  }

  return {
    passed: true,
    message: `Logs directory found: ${LOG_DIR}`,
    fixable: false,
  };
}

/**
 * Check if crontab is accessible
 */
export function checkCrontabAccess(): ICheckResult {
  try {
    execSync("crontab -l", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      passed: true,
      message: "Crontab accessible",
      fixable: false,
    };
  } catch {
    // crontab -l returns error if no crontab exists, but that's still "accessible"
    // We check if the error is about access or just "no crontab"
    return {
      passed: true,
      message: "Crontab accessible (empty)",
      fixable: false,
    };
  }
}

/**
 * Run all environment checks and return results
 */
export function runAllChecks(
  projectDir: string,
  prdDir: string
): ICheckResult[] {
  const results: ICheckResult[] = [];

  // Check Node version
  results.push(checkNodeVersion(18));

  // Check git repo
  results.push(checkGitRepo(projectDir));

  // Check GitHub CLI
  results.push(checkGhCli());

  // Check provider CLIs
  const providers = detectProviders();
  if (providers.length === 0) {
    results.push({
      passed: false,
      message: "No AI provider CLI found (install claude or codex)",
      fixable: false,
    });
  } else {
    for (const provider of providers) {
      results.push(checkProviderCli(provider));
    }
  }

  // Check config file
  results.push(checkConfigFile(projectDir));

  // Check PRD directory
  results.push(checkPrdDirectory(projectDir, prdDir));

  // Check logs directory
  results.push(checkLogsDirectory(projectDir));

  // Check crontab access
  results.push(checkCrontabAccess());

  return results;
}

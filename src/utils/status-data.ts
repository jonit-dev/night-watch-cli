/**
 * Status data layer for Night Watch CLI
 * Provides data-fetching functions used by both the status command and the dashboard TUI.
 */

import { createHash } from "crypto";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { CLAIM_FILE_EXTENSION, LOCK_FILE_PREFIX, LOG_DIR, LOG_FILE_NAMES } from "../constants.js";
import { getPrdStatesForProject } from "./prd-states.js";
import { INightWatchConfig } from "../types.js";
import { generateMarker, getEntries, getProjectEntries } from "./crontab.js";

/**
 * Information about a single PRD file
 */
export interface IPrdInfo {
  name: string;
  status: "ready" | "blocked" | "in-progress" | "pending-review" | "done";
  dependencies: string[];
  unmetDependencies: string[];
}

/**
 * Information about a running process
 */
export interface IProcessInfo {
  name: string;
  running: boolean;
  pid: number | null;
}

/**
 * Information about a pull request
 */
export interface IPrInfo {
  number: number;
  title: string;
  branch: string;
  url: string;
  ciStatus: "pass" | "fail" | "pending" | "unknown";
  reviewScore: number | null;
}

/**
 * Information about a log file
 */
export interface ILogInfo {
  name: string;
  path: string;
  exists: boolean;
  size: number;
  lastLines: string[];
}

/**
 * Complete status snapshot of the project
 */
export interface IStatusSnapshot {
  projectName: string;
  projectDir: string;
  config: INightWatchConfig;
  prds: IPrdInfo[];
  processes: IProcessInfo[];
  prs: IPrInfo[];
  logs: ILogInfo[];
  crontab: { installed: boolean; entries: string[] };
  activePrd: string | null;
  timestamp: Date;
}

/**
 * Get the project name from directory or package.json
 */
export function getProjectName(projectDir: string): string {
  const packageJsonPath = path.join(projectDir, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      if (packageJson.name) {
        return packageJson.name;
      }
    } catch {
      // Ignore parse errors
    }
  }

  return path.basename(projectDir);
}

/**
 * Compute the runtime key for a project directory.
 * Must stay in sync with project_runtime_key() in night-watch-helpers.sh.
 */
export function projectRuntimeKey(projectDir: string): string {
  const projectName = path.basename(projectDir);
  const hash = createHash("sha1").update(projectDir).digest("hex").slice(0, 12);
  return `${projectName}-${hash}`;
}

/**
 * Compute the lock file path for the executor of a given project directory.
 */
export function executorLockPath(projectDir: string): string {
  return `${LOCK_FILE_PREFIX}${projectRuntimeKey(projectDir)}.lock`;
}

/**
 * Compute the lock file path for the reviewer of a given project directory.
 */
export function reviewerLockPath(projectDir: string): string {
  return `${LOCK_FILE_PREFIX}pr-reviewer-${projectRuntimeKey(projectDir)}.lock`;
}

/**
 * Check if a process with the given PID is running
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read PID from lock file and check if process is running
 */
export function checkLockFile(lockPath: string): { running: boolean; pid: number | null } {
  if (!fs.existsSync(lockPath)) {
    return { running: false, pid: null };
  }

  try {
    const pidStr = fs.readFileSync(lockPath, "utf-8").trim();
    const pid = parseInt(pidStr, 10);

    if (isNaN(pid)) {
      return { running: false, pid: null };
    }

    return {
      running: isProcessRunning(pid),
      pid,
    };
  } catch {
    return { running: false, pid: null };
  }
}

/**
 * Count PRDs in the PRD directory and return counts
 */
export function countPRDs(
  projectDir: string,
  prdDir: string,
  maxRuntime: number
): { pending: number; claimed: number; done: number } {
  const fullPrdPath = path.join(projectDir, prdDir);

  if (!fs.existsSync(fullPrdPath)) {
    return { pending: 0, claimed: 0, done: 0 };
  }

  let pending = 0;
  let claimed = 0;
  let done = 0;

  const countInDir = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === "done") {
          try {
            const doneEntries = fs.readdirSync(fullPath);
            done += doneEntries.filter((e) => e.endsWith(".md")).length;
          } catch {
            // Ignore errors
          }
        } else {
          countInDir(fullPath);
        }
      } else if (entry.name.endsWith(".md")) {
        const claimPath = path.join(dir, entry.name + CLAIM_FILE_EXTENSION);
        if (fs.existsSync(claimPath)) {
          try {
            const content = fs.readFileSync(claimPath, "utf-8");
            const claimData = JSON.parse(content);
            const age = Math.floor(Date.now() / 1000) - claimData.timestamp;
            if (age < maxRuntime) {
              claimed++;
            } else {
              pending++;
            }
          } catch {
            pending++;
          }
        } else {
          pending++;
        }
      }
    }
  };

  try {
    countInDir(fullPrdPath);
  } catch {
    // Ignore errors
  }

  return { pending, claimed, done };
}

/**
 * Parse dependency references from a PRD file.
 * Looks for a line matching "depends on: `name1`, `name2`" (case-insensitive).
 */
export function parsePrdDependencies(prdPath: string): string[] {
  try {
    const content = fs.readFileSync(prdPath, "utf-8");
    // Match "Depends on:" with optional bold markdown, capture rest of line
    const match = content.match(/(?:\*\*)?Depends on:(?:\*\*)?[^\S\n]*([^\n]*)/i);
    if (!match) return [];
    return match[1]
      .split(",")
      .map((d) => d.replace(/`/g, "").replace(/\*\*/g, "").replace(/\|/g, "").trim())
      .filter((d) => d.length > 0);
  } catch {
    return [];
  }
}

/**
 * Collect PRD info items from the PRD directory
 * Cross-validates claim files with executor lock to avoid stale "in-progress" status
 */
export function collectPrdInfo(
  projectDir: string,
  prdDir: string,
  maxRuntime: number
): IPrdInfo[] {
  const fullPrdPath = path.join(projectDir, prdDir);
  const prds: IPrdInfo[] = [];

  if (!fs.existsSync(fullPrdPath)) {
    return prds;
  }

  // Pre-check executor lock for cross-validation
  const lockPath = executorLockPath(projectDir);
  const executorLock = checkLockFile(lockPath);

  // Track orphaned claim files to clean up
  const orphanedClaimFiles: string[] = [];

  const collectInDir = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === "done") {
          try {
            const doneEntries = fs.readdirSync(fullPath);
            for (const doneEntry of doneEntries) {
              if (doneEntry.endsWith(".md")) {
                prds.push({
                  name: doneEntry.replace(/\.md$/, ""),
                  status: "done",
                  dependencies: [],
                  unmetDependencies: [],
                });
              }
            }
          } catch {
            // Ignore errors
          }
        } else {
          collectInDir(fullPath);
        }
      } else if (entry.name.endsWith(".md")) {
        const claimPath = path.join(dir, entry.name + CLAIM_FILE_EXTENSION);
        let status: IPrdInfo["status"] = "ready";

        if (fs.existsSync(claimPath)) {
          try {
            const content = fs.readFileSync(claimPath, "utf-8");
            const claimData = JSON.parse(content);
            const age = Math.floor(Date.now() / 1000) - claimData.timestamp;
            if (age < maxRuntime) {
              // Cross-check: verify executor lock exists and is running
              if (executorLock.running) {
                status = "in-progress";
              } else {
                // Claim is fresh but executor is not running - stale/orphaned claim
                status = "ready";
                orphanedClaimFiles.push(claimPath);
              }
            }
            // else: stale claim (too old) — status stays "ready"
          } catch {
            status = "ready";
          }
        }

        const dependencies = parsePrdDependencies(fullPath);

        prds.push({
          name: entry.name.replace(/\.md$/, ""),
          status,
          dependencies,
          unmetDependencies: [],
        });
      }
    }
  };

  collectInDir(fullPrdPath);

  // Clean up orphaned claim files
  for (const claimFile of orphanedClaimFiles) {
    try {
      fs.unlinkSync(claimFile);
    } catch {
      // Ignore errors during cleanup
    }
  }

  // Overlay pending-review state from ~/.night-watch/prd-states.json
  // PRD files stay in place; state is tracked separately
  const prdStates = getPrdStatesForProject(projectDir);
  for (const prd of prds) {
    if (prdStates[prd.name]?.status === "pending-review" && prd.status !== "done" && prd.status !== "in-progress") {
      prd.status = "pending-review";
    }
  }

  // Compute unmet dependencies: a dependency is unmet if there's no "done" PRD with that name
  const doneNames = new Set(prds.filter((p) => p.status === "done").map((p) => p.name));
  for (const prd of prds) {
    if (prd.dependencies.length > 0) {
      prd.unmetDependencies = prd.dependencies.filter(
        (dep) => !doneNames.has(dep) && !doneNames.has(dep.replace(/\.md$/, ""))
      );
      // Mark PRDs with unmet dependencies as blocked (unless already done or in-progress)
      if (prd.unmetDependencies.length > 0 && prd.status === "ready") {
        prd.status = "blocked";
      }
    }
  }

  return prds;
}

/**
 * Count open PRs on night-watch/ or feat/ branches using gh CLI
 */
export function countOpenPRs(projectDir: string, branchPatterns: string[]): number {
  try {
    execSync("git rev-parse --git-dir", {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      execSync("which gh", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      return 0;
    }

    const output = execSync("gh pr list --state open --json headRefName,number", {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const prs = JSON.parse(output);
    const matchingPRs = prs.filter((pr: { headRefName: string }) =>
      branchPatterns.some((pattern) => pr.headRefName.startsWith(pattern))
    );

    return matchingPRs.length;
  } catch {
    return 0;
  }
}

/**
 * Derive CI status from gh statusCheckRollup data
 * Supports both CheckRun (status: "COMPLETED", "IN_PROGRESS", etc.)
 * and StatusContext (state: "SUCCESS", "FAILURE", "PENDING", etc.) types
 *
 * Status derivation priority:
 * 1. If any check has FAILURE, ERROR, CANCELLED, or TIMED_OUT conclusion → "fail"
 * 2. If all checks have SUCCESS or NEUTRAL conclusion → "pass"
 * 3. If any check has IN_PROGRESS, QUEUED, or PENDING status → "pending"
 * 4. Otherwise → "unknown"
 */
function deriveCiStatus(
  checks?: Array<{ conclusion?: string | null; status?: string | null; state?: string | null }> | null
): IPrInfo["ciStatus"] {
  // Handle null, undefined, or empty array
  if (!checks || !Array.isArray(checks) || checks.length === 0) {
    if (process.env.DEBUG_PR_DATA === "1") {
      console.log("[DEBUG] deriveCiStatus: No checks available, returning 'unknown'");
    }
    return "unknown";
  }

  if (process.env.DEBUG_PR_DATA === "1") {
    console.log("[DEBUG] deriveCiStatus: Processing", checks.length, "checks");
    console.log("[DEBUG] deriveCiStatus: checks =", JSON.stringify(checks, null, 2));
  }

  // Normalize check data - handle both CheckRun and StatusContext formats
  const normalizedChecks = checks.map((c) => ({
    conclusion: c.conclusion?.toUpperCase() ?? null,
    status: c.status?.toUpperCase() ?? null,
    state: c.state?.toUpperCase() ?? null,
  }));

  // Check for failures in CheckRun conclusion or StatusContext state
  // FAILURE, ERROR, CANCELLED, TIMED_OUT all count as failures
  const hasFailure = normalizedChecks.some((c) => {
    const failConclusions = ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"];
    const failStates = ["FAILURE", "ERROR"];
    return (
      (c.conclusion !== null && failConclusions.includes(c.conclusion)) ||
      (c.state !== null && failStates.includes(c.state))
    );
  });
  if (hasFailure) {
    if (process.env.DEBUG_PR_DATA === "1") {
      console.log("[DEBUG] deriveCiStatus: Found failure, returning 'fail'");
    }
    return "fail";
  }

  // Check if any checks are still pending/in-progress
  const hasPending = normalizedChecks.some((c) => {
    const pendingStatuses = ["IN_PROGRESS", "QUEUED", "PENDING", "WAITING", "REQUESTED"];
    const pendingStates = ["PENDING", "IN_PROGRESS"];
    return (
      (c.status !== null && pendingStatuses.includes(c.status)) ||
      (c.state !== null && pendingStates.includes(c.state))
    );
  });
  if (hasPending) {
    if (process.env.DEBUG_PR_DATA === "1") {
      console.log("[DEBUG] deriveCiStatus: Found pending checks, returning 'pending'");
    }
    return "pending";
  }

  // Check if all checks are complete (success or neutral)
  const allComplete = normalizedChecks.every((c) => {
    const completeConclusions = ["SUCCESS", "NEUTRAL", "SKIPPED"];
    const completeStatuses = ["COMPLETED"];
    const completeStates = ["SUCCESS"];

    // If there's a conclusion and it's a success/neutral state
    if (c.conclusion !== null && completeConclusions.includes(c.conclusion)) {
      return true;
    }
    // If there's a status and it's completed
    if (c.status !== null && completeStatuses.includes(c.status)) {
      return true;
    }
    // If there's a state and it's success
    if (c.state !== null && completeStates.includes(c.state)) {
      return true;
    }
    return false;
  });
  if (allComplete) {
    if (process.env.DEBUG_PR_DATA === "1") {
      console.log("[DEBUG] deriveCiStatus: All checks complete, returning 'pass'");
    }
    return "pass";
  }

  // Default to unknown if we can't determine status
  if (process.env.DEBUG_PR_DATA === "1") {
    console.log("[DEBUG] deriveCiStatus: Could not determine status, returning 'unknown'");
  }
  return "unknown";
}

/**
 * Derive review score from gh reviewDecision field
 * Maps GitHub review decisions to a numeric score (0-100)
 * Returns null if no review has been submitted or review is required
 *
 * GitHub reviewDecision values:
 * - "APPROVED" — PR has been approved by required reviewers → 100
 * - "CHANGES_REQUESTED" — Reviewer requested changes → 0
 * - "REVIEW_REQUIRED" — PR requires review but hasn't been reviewed yet → null
 * - "" / null / undefined — No review required or not yet reviewed → null
 */
function deriveReviewScore(reviewDecision?: string | null): number | null {
  // Handle null, undefined, or empty string (meaning no review yet)
  if (reviewDecision === null || reviewDecision === undefined || reviewDecision === "") {
    if (process.env.DEBUG_PR_DATA === "1") {
      console.log("[DEBUG] deriveReviewScore: No review decision, returning null");
    }
    return null;
  }

  const normalizedDecision = reviewDecision.toUpperCase();

  if (process.env.DEBUG_PR_DATA === "1") {
    console.log("[DEBUG] deriveReviewScore: reviewDecision =", reviewDecision, "-> normalized:", normalizedDecision);
  }

  switch (normalizedDecision) {
    case "APPROVED":
      return 100;
    case "CHANGES_REQUESTED":
      return 0;
    case "REVIEW_REQUIRED":
      return null;
    default:
      // Handle any unknown values gracefully
      if (process.env.DEBUG_PR_DATA === "1") {
        console.log("[DEBUG] deriveReviewScore: Unknown review decision:", reviewDecision);
      }
      return null;
  }
}

/**
 * Collect open PR info using gh CLI
 */
export function collectPrInfo(projectDir: string, branchPatterns: string[]): IPrInfo[] {
  try {
    execSync("git rev-parse --git-dir", {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      execSync("which gh", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      return [];
    }

    const output = execSync(
      "gh pr list --state open --json headRefName,number,title,url,statusCheckRollup,reviewDecision",
      {
        cwd: projectDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    if (process.env.DEBUG_PR_DATA === "1") {
      console.log("[DEBUG] collectPrInfo: Raw gh output:", output);
    }

    interface IGhPr {
      number: number;
      title: string;
      headRefName: string;
      url: string;
      statusCheckRollup?: Array<{
        conclusion?: string | null;
        status?: string | null;
        state?: string | null;
      }> | null;
      reviewDecision?: string | null;
    }

    const prs: IGhPr[] = JSON.parse(output);

    if (process.env.DEBUG_PR_DATA === "1") {
      console.log("[DEBUG] collectPrInfo: Parsed", prs.length, "PRs from gh CLI");
    }

    return prs
      .filter((pr) => {
        const matches = branchPatterns.some((pattern) => pr.headRefName.startsWith(pattern));
        if (process.env.DEBUG_PR_DATA === "1" && !matches) {
          console.log("[DEBUG] collectPrInfo: Filtering out PR #" + pr.number + " (" + pr.headRefName + ") - doesn't match branch patterns");
        }
        return matches;
      })
      .map((pr) => {
        if (process.env.DEBUG_PR_DATA === "1") {
          console.log("[DEBUG] collectPrInfo: Processing PR #" + pr.number);
          console.log("[DEBUG] collectPrInfo:   statusCheckRollup:", JSON.stringify(pr.statusCheckRollup));
          console.log("[DEBUG] collectPrInfo:   reviewDecision:", JSON.stringify(pr.reviewDecision));
        }
        const result = {
          number: pr.number,
          title: pr.title,
          branch: pr.headRefName,
          url: pr.url,
          ciStatus: deriveCiStatus(pr.statusCheckRollup),
          reviewScore: deriveReviewScore(pr.reviewDecision),
        };
        if (process.env.DEBUG_PR_DATA === "1") {
          console.log("[DEBUG] collectPrInfo:   -> ciStatus:", result.ciStatus, ", reviewScore:", result.reviewScore);
        }
        return result;
      });
  } catch (error) {
    if (process.env.DEBUG_PR_DATA === "1") {
      console.log("[DEBUG] collectPrInfo: Error:", error instanceof Error ? error.message : String(error));
    }
    return [];
  }
}

/**
 * Get last N lines from a log file
 */
export function getLastLogLines(logPath: string, lines: number): string[] {
  if (!fs.existsSync(logPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(logPath, "utf-8");
    const allLines = content.trim().split("\n");
    return allLines.slice(-lines);
  } catch {
    return [];
  }
}

/**
 * Get log file info
 */
export function getLogInfo(
  logPath: string,
  lastLines: number = 5
): { path: string; lastLines: string[]; exists: boolean; size: number } {
  const exists = fs.existsSync(logPath);
  return {
    path: logPath,
    lastLines: exists ? getLastLogLines(logPath, lastLines) : [],
    exists,
    size: exists ? fs.statSync(logPath).size : 0,
  };
}

/**
 * Collect log info as ILogInfo items
 */
export function collectLogInfo(projectDir: string): ILogInfo[] {
  const logNames = ["executor", "reviewer"];
  return logNames.map((name) => {
    // Map logical name (executor/reviewer) to actual file name (night-watch/night-watch-pr-reviewer)
    const fileName = LOG_FILE_NAMES[name] || name;
    const logPath = path.join(projectDir, LOG_DIR, `${fileName}.log`);
    const exists = fs.existsSync(logPath);
    return {
      name,
      path: logPath,
      exists,
      size: exists ? fs.statSync(logPath).size : 0,
      lastLines: exists ? getLastLogLines(logPath, 5) : [],
    };
  });
}

/**
 * Get crontab information for a project
 */
export function getCrontabInfo(
  projectName: string,
  projectDir: string
): { installed: boolean; entries: string[] } {
  const marker = generateMarker(projectName);
  const crontabEntries = Array.from(
    new Set([...getEntries(marker), ...getProjectEntries(projectDir)])
  );
  return {
    installed: crontabEntries.length > 0,
    entries: crontabEntries,
  };
}

/**
 * Fetch a complete status snapshot for the given project
 */
export function fetchStatusSnapshot(
  projectDir: string,
  config: INightWatchConfig
): IStatusSnapshot {
  const projectName = getProjectName(projectDir);

  const executorLock = checkLockFile(executorLockPath(projectDir));
  const reviewerLock = checkLockFile(reviewerLockPath(projectDir));

  const processes: IProcessInfo[] = [
    { name: "executor", running: executorLock.running, pid: executorLock.pid },
    { name: "reviewer", running: reviewerLock.running, pid: reviewerLock.pid },
  ];

  const prds = collectPrdInfo(projectDir, config.prdDir, config.maxRuntime);
  const prs = collectPrInfo(projectDir, config.branchPatterns);
  const logs = collectLogInfo(projectDir);
  const crontab = getCrontabInfo(projectName, projectDir);

  // Find any PRD with a fresh, lock-corroborated in-progress status
  const activePrd = prds.find((p) => p.status === "in-progress")?.name ?? null;

  return {
    projectName,
    projectDir,
    config,
    prds,
    processes,
    prs,
    logs,
    crontab,
    activePrd,
    timestamp: new Date(),
  };
}

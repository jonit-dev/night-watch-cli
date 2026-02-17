/**
 * Status data layer for Night Watch CLI
 * Provides data-fetching functions used by both the status command and the dashboard TUI.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { CLAIM_FILE_EXTENSION, LOCK_FILE_PREFIX, LOG_DIR } from "../constants.js";
import { INightWatchConfig } from "../types.js";
import { generateMarker, getEntries, getProjectEntries } from "./crontab.js";

/**
 * Information about a single PRD file
 */
export interface IPrdInfo {
  name: string;
  status: "ready" | "blocked" | "in-progress" | "done";
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
            status = age < maxRuntime ? "in-progress" : "ready";
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
 */
function deriveCiStatus(
  checks?: Array<{ conclusion: string; state: string }>
): IPrInfo["ciStatus"] {
  if (!checks || checks.length === 0) return "unknown";

  const hasFailure = checks.some(
    (c) => c.conclusion === "FAILURE" || c.conclusion === "ERROR" || c.conclusion === "CANCELLED"
  );
  if (hasFailure) return "fail";

  const allComplete = checks.every((c) => c.state === "COMPLETED");
  if (allComplete) return "pass";

  return "pending";
}

/**
 * Derive review score from gh reviewDecision field
 * Maps GitHub review decisions to a numeric score (0-100)
 */
function deriveReviewScore(reviewDecision?: string): number | null {
  if (!reviewDecision) return null;
  switch (reviewDecision) {
    case "APPROVED":
      return 100;
    case "CHANGES_REQUESTED":
      return 0;
    case "REVIEW_REQUIRED":
      return null;
    default:
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

    interface IGhPr {
      number: number;
      title: string;
      headRefName: string;
      url: string;
      statusCheckRollup?: Array<{ conclusion: string; state: string }>;
      reviewDecision?: string;
    }

    const prs: IGhPr[] = JSON.parse(output);
    return prs
      .filter((pr) =>
        branchPatterns.some((pattern) => pr.headRefName.startsWith(pattern))
      )
      .map((pr) => ({
        number: pr.number,
        title: pr.title,
        branch: pr.headRefName,
        url: pr.url,
        ciStatus: deriveCiStatus(pr.statusCheckRollup),
        reviewScore: deriveReviewScore(pr.reviewDecision),
      }));
  } catch {
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
    const logPath = path.join(projectDir, LOG_DIR, `${name}.log`);
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
  const lockProjectName = path.basename(projectDir);

  const executorLock = checkLockFile(`${LOCK_FILE_PREFIX}${lockProjectName}.lock`);
  const reviewerLock = checkLockFile(`${LOCK_FILE_PREFIX}pr-reviewer-${lockProjectName}.lock`);

  const processes: IProcessInfo[] = [
    { name: "executor", running: executorLock.running, pid: executorLock.pid },
    { name: "reviewer", running: reviewerLock.running, pid: reviewerLock.pid },
  ];

  const prds = collectPrdInfo(projectDir, config.prdDir, config.maxRuntime);
  const prs = collectPrInfo(projectDir, config.branchPatterns);
  const logs = collectLogInfo(projectDir);
  const crontab = getCrontabInfo(projectName, projectDir);

  return {
    projectName,
    projectDir,
    config,
    prds,
    processes,
    prs,
    logs,
    crontab,
    timestamp: new Date(),
  };
}

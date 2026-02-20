/**
 * Status data layer for Night Watch CLI
 * Provides data-fetching functions used by both the status command and the dashboard TUI.
 */
import { createHash } from "crypto";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { CLAIM_FILE_EXTENSION, LOCK_FILE_PREFIX, LOG_DIR, QA_LOG_NAME } from "../constants.js";
import { getPrdStatesForProject } from "./prd-states.js";
import { generateMarker, getEntries, getProjectEntries } from "./crontab.js";
/**
 * Get the project name from directory or package.json
 */
export function getProjectName(projectDir) {
    const packageJsonPath = path.join(projectDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
        try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
            if (packageJson.name) {
                return packageJson.name;
            }
        }
        catch {
            // Ignore parse errors
        }
    }
    return path.basename(projectDir);
}
/**
 * Compute the runtime key for a project directory.
 * Must stay in sync with project_runtime_key() in night-watch-helpers.sh.
 */
export function projectRuntimeKey(projectDir) {
    const projectName = path.basename(projectDir);
    const hash = createHash("sha1").update(projectDir).digest("hex").slice(0, 12);
    return `${projectName}-${hash}`;
}
/**
 * Compute the lock file path for the executor of a given project directory.
 */
export function executorLockPath(projectDir) {
    return `${LOCK_FILE_PREFIX}${projectRuntimeKey(projectDir)}.lock`;
}
/**
 * Compute the lock file path for the reviewer of a given project directory.
 */
export function reviewerLockPath(projectDir) {
    return `${LOCK_FILE_PREFIX}pr-reviewer-${projectRuntimeKey(projectDir)}.lock`;
}
/**
 * Compute the lock file path for the code auditor of a given project directory.
 */
export function auditLockPath(projectDir) {
    return `${LOCK_FILE_PREFIX}audit-${projectRuntimeKey(projectDir)}.lock`;
}
/**
 * Check if a process with the given PID is running
 */
export function isProcessRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Read PID from lock file and check if process is running
 */
export function checkLockFile(lockPath) {
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
    }
    catch {
        return { running: false, pid: null };
    }
}
/**
 * Count PRDs in the PRD directory and return counts
 */
export function countPRDs(projectDir, prdDir, maxRuntime) {
    const fullPrdPath = path.join(projectDir, prdDir);
    if (!fs.existsSync(fullPrdPath)) {
        return { pending: 0, claimed: 0, done: 0 };
    }
    let pending = 0;
    let claimed = 0;
    let done = 0;
    const countInDir = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "done") {
                    try {
                        const doneEntries = fs.readdirSync(fullPath);
                        done += doneEntries.filter((e) => e.endsWith(".md")).length;
                    }
                    catch {
                        // Ignore errors
                    }
                }
                else {
                    countInDir(fullPath);
                }
            }
            else if (entry.name.endsWith(".md")) {
                const claimPath = path.join(dir, entry.name + CLAIM_FILE_EXTENSION);
                if (fs.existsSync(claimPath)) {
                    try {
                        const content = fs.readFileSync(claimPath, "utf-8");
                        const claimData = JSON.parse(content);
                        const age = Math.floor(Date.now() / 1000) - claimData.timestamp;
                        if (age < maxRuntime) {
                            claimed++;
                        }
                        else {
                            pending++;
                        }
                    }
                    catch {
                        pending++;
                    }
                }
                else {
                    pending++;
                }
            }
        }
    };
    try {
        countInDir(fullPrdPath);
    }
    catch {
        // Ignore errors
    }
    return { pending, claimed, done };
}
/**
 * Parse dependency references from a PRD file.
 * Looks for a line matching "depends on: `name1`, `name2`" (case-insensitive).
 */
export function parsePrdDependencies(prdPath) {
    try {
        const content = fs.readFileSync(prdPath, "utf-8");
        // Match "Depends on:" with optional bold markdown, capture rest of line
        const match = content.match(/(?:\*\*)?Depends on:(?:\*\*)?[^\S\n]*([^\n]*)/i);
        if (!match)
            return [];
        return match[1]
            .split(",")
            .map((d) => d.replace(/`/g, "").replace(/\*\*/g, "").replace(/\|/g, "").trim())
            .filter((d) => d.length > 0);
    }
    catch {
        return [];
    }
}
/**
 * Collect PRD info items from the PRD directory
 * Cross-validates claim files with executor lock to avoid stale "in-progress" status
 */
export function collectPrdInfo(projectDir, prdDir, maxRuntime) {
    const fullPrdPath = path.join(projectDir, prdDir);
    const prds = [];
    if (!fs.existsSync(fullPrdPath)) {
        return prds;
    }
    // Pre-check executor lock for cross-validation
    const lockPath = executorLockPath(projectDir);
    const executorLock = checkLockFile(lockPath);
    // Track orphaned claim files to clean up
    const orphanedClaimFiles = [];
    const collectInDir = (dir) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
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
                    }
                    catch {
                        // Ignore errors
                    }
                }
                else {
                    collectInDir(fullPath);
                }
            }
            else if (entry.name.endsWith(".md")) {
                const claimPath = path.join(dir, entry.name + CLAIM_FILE_EXTENSION);
                let status = "ready";
                if (fs.existsSync(claimPath)) {
                    try {
                        const content = fs.readFileSync(claimPath, "utf-8");
                        const claimData = JSON.parse(content);
                        const age = Math.floor(Date.now() / 1000) - claimData.timestamp;
                        if (age < maxRuntime) {
                            // Cross-check: verify executor lock exists and is running
                            if (executorLock.running) {
                                status = "in-progress";
                            }
                            else {
                                // Claim is fresh but executor is not running - stale/orphaned claim
                                status = "ready";
                                orphanedClaimFiles.push(claimPath);
                            }
                        }
                        // else: stale claim (too old) — status stays "ready"
                    }
                    catch {
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
        }
        catch {
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
            prd.unmetDependencies = prd.dependencies.filter((dep) => !doneNames.has(dep) && !doneNames.has(dep.replace(/\.md$/, "")));
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
export function countOpenPRs(projectDir, branchPatterns) {
    try {
        execSync("git rev-parse --git-dir", {
            cwd: projectDir,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        });
        try {
            execSync("which gh", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
        }
        catch {
            return 0;
        }
        const output = execSync("gh pr list --state open --json headRefName,number", {
            cwd: projectDir,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        });
        const prs = JSON.parse(output);
        const matchingPRs = prs.filter((pr) => branchPatterns.some((pattern) => pr.headRefName.startsWith(pattern)));
        return matchingPRs.length;
    }
    catch {
        return 0;
    }
}
/**
 * Derive CI status from gh statusCheckRollup data
 * Supports both CheckRun (status: "COMPLETED", "IN_PROGRESS", etc.)
 * and StatusContext (state: "SUCCESS", "FAILURE", "PENDING", etc.) types
 * Also handles nested contexts array structures from some GitHub API versions
 */
function deriveCiStatus(checks) {
    if (!checks || checks.length === 0)
        return "unknown";
    // Flatten any nested contexts arrays (GitHub may wrap checks in a contexts array)
    const flattenedChecks = [];
    for (const check of checks) {
        // Check if this is a wrapper with nested contexts
        if (check.contexts && Array.isArray(check.contexts) && check.contexts.length > 0) {
            // Extract checks from nested contexts
            for (const ctx of check.contexts) {
                if (typeof ctx === "object" && ctx !== null) {
                    flattenedChecks.push(ctx);
                }
            }
        }
        else {
            // Regular check, use as-is
            flattenedChecks.push(check);
        }
    }
    if (flattenedChecks.length === 0)
        return "unknown";
    // Debug logging when DEBUG_PR_DATA is set
    if (process.env.DEBUG_PR_DATA === "1") {
        console.error("[DEBUG] deriveCiStatus input checks:", JSON.stringify(checks, null, 2));
        console.error("[DEBUG] deriveCiStatus flattened checks:", JSON.stringify(flattenedChecks, null, 2));
    }
    // Check for failures in CheckRun conclusion or StatusContext state
    const hasFailure = flattenedChecks.some((c) => {
        const conclusion = c.conclusion?.toUpperCase();
        const state = c.state?.toUpperCase();
        return (conclusion === "FAILURE" ||
            conclusion === "ERROR" ||
            conclusion === "CANCELLED" ||
            conclusion === "TIMED_OUT" ||
            state === "FAILURE" ||
            state === "ERROR");
    });
    if (hasFailure)
        return "fail";
    // Check if all checks are complete (CheckRun uses status, StatusContext uses state)
    const allComplete = flattenedChecks.every((c) => {
        const status = c.status?.toUpperCase();
        const state = c.state?.toUpperCase();
        const conclusion = c.conclusion?.toUpperCase();
        // CheckRun: status === "COMPLETED" or conclusion === "SUCCESS"/"FAILURE"
        // StatusContext: state === "SUCCESS" or "FAILURE" (not PENDING)
        return (status === "COMPLETED" ||
            state === "SUCCESS" ||
            state === "FAILURE" ||
            conclusion === "SUCCESS" ||
            conclusion === "FAILURE" ||
            conclusion === "NEUTRAL" ||
            conclusion === "SKIPPED");
    });
    if (allComplete)
        return "pass";
    return "pending";
}
/**
 * Derive review score from gh reviewDecision field
 * Maps GitHub review decisions to a numeric score (0-100)
 * Returns null if no review has been submitted or review is required
 */
function deriveReviewScore(reviewDecision) {
    // Debug logging when DEBUG_PR_DATA is set
    if (process.env.DEBUG_PR_DATA === "1") {
        console.error("[DEBUG] deriveReviewScore input:", JSON.stringify(reviewDecision));
    }
    // reviewDecision can be null, undefined, or empty string (meaning no review yet)
    if (!reviewDecision || reviewDecision === "")
        return null;
    const decision = String(reviewDecision).toUpperCase();
    switch (decision) {
        case "APPROVED":
            return 100;
        case "CHANGES_REQUESTED":
            return 0;
        case "REVIEW_REQUIRED":
            return null;
        default:
            // Log unexpected values for debugging
            if (process.env.DEBUG_PR_DATA === "1") {
                console.error(`[DEBUG] deriveReviewScore: unexpected value '${reviewDecision}'`);
            }
            return null;
    }
}
/**
 * Collect open PR info using gh CLI
 */
export function collectPrInfo(projectDir, branchPatterns) {
    try {
        execSync("git rev-parse --git-dir", {
            cwd: projectDir,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        });
        try {
            execSync("which gh", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
        }
        catch {
            return [];
        }
        const output = execSync("gh pr list --state open --json headRefName,number,title,url,statusCheckRollup,reviewDecision", {
            cwd: projectDir,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        });
        // Debug logging when DEBUG_PR_DATA is set
        if (process.env.DEBUG_PR_DATA === "1") {
            console.error("[DEBUG] Raw gh pr list output:", output);
        }
        const prs = JSON.parse(output);
        return prs
            .filter((pr) => branchPatterns.some((pattern) => pr.headRefName.startsWith(pattern)))
            .map((pr) => {
            // Debug log each PR's statusCheckRollup and reviewDecision
            if (process.env.DEBUG_PR_DATA === "1") {
                console.error(`[DEBUG] PR #${pr.number}:`);
                console.error(`[DEBUG]   statusCheckRollup:`, JSON.stringify(pr.statusCheckRollup, null, 2));
                console.error(`[DEBUG]   reviewDecision:`, JSON.stringify(pr.reviewDecision));
            }
            return {
                number: pr.number,
                title: pr.title,
                branch: pr.headRefName,
                url: pr.url,
                ciStatus: deriveCiStatus(pr.statusCheckRollup),
                reviewScore: deriveReviewScore(pr.reviewDecision),
            };
        });
    }
    catch {
        return [];
    }
}
/**
 * Get last N lines from a log file
 */
export function getLastLogLines(logPath, lines) {
    if (!fs.existsSync(logPath)) {
        return [];
    }
    try {
        const content = fs.readFileSync(logPath, "utf-8");
        const allLines = content.trim().split("\n");
        return allLines.slice(-lines);
    }
    catch {
        return [];
    }
}
/**
 * Get log file info
 */
export function getLogInfo(logPath, lastLines = 5) {
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
export function collectLogInfo(projectDir) {
    const logEntries = [
        { name: "executor", fileName: "executor.log" },
        { name: "reviewer", fileName: "reviewer.log" },
        { name: "qa", fileName: `${QA_LOG_NAME}.log` },
    ];
    return logEntries.map(({ name, fileName }) => {
        const logPath = path.join(projectDir, LOG_DIR, fileName);
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
export function getCrontabInfo(projectName, projectDir) {
    const marker = generateMarker(projectName);
    const crontabEntries = Array.from(new Set([...getEntries(marker), ...getProjectEntries(projectDir)]));
    return {
        installed: crontabEntries.length > 0,
        entries: crontabEntries,
    };
}
/**
 * Fetch a complete status snapshot for the given project
 */
export function fetchStatusSnapshot(projectDir, config) {
    const projectName = getProjectName(projectDir);
    const executorLock = checkLockFile(executorLockPath(projectDir));
    const reviewerLock = checkLockFile(reviewerLockPath(projectDir));
    const processes = [
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
//# sourceMappingURL=status-data.js.map
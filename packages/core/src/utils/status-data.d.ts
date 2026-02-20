/**
 * Status data layer for Night Watch CLI
 * Provides data-fetching functions used by both the status command and the dashboard TUI.
 */
import { INightWatchConfig } from "../types.js";
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
    crontab: {
        installed: boolean;
        entries: string[];
    };
    activePrd: string | null;
    timestamp: Date;
}
/**
 * Get the project name from directory or package.json
 */
export declare function getProjectName(projectDir: string): string;
/**
 * Compute the runtime key for a project directory.
 * Must stay in sync with project_runtime_key() in night-watch-helpers.sh.
 */
export declare function projectRuntimeKey(projectDir: string): string;
/**
 * Compute the lock file path for the executor of a given project directory.
 */
export declare function executorLockPath(projectDir: string): string;
/**
 * Compute the lock file path for the reviewer of a given project directory.
 */
export declare function reviewerLockPath(projectDir: string): string;
/**
 * Compute the lock file path for the code auditor of a given project directory.
 */
export declare function auditLockPath(projectDir: string): string;
/**
 * Check if a process with the given PID is running
 */
export declare function isProcessRunning(pid: number): boolean;
/**
 * Read PID from lock file and check if process is running
 */
export declare function checkLockFile(lockPath: string): {
    running: boolean;
    pid: number | null;
};
/**
 * Count PRDs in the PRD directory and return counts
 */
export declare function countPRDs(projectDir: string, prdDir: string, maxRuntime: number): {
    pending: number;
    claimed: number;
    done: number;
};
/**
 * Parse dependency references from a PRD file.
 * Looks for a line matching "depends on: `name1`, `name2`" (case-insensitive).
 */
export declare function parsePrdDependencies(prdPath: string): string[];
/**
 * Collect PRD info items from the PRD directory
 * Cross-validates claim files with executor lock to avoid stale "in-progress" status
 */
export declare function collectPrdInfo(projectDir: string, prdDir: string, maxRuntime: number): IPrdInfo[];
/**
 * Count open PRs on night-watch/ or feat/ branches using gh CLI
 */
export declare function countOpenPRs(projectDir: string, branchPatterns: string[]): number;
/**
 * Collect open PR info using gh CLI
 */
export declare function collectPrInfo(projectDir: string, branchPatterns: string[]): IPrInfo[];
/**
 * Get last N lines from a log file
 */
export declare function getLastLogLines(logPath: string, lines: number): string[];
/**
 * Get log file info
 */
export declare function getLogInfo(logPath: string, lastLines?: number): {
    path: string;
    lastLines: string[];
    exists: boolean;
    size: number;
};
/**
 * Collect log info as ILogInfo items
 */
export declare function collectLogInfo(projectDir: string): ILogInfo[];
/**
 * Get crontab information for a project
 */
export declare function getCrontabInfo(projectName: string, projectDir: string): {
    installed: boolean;
    entries: string[];
};
/**
 * Fetch a complete status snapshot for the given project
 */
export declare function fetchStatusSnapshot(projectDir: string, config: INightWatchConfig): IStatusSnapshot;
//# sourceMappingURL=status-data.d.ts.map
/**
 * StatusService — injectable wrapper around status-data utilities.
 *
 * Provides all status/snapshot fetching methods as a testable service class.
 * The original utils/status-data.ts functions continue to work as-is.
 */

import 'reflect-metadata';
import { injectable } from 'tsyringe';

import { INightWatchConfig } from '@night-watch/core/types.js';
import {
  ILogInfo,
  IPrInfo,
  IPrdInfo,
  IProcessInfo,
  IStatusSnapshot,
  auditLockPath,
  checkLockFile,
  collectLogInfo,
  collectPrInfo,
  collectPrdInfo,
  countOpenPRs,
  countPRDs,
  executorLockPath,
  fetchStatusSnapshot,
  getCrontabInfo,
  getLastLogLines,
  getLogInfo,
  getProjectName,
  isProcessRunning,
  parsePrdDependencies,
  projectRuntimeKey,
  reviewerLockPath,
} from '@night-watch/core/utils/status-data.js';

export type {
  IStatusSnapshot,
  IPrdInfo,
  IPrInfo,
  ILogInfo,
  IProcessInfo,
};

@injectable()
export class StatusService {
  /**
   * Fetch a complete status snapshot for the given project directory.
   */
  fetchSnapshot(projectDir: string, config: INightWatchConfig): IStatusSnapshot {
    return fetchStatusSnapshot(projectDir, config);
  }

  /**
   * Collect PRD info from the PRD directory.
   */
  collectPrdInfo(projectDir: string, prdDir: string, maxRuntime: number): IPrdInfo[] {
    return collectPrdInfo(projectDir, prdDir, maxRuntime);
  }

  /**
   * Collect open PR info using the gh CLI.
   */
  collectPrInfo(projectDir: string, branchPatterns: string[]): IPrInfo[] {
    return collectPrInfo(projectDir, branchPatterns);
  }

  /**
   * Collect log file info for the standard executor/reviewer/qa logs.
   */
  collectLogInfo(projectDir: string): ILogInfo[] {
    return collectLogInfo(projectDir);
  }

  /**
   * Read and check a process lock file.
   */
  checkLockFile(lockPath: string): { running: boolean; pid: number | null } {
    return checkLockFile(lockPath);
  }

  /**
   * Compute the executor lock file path for the given project directory.
   */
  executorLockPath(projectDir: string): string {
    return executorLockPath(projectDir);
  }

  /**
   * Compute the reviewer lock file path for the given project directory.
   */
  reviewerLockPath(projectDir: string): string {
    return reviewerLockPath(projectDir);
  }

  /**
   * Compute the audit lock file path for the given project directory.
   */
  auditLockPath(projectDir: string): string {
    return auditLockPath(projectDir);
  }

  /**
   * Derive the project name from package.json or directory basename.
   */
  getProjectName(projectDir: string): string {
    return getProjectName(projectDir);
  }

  /**
   * Compute the runtime key (stable identifier) for a project directory.
   */
  projectRuntimeKey(projectDir: string): string {
    return projectRuntimeKey(projectDir);
  }

  /**
   * Return the last N lines of a log file.
   */
  getLastLogLines(logPath: string, lines: number): string[] {
    return getLastLogLines(logPath, lines);
  }

  /**
   * Return metadata about a log file.
   */
  getLogInfo(logPath: string, lastLines?: number): { path: string; lastLines: string[]; exists: boolean; size: number } {
    return getLogInfo(logPath, lastLines);
  }

  /**
   * Get crontab information for a project.
   */
  getCrontabInfo(projectName: string, projectDir: string): { installed: boolean; entries: string[] } {
    return getCrontabInfo(projectName, projectDir);
  }

  /**
   * Count PRDs by status in the PRD directory.
   */
  countPRDs(projectDir: string, prdDir: string, maxRuntime: number): { pending: number; claimed: number; done: number } {
    return countPRDs(projectDir, prdDir, maxRuntime);
  }

  /**
   * Count open PRs matching branch patterns using the gh CLI.
   */
  countOpenPRs(projectDir: string, branchPatterns: string[]): number {
    return countOpenPRs(projectDir, branchPatterns);
  }

  /**
   * Check whether a process with the given PID is running.
   */
  isProcessRunning(pid: number): boolean {
    return isProcessRunning(pid);
  }

  /**
   * Parse dependency references from a PRD file.
   */
  parsePrdDependencies(prdPath: string): string[] {
    return parsePrdDependencies(prdPath);
  }
}

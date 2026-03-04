/**
 * PRD discovery utilities for Night Watch CLI
 * Replaces bash functions from night-watch-helpers.sh
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { isClaimed } from './claim-manager.js';
import { isInCooldown } from './execution-history.js';
import { parsePrdDependencies } from './status-data.js';

/**
 * Result of finding an eligible board issue
 */
export interface IEligibleBoardIssue {
  number: number;
  title: string;
  body: string;
}

/**
 * Options for findEligiblePrd
 */
export interface IFindEligiblePrdOptions {
  prdDir: string;
  projectDir: string;
  maxRuntime: number;
  prdPriority?: string;
}

/**
 * Get list of open PR branch names from GitHub
 */
function getOpenBranches(projectDir: string): string[] {
  try {
    const output = execFileSync(
      'gh',
      ['pr', 'list', '--state', 'open', '--json', 'headRefName', '--jq', '.[].headRefName'],
      { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return output
      .trim()
      .split('\n')
      .filter((b) => b.length > 0);
  } catch {
    return [];
  }
}

/**
 * Sort PRD files by priority order.
 * Files matching priority names come first, others follow in original order.
 */
export function sortPrdsByPriority(files: string[], priorityList: string[]): string[] {
  if (!priorityList.length) {
    return files;
  }

  const prioritySet = new Set(priorityList);
  const prioritized: string[] = [];
  const remaining: string[] = [];

  // Add files in priority order
  for (const priorityName of priorityList) {
    const match = files.find((f) => f === `${priorityName}.md`);
    if (match) {
      prioritized.push(match);
    }
  }

  // Add remaining files not in priority list
  for (const file of files) {
    if (!prioritySet.has(file.replace(/\.md$/, ''))) {
      remaining.push(file);
    }
  }

  return [...prioritized, ...remaining];
}

/**
 * Find an eligible PRD file for execution.
 * Scans PRD files, applies priority ordering, checks claims, cooldown, dependencies.
 * Returns the PRD filename (not full path) or null if none eligible.
 */
export function findEligiblePrd(options: IFindEligiblePrdOptions): string | null {
  const { prdDir, projectDir, maxRuntime, prdPriority } = options;
  const doneDir = path.join(prdDir, 'done');

  // Get all PRD files
  if (!fs.existsSync(prdDir)) {
    return null;
  }

  let prdFiles = fs
    .readdirSync(prdDir)
    .filter((f) => f.endsWith('.md') && fs.statSync(path.join(prdDir, f)).isFile())
    .sort();

  if (prdFiles.length === 0) {
    return null;
  }

  // Apply priority ordering if specified
  if (prdPriority) {
    const priorityList = prdPriority.split(':').filter((p) => p.length > 0);
    prdFiles = sortPrdsByPriority(prdFiles, priorityList);
  }

  // Get open PR branches
  const openBranches = getOpenBranches(projectDir);

  for (const prdFile of prdFiles) {
    const prdName = prdFile.replace(/\.md$/, '');
    const prdPath = path.join(prdDir, prdFile);

    // Skip if claimed by another process
    if (isClaimed(prdDir, prdFile, maxRuntime)) {
      continue;
    }

    // Skip if in cooldown after a recent failure
    if (isInCooldown(projectDir, prdFile, maxRuntime)) {
      continue;
    }

    // Skip if a PR already exists for this PRD
    if (openBranches.some((branch) => branch.includes(prdName))) {
      continue;
    }

    // Check dependencies
    const dependencies = parsePrdDependencies(prdPath);
    let allDepsMet = true;

    for (const dep of dependencies) {
      const depFile = dep.endsWith('.md') ? dep : `${dep}.md`;
      const depPath = path.join(doneDir, depFile);

      if (!fs.existsSync(depPath)) {
        allDepsMet = false;
        break;
      }
    }

    if (!allDepsMet) {
      continue;
    }

    return prdFile;
  }

  return null;
}

/**
 * Find an eligible board issue for the roadmap slicer.
 * Returns issue info or null if none eligible.
 */
export function findEligibleBoardIssue(options: {
  projectDir: string;
  maxRuntime: number;
}): IEligibleBoardIssue | null {
  const { projectDir, maxRuntime } = options;

  try {
    // Get open issues with specific labels (e.g., "roadmap" or "slicer")
    const output = execFileSync(
      'gh',
      ['issue', 'list', '--state', 'open', '--json', 'number,title,body', '--jq', '.[]'],
      { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );

    const issues = output
      .trim()
      .split('\n')
      .filter((line) => line.length > 0);

    for (const issueLine of issues) {
      try {
        const issue = JSON.parse(issueLine);

        // Check if issue is claimed/in cooldown (using a claim file based on issue number)
        const claimFile = `issue-${issue.number}`;
        if (isClaimed(projectDir, claimFile, maxRuntime)) {
          continue;
        }

        return {
          number: issue.number,
          title: issue.title,
          body: issue.body || '',
        };
      } catch {
        // Skip malformed issue data
        continue;
      }
    }
  } catch {
    // gh command failed
  }

  return null;
}

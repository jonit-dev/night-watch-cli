/**
 * PRD discovery utilities for Night Watch CLI
 * Board-mode only: finds eligible issues from GitHub Projects
 */

import { execFileSync } from 'child_process';

/**
 * Result of finding an eligible board issue
 */
export interface IEligibleBoardIssue {
  number: number;
  title: string;
  body: string;
}

/**
 * Options for findEligiblePrd (legacy filesystem mode - now deprecated)
 * @deprecated Board mode is the only supported mode
 */
export interface IFindEligiblePrdOptions {
  prdDir: string;
  projectDir: string;
  maxRuntime: number;
  prdPriority?: string;
}

/**
 * Sort PRD files by priority order.
 * Files matching priority names come first, others follow in original order.
 * @deprecated Kept for backward compatibility but not used in board mode
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
 * @deprecated Filesystem mode is no longer supported. Use board mode instead.
 * This function always returns null now.
 */
export function findEligiblePrd(_options: IFindEligiblePrdOptions): string | null {
  // Filesystem mode removed - board mode is the only execution mode
  return null;
}

/**
 * Find an eligible board issue for the roadmap slicer.
 * Returns issue info or null if none eligible.
 * Board mode uses GitHub Projects for state tracking instead of claim files.
 */
export function findEligibleBoardIssue(options: {
  projectDir: string;
}): IEligibleBoardIssue | null {
  const { projectDir } = options;

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

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

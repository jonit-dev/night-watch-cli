/**
 * GitHub utilities for Night Watch CLI
 * Fetches PR details using the gh CLI
 */

import { execSync } from "child_process";

export interface PrDetails {
  number: number;
  title: string;
  url: string;
  body: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

/**
 * Fetch PR details for the most recently created PR matching a branch prefix.
 * Returns null if gh is unavailable, not authenticated, or no PR found.
 */
export function fetchPrDetails(branchPrefix: string, cwd: string): PrDetails | null {
  try {
    // Find the most recently created open PR on a matching branch
    const listOutput = execSync(
      `gh pr list --state open --json number,headRefName --limit 20`,
      { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );

    const prs = JSON.parse(listOutput) as { number: number; headRefName: string }[];

    // Filter PRs matching the branch prefix
    const matching = prs.filter((pr) => pr.headRefName.startsWith(branchPrefix + "/"));

    if (matching.length === 0) {
      return null;
    }

    // Use the first match (most recent)
    const prNumber = matching[0].number;

    // Fetch full details for this PR
    const viewOutput = execSync(
      `gh pr view ${prNumber} --json number,title,url,body,additions,deletions,changedFiles`,
      { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );

    const details = JSON.parse(viewOutput);

    return {
      number: details.number,
      title: details.title ?? "",
      url: details.url ?? "",
      body: details.body ?? "",
      additions: details.additions ?? 0,
      deletions: details.deletions ?? 0,
      changedFiles: details.changedFiles ?? 0,
    };
  } catch {
    // gh CLI not available, not authenticated, or command failed
    return null;
  }
}

/**
 * Fetch PR details for the most recently updated PR matching any of the given branch patterns.
 * Used by the review command to find the PR that was just reviewed.
 * Returns null on any failure.
 */
export function fetchReviewedPrDetails(branchPatterns: string[], cwd: string): PrDetails | null {
  try {
    const listOutput = execSync(
      `gh pr list --state open --json number,headRefName --limit 20`,
      { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );

    const prs = JSON.parse(listOutput) as { number: number; headRefName: string }[];

    // Filter PRs matching any branch pattern
    const matching = prs.filter((pr) =>
      branchPatterns.some((pattern) => pr.headRefName.startsWith(pattern))
    );

    if (matching.length === 0) {
      return null;
    }

    // Use the first match
    const prNumber = matching[0].number;

    const viewOutput = execSync(
      `gh pr view ${prNumber} --json number,title,url,body,additions,deletions,changedFiles`,
      { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );

    const details = JSON.parse(viewOutput);

    return {
      number: details.number,
      title: details.title ?? "",
      url: details.url ?? "",
      body: details.body ?? "",
      additions: details.additions ?? 0,
      deletions: details.deletions ?? 0,
      changedFiles: details.changedFiles ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Extract a summary from a PR body.
 * Takes the first meaningful paragraph, strips markdown headers, truncates to maxLength.
 */
export function extractSummary(body: string, maxLength: number = 500): string {
  if (!body || body.trim().length === 0) {
    return "";
  }

  // Split into lines and filter out markdown headers and empty lines
  const lines = body.split("\n");
  const contentLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines, markdown headers, and horizontal rules
    if (trimmed === "" || trimmed.startsWith("#") || trimmed === "---" || trimmed === "***") {
      // If we already have content, a blank line means end of first paragraph
      if (contentLines.length > 0 && trimmed === "") {
        break;
      }
      continue;
    }
    contentLines.push(trimmed);
  }

  const summary = contentLines.join("\n");

  if (summary.length <= maxLength) {
    return summary;
  }

  // Truncate at word boundary
  const truncated = summary.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + "...";
}

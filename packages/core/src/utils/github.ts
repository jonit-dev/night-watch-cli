/**
 * GitHub utilities for Night Watch CLI
 * Fetches PR details using the gh CLI
 */

import { execFileSync } from 'child_process';

export interface IPrDetails {
  number: number;
  title: string;
  url: string;
  body: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  headRefName: string;
}

const QA_COMMENT_MARKER = '<!-- night-watch-qa-marker -->';
const QA_SCREENSHOT_REGEX = /!\[[^\]]*]\(([^)\n]*qa-artifacts\/[^)\n]+)\)/g;

function parsePrDetails(raw: string): IPrDetails | null {
  try {
    const details = JSON.parse(raw) as Partial<IPrDetails>;
    if (typeof details.number !== 'number') {
      return null;
    }
    return {
      number: details.number,
      title: details.title ?? '',
      url: details.url ?? '',
      body: details.body ?? '',
      additions: details.additions ?? 0,
      deletions: details.deletions ?? 0,
      changedFiles: details.changedFiles ?? 0,
      headRefName: details.headRefName ?? '',
    };
  } catch {
    return null;
  }
}

function fetchPrBySelector(selector: string, cwd: string): IPrDetails | null {
  try {
    const output = execFileSync(
      'gh',
      [
        'pr',
        'view',
        selector,
        '--json',
        'number,title,url,body,additions,deletions,changedFiles,headRefName',
      ],
      { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return parsePrDetails(output);
  } catch {
    return null;
  }
}

function decodeBase64Value(value: string): string {
  try {
    return Buffer.from(value, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function splitNonEmptyLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function getQaCommentBodiesBase64(prNumber: number, cwd: string, repo?: string): string[] {
  const bodies: string[] = [];

  try {
    const ghPrOutput = execFileSync(
      'gh',
      ['pr', 'view', String(prNumber), '--json', 'comments', '--jq', '.comments[]?.body | @base64'],
      { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    bodies.push(...splitNonEmptyLines(ghPrOutput));
  } catch {
    // Ignore and continue with fallback path.
  }

  if (repo) {
    try {
      const issueCommentsOutput = execFileSync(
        'gh',
        ['api', `repos/${repo}/issues/${prNumber}/comments`, '--jq', '.[].body | @base64'],
        { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
      bodies.push(...splitNonEmptyLines(issueCommentsOutput));
    } catch {
      // Ignore fallback errors.
    }
  }

  return bodies;
}

function normalizeQaScreenshotUrl(rawUrl: string, repo?: string): string {
  const url = rawUrl.trim();
  if (url.length === 0) {
    return '';
  }

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  if (repo && url.startsWith('../blob/')) {
    return `https://github.com/${repo}/${url.replace(/^\.\.\//, '')}`;
  }

  if (repo && url.startsWith('blob/')) {
    return `https://github.com/${repo}/${url}`;
  }

  return url;
}

/**
 * Fetch PR details by exact branch name selector.
 * Returns null on any failure.
 */
export function fetchPrDetailsForBranch(branchName: string, cwd: string): IPrDetails | null {
  return fetchPrBySelector(branchName, cwd);
}

/**
 * Fetch PR details by PR number selector.
 * Returns null on any failure.
 */
export function fetchPrDetailsByNumber(prNumber: number, cwd: string): IPrDetails | null {
  return fetchPrBySelector(String(prNumber), cwd);
}

/**
 * Fetch PR details for the most recently created PR matching a branch prefix.
 * Returns null if gh is unavailable, not authenticated, or no PR found.
 */
export function fetchPrDetails(branchPrefix: string, cwd: string): IPrDetails | null {
  try {
    // Find the most recently created open PR on a matching branch
    const listOutput = execFileSync(
      'gh',
      ['pr', 'list', '--state', 'open', '--json', 'number,headRefName', '--limit', '20'],
      { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );

    const prs = JSON.parse(listOutput) as { number: number; headRefName: string }[];

    // Filter PRs matching the branch prefix
    const matching = prs.filter((pr) => pr.headRefName.startsWith(branchPrefix + '/'));

    if (matching.length === 0) {
      return null;
    }

    // Use the first match (most recent)
    const prNumber = matching[0].number;
    return fetchPrDetailsByNumber(prNumber, cwd);
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
export function fetchReviewedPrDetails(branchPatterns: string[], cwd: string): IPrDetails | null {
  try {
    const listOutput = execFileSync(
      'gh',
      ['pr', 'list', '--state', 'open', '--json', 'number,headRefName', '--limit', '20'],
      { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );

    const prs = JSON.parse(listOutput) as { number: number; headRefName: string }[];

    // Filter PRs matching any branch pattern
    const matching = prs.filter((pr) =>
      branchPatterns.some((pattern) => pr.headRefName.startsWith(pattern)),
    );

    if (matching.length === 0) {
      return null;
    }

    // Use the first match
    const prNumber = matching[0].number;
    return fetchPrDetailsByNumber(prNumber, cwd);
  } catch {
    return null;
  }
}

/**
 * Fetch the latest QA marker comment body from a PR.
 * Returns null if no QA marker comment is found or gh is unavailable.
 */
export function fetchLatestQaCommentBody(
  prNumber: number,
  cwd: string,
  repo?: string,
): string | null {
  const encodedBodies = getQaCommentBodiesBase64(prNumber, cwd, repo);
  let latestQaComment: string | null = null;

  for (const encoded of encodedBodies) {
    const decoded = decodeBase64Value(encoded);
    if (decoded.includes(QA_COMMENT_MARKER)) {
      latestQaComment = decoded;
    }
  }

  return latestQaComment;
}

/**
 * Extract screenshot links from a QA report comment body.
 * Supports links pointing to qa-artifacts/, deduplicates while preserving order.
 */
export function extractQaScreenshotUrls(commentBody: string, repo?: string): string[] {
  if (!commentBody || commentBody.trim().length === 0) {
    return [];
  }

  const regex = new RegExp(QA_SCREENSHOT_REGEX);
  const screenshots: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  match = regex.exec(commentBody);
  while (match !== null) {
    const rawUrl = match[1] ?? '';
    const normalizedUrl = normalizeQaScreenshotUrl(rawUrl, repo);
    if (normalizedUrl.length > 0 && !seen.has(normalizedUrl)) {
      seen.add(normalizedUrl);
      screenshots.push(normalizedUrl);
    }
    match = regex.exec(commentBody);
  }

  return screenshots;
}

/**
 * Fetch screenshot links from the latest QA marker comment for a PR.
 */
export function fetchQaScreenshotUrlsForPr(prNumber: number, cwd: string, repo?: string): string[] {
  const qaComment = fetchLatestQaCommentBody(prNumber, cwd, repo);
  if (!qaComment) {
    return [];
  }
  return extractQaScreenshotUrls(qaComment, repo);
}

/**
 * Extract a summary from a PR body.
 * Takes the first meaningful paragraph, strips markdown headers, truncates to maxLength.
 */
export function extractSummary(body: string, maxLength: number = 500): string {
  if (!body || body.trim().length === 0) {
    return '';
  }

  // Split into lines and filter out markdown headers and empty lines
  const lines = body.split('\n');
  const contentLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines, markdown headers, and horizontal rules
    if (trimmed === '' || trimmed.startsWith('#') || trimmed === '---' || trimmed === '***') {
      // If we already have content, a blank line means end of first paragraph
      if (contentLines.length > 0 && trimmed === '') {
        break;
      }
      continue;
    }
    contentLines.push(trimmed);
  }

  const summary = contentLines.join('\n');

  if (summary.length <= maxLength) {
    return summary;
  }

  // Truncate at word boundary
  const truncated = summary.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

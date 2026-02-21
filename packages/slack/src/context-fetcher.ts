/**
 * Context fetching for enriching Slack messages.
 * Fetches URL summaries and GitHub issue/PR content for agent context.
 */

import { execFileSync } from 'child_process';
import { injectable } from 'tsyringe';

@injectable()
export class ContextFetcher {
  /**
   * Fetch title and meta description from generic URLs for agent context.
   * Returns a formatted string, or '' on failure.
   */
  async fetchUrlSummaries(urls: string[]): Promise<string> {
    if (urls.length === 0) return '';

    const parts: string[] = [];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);

    try {
      for (const url of urls.slice(0, 4)) {
        try {
          const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NightWatch/1.0)' },
            redirect: 'follow',
          });
          if (!res.ok) continue;
          const html = await res.text();
          const titleMatch = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
          const descMatch =
            html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']{1,300})["']/i) ??
            html.match(/<meta[^>]*content=["']([^"']{1,300})["'][^>]*name=["']description["']/i);
          const title = titleMatch?.[1]?.trim() ?? '';
          const desc = descMatch?.[1]?.trim() ?? '';
          if (title || desc) {
            const lines = [`Link: ${url}`];
            if (title) lines.push(`Title: ${title}`);
            if (desc) lines.push(`Summary: ${desc}`);
            parts.push(lines.join('\n'));
          }
        } catch {
          // Network error or timeout for individual URL — skip
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }

    return parts.join('\n\n');
  }

  /**
   * Fetch GitHub issue/PR content via `gh api` for agent context.
   * Returns a formatted string, or '' on failure.
   */
  async fetchGitHubIssueContext(urls: string[]): Promise<string> {
    if (urls.length === 0) return '';

    const parts: string[] = [];

    for (const url of urls.slice(0, 5)) {
      const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/);
      if (!match) continue;
      const [, owner, repo, type, number] = match;
      const endpoint =
        type === 'pull'
          ? `/repos/${owner}/${repo}/pulls/${number}`
          : `/repos/${owner}/${repo}/issues/${number}`;

      try {
        const raw = execFileSync(
          'gh',
          [
            'api',
            endpoint,
            '--jq',
            '{title: .title, state: .state, body: .body, labels: [.labels[].name]}',
          ],
          {
            timeout: 10_000,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        const data = JSON.parse(raw) as {
          title: string;
          state: string;
          body: string | null;
          labels: string[];
        };
        const labelStr = data.labels.length > 0 ? ` [${data.labels.join(', ')}]` : '';
        const body = (data.body ?? '').trim().slice(0, 1200);
        parts.push(
          `GitHub ${type === 'pull' ? 'PR' : 'Issue'} #${number}${labelStr}: ${data.title} (${data.state})\n${body}`,
        );
      } catch {
        // gh not available or not authenticated — skip
      }
    }

    return parts.join('\n\n---\n\n');
  }
}

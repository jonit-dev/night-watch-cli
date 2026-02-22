/**
 * Message parsing for Slack interaction handling.
 * Encapsulates all parsing logic for job requests, provider requests,
 * issue pickups, URL extraction, and event filtering.
 */

import { injectable } from 'tsyringe';
import { normalizeText, stripSlackUserMentions } from './utils.js';

const JOB_STOPWORDS = new Set([
  'and',
  'or',
  'for',
  'on',
  'of',
  'please',
  'now',
  'it',
  'this',
  'these',
  'those',
  'the',
  'a',
  'an',
  'pr',
  'pull',
  'that',
  'thanks',
  'thank',
  'again',
  'job',
  'pipeline',
]);

export type TSlackJobName = 'run' | 'review' | 'qa' | 'audit';
export type TSlackProviderName = 'claude' | 'codex';

export interface ISlackJobRequest {
  job: TSlackJobName;
  projectHint?: string;
  prNumber?: string;
  fixConflicts?: boolean;
}

export interface ISlackProviderRequest {
  provider: TSlackProviderName;
  prompt: string;
  projectHint?: string;
}

export interface ISlackIssuePickupRequest {
  issueNumber: string;
  issueUrl: string;
  repoHint?: string;
}

export interface IAdHocThreadState {
  personaId: string;
  expiresAt: number;
}

export interface ISlackIssueReviewable {
  issueUrl: string;
  issueRef: string; // '{owner}/{repo}#{number}'
  owner: string;
  repo: string;
  issueNumber: string;
}

export interface IInboundSlackEvent {
  type?: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
}

export interface IEventsApiPayload {
  ack?: () => Promise<void>;
  event?: IInboundSlackEvent;
  body?: {
    event?: IInboundSlackEvent;
  };
  payload?: {
    event?: IInboundSlackEvent;
  };
}

@injectable()
export class MessageParser {
  normalizeForParsing(text: string): string {
    return normalizeText(text, { preservePaths: true });
  }

  extractInboundEvent(payload: IEventsApiPayload): IInboundSlackEvent | null {
    return payload.event ?? payload.body?.event ?? payload.payload?.event ?? null;
  }

  buildInboundMessageKey(channel: string, ts: string, type: string | undefined): string {
    return `${channel}:${ts}:${type ?? 'message'}`;
  }

  isAmbientTeamMessage(text: string): boolean {
    const normalized = this.normalizeForParsing(stripSlackUserMentions(text));
    if (!normalized) return false;

    if (
      /^(hey|hi|hello|yo|sup)\b/.test(normalized) &&
      /\b(guys|team|everyone|folks)\b/.test(normalized)
    ) {
      return true;
    }

    if (/^(hey|hi|hello|yo|sup)\b/.test(normalized) && normalized.split(' ').length <= 6) {
      return true;
    }

    return false;
  }

  parseSlackJobRequest(text: string): ISlackJobRequest | null {
    const withoutMentions = stripSlackUserMentions(text);
    const normalized = this.normalizeForParsing(withoutMentions);
    if (!normalized) return null;

    // Be tolerant of wrapped/copied URLs where whitespace/newlines split segments.
    const compactForUrl = withoutMentions.replace(/\s+/g, '');
    const prUrlMatch = compactForUrl.match(
      /https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i,
    );
    const prPathMatch = compactForUrl.match(/\/pull\/(\d+)(?:[/?#]|$)/i);
    const prHashMatch = withoutMentions.match(/(?:^|\s)#(\d+)(?:\s|$)/);
    const conflictSignal = /\b(conflict|conflicts|merge conflict|merge issues?|rebase)\b/i.test(
      normalized,
    );
    const requestSignal =
      /\b(can someone|someone|anyone|please|need|look at|take a look|fix|review|check)\b/i.test(
        normalized,
      );

    // eslint-disable-next-line sonarjs/slow-regex
    const match = normalized.match(/\b(run|review|qa)\b(?:\s+(?:for|on)?\s*([a-z0-9./_-]+))?/i);
    if (!match && !prUrlMatch && !prHashMatch) return null;

    const explicitJob = match?.[1]?.toLowerCase() as TSlackJobName | undefined;
    const hasPrReference = Boolean(prUrlMatch?.[3] ?? prPathMatch?.[1] ?? prHashMatch?.[1]);
    const inferredReviewJob = conflictSignal || (hasPrReference && requestSignal);
    const job: TSlackJobName | undefined =
      explicitJob ?? (inferredReviewJob ? 'review' : undefined);
    if (!job || !['run', 'review', 'qa'].includes(job)) return null;

    const prNumber = prUrlMatch?.[3] ?? prPathMatch?.[1] ?? prHashMatch?.[1];
    const repoHintFromUrl = prUrlMatch?.[2]?.toLowerCase();
    // Secondary scan: look for explicit "on/for {name}" anywhere in the message.
    // Handles cases like "run yarn verify on night-watch-cli project" where the
    // project name appears after the command words, not immediately after the verb.
    const onForMatch = normalized.match(
      /\b(?:on|for)\s+([a-z0-9][a-z0-9._/-]*)\s*(?:project|repo|codebase|branch)?\b/,
    );
    const onForHint =
      onForMatch?.[1] && !JOB_STOPWORDS.has(onForMatch[1]) ? onForMatch[1] : undefined;

    const candidates = [onForHint, match?.[2]?.toLowerCase(), repoHintFromUrl].filter(
      (value): value is string => Boolean(value && !JOB_STOPWORDS.has(value)),
    );
    const projectHint = candidates[0];

    const request: ISlackJobRequest = { job };
    if (projectHint) request.projectHint = projectHint;
    if (prNumber) request.prNumber = prNumber;
    if (job === 'review' && conflictSignal) request.fixConflicts = true;

    return request;
  }

  parseSlackIssuePickupRequest(text: string): ISlackIssuePickupRequest | null {
    const withoutMentions = stripSlackUserMentions(text);
    const normalized = this.normalizeForParsing(withoutMentions);
    if (!normalized) return null;

    // Extract GitHub issue URL — NOT pull requests (those handled by parseSlackJobRequest)
    const compactForUrl = withoutMentions.replace(/\s+/g, '');

    let issueUrl: string;
    let issueNumber: string;
    let repo: string;

    // Standard format: github.com/{owner}/{repo}/issues/{number}
    const directIssueMatch = compactForUrl.match(
      /https?:\/\/github\.com\/([^/\s<>]+)\/([^/\s<>]+)\/issues\/(\d+)/i,
    );

    if (directIssueMatch) {
      [issueUrl, , repo, issueNumber] = directIssueMatch;
      repo = repo.toLowerCase();
    } else {
      // Project board format: github.com/...?...&issue={owner}%7C{repo}%7C{number}
      // e.g. github.com/users/jonit-dev/projects/41/views/2?pane=issue&issue=jonit-dev%7Cnight-watch-cli%7C12
      const boardMatch = compactForUrl.match(
        /https?:\/\/github\.com\/[^<>\s]*[?&]issue=([^<>\s&]+)/i,
      );
      if (!boardMatch) return null;

      const rawParam = boardMatch[1].replace(/%7[Cc]/g, '|');
      const parts = rawParam.split('|');
      if (parts.length < 3 || !/^\d+$/.test(parts[parts.length - 1])) return null;

      issueNumber = parts[parts.length - 1];
      repo = parts[parts.length - 2].toLowerCase();
      issueUrl = boardMatch[0];
    }

    // Requires pickup-intent language or "this issue" + request language
    // "pickup" (one word) is also accepted alongside "pick up" (two words)
    const pickupSignal =
      /\b(pick\s+up|pickup|work\s+on|implement|tackle|start\s+on|grab|handle\s+this|ship\s+this)\b/i.test(
        normalized,
      );
    const requestSignal =
      /\b(please|can\s+someone|anyone)\b/i.test(normalized) && /\bthis\s+issue\b/i.test(normalized);
    if (!pickupSignal && !requestSignal) return null;

    return {
      issueNumber,
      issueUrl,
      repoHint: repo,
    };
  }

  parseSlackProviderRequest(text: string): ISlackProviderRequest | null {
    const withoutMentions = stripSlackUserMentions(text);
    if (!withoutMentions.trim()) return null;

    // Explicit direct-provider invocation from Slack, e.g.:
    // "claude fix the flaky tests", "run codex on repo-x: investigate CI failures"
    const prefixMatch = withoutMentions.match(
      // eslint-disable-next-line sonarjs/regex-complexity
      /^\s*(?:can\s+(?:you|someone|anyone)\s+)?(?:please\s+)?(?:(?:run|use|invoke|trigger|ask)\s+)?(claude|codex)\b[\s:,-]*/i,
    );
    if (!prefixMatch) return null;

    const provider = prefixMatch[1].toLowerCase() as TSlackProviderName;
    let remainder = withoutMentions.slice(prefixMatch[0].length).trim();
    if (!remainder) return null;

    let projectHint: string | undefined;
    const projectMatch = remainder.match(/^(?:for|on)\s+([a-z0-9./_-]+)\b[\s:,-]*/i);
    if (projectMatch) {
      const candidate = projectMatch[1].toLowerCase();
      if (!JOB_STOPWORDS.has(candidate)) {
        projectHint = candidate;
      }
      remainder = remainder.slice(projectMatch[0].length).trim();
    }

    if (!remainder) return null;
    return {
      provider,
      prompt: remainder,
      ...(projectHint ? { projectHint } : {}),
    };
  }

  shouldIgnoreInboundSlackEvent(event: IInboundSlackEvent, botUserId: string | null): boolean {
    if (!event.channel || !event.ts) return true;
    if (!event.user) return true;
    if (event.subtype) return true;
    if (event.bot_id) return true;
    if (botUserId && event.user === botUserId) return true;
    return false;
  }

  /**
   * Parse a GitHub issue URL from message text (NOT pull requests).
   * Returns structured data for triggering an issue review, or null if not found.
   */
  parseSlackIssueReviewable(text: string): ISlackIssueReviewable | null {
    const compactForUrl = text.replace(/\s+/g, '');
    const match = compactForUrl.match(
      /https?:\/\/github\.com\/([^/\s<>]+)\/([^/\s<>]+)\/issues\/(\d+)/i,
    );
    if (!match) return null;

    const [issueUrl, owner, repo, issueNumber] = match;
    return {
      issueUrl,
      issueRef: `${owner}/${repo}#${issueNumber}`,
      owner,
      repo,
      issueNumber,
    };
  }

  /**
   * Extract GitHub issue or PR URLs from a message string.
   */
  extractGitHubIssueUrls(text: string): string[] {
    const matches = text.match(/https?:\/\/github\.com\/[^\s<>]+/g) ?? [];
    return matches.filter((u) => /\/(issues|pull)\/\d+/.test(u));
  }

  /**
   * Extract non-GitHub HTTP(S) URLs from a message (Slack angle-bracket format or plain).
   */
  extractGenericUrls(text: string): string[] {
    // Slack wraps URLs in angle brackets: <https://example.com>
    const bracketUrls = [...text.matchAll(/<(https?:\/\/[^|>\s]+)(?:\|[^>]*)?>/g)].map((m) => m[1]);
    // Also match plain URLs not already captured
    const plainUrls = (text.match(/https?:\/\/[^\s<>]+/g) ?? []).filter(
      (u) => !bracketUrls.includes(u),
    );
    const all = [...new Set([...bracketUrls, ...plainUrls])];
    // Exclude GitHub URLs (those are handled by fetchGitHubIssueContext)
    return all.filter((u) => !u.includes('github.com'));
  }
}

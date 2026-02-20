/**
 * Slack interaction listener.
 * Listens to human messages (Socket Mode), routes @persona mentions,
 * and applies loop-protection safeguards.
 */

import { SocketModeClient } from '@slack/socket-mode';
import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { IAgentPersona } from '../../shared/types.js';
import { getDb } from '../storage/sqlite/client.js';
import { getRepositories } from '../storage/repositories/index.js';
import { INightWatchConfig } from '../types.js';
import type { IRegistryEntry } from '../utils/registry.js';
import { parseScriptResult } from '../utils/script-result.js';
import { getRoadmapStatus } from '../utils/roadmap-scanner.js';
import { generatePersonaAvatar } from '../utils/avatar-generator.js';
import { DeliberationEngine } from './deliberation.js';
import { SlackClient } from './client.js';
import { buildCurrentCliInvocation, formatCommandForLog, normalizeProjectRef, normalizeText, sleep, stripSlackUserMentions } from './utils.js';
import {
  resolveMentionedPersonas,
  resolvePersonasByPlainName,
  selectFollowUpPersona,
} from './personas.js';

// Re-export persona helpers for backwards compatibility with existing test imports
export {
  extractMentionHandles,
  resolveMentionedPersonas,
  resolvePersonasByPlainName,
  selectFollowUpPersona,
} from './personas.js';

const MAX_PROCESSED_MESSAGE_KEYS = 2000;
const PERSONA_REPLY_COOLDOWN_MS = 45_000;
const AD_HOC_THREAD_MEMORY_MS = 60 * 60_000; // 1h
const PROACTIVE_IDLE_MS = 20 * 60_000; // 20 min
const PROACTIVE_MIN_INTERVAL_MS = 90 * 60_000; // per channel
const PROACTIVE_SWEEP_INTERVAL_MS = 60_000;
const PROACTIVE_CODEWATCH_MIN_INTERVAL_MS = 3 * 60 * 60_000; // per project
const MAX_JOB_OUTPUT_CHARS = 12_000;
const HUMAN_REACTION_PROBABILITY = 0.65;
const RANDOM_REACTION_PROBABILITY = 0.25;
const REACTION_DELAY_MIN_MS = 180;
const REACTION_DELAY_MAX_MS = 1200;
const RESPONSE_DELAY_MIN_MS = 700;
const RESPONSE_DELAY_MAX_MS = 3400;
const SOCKET_DISCONNECT_TIMEOUT_MS = 5_000;

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

type TSlackJobName = 'run' | 'review' | 'qa' | 'audit';
type TSlackProviderName = 'claude' | 'codex';

interface ISlackJobRequest {
  job: TSlackJobName;
  projectHint?: string;
  prNumber?: string;
  fixConflicts?: boolean;
}

interface ISlackProviderRequest {
  provider: TSlackProviderName;
  prompt: string;
  projectHint?: string;
}

interface ISlackIssuePickupRequest {
  issueNumber: string;
  issueUrl: string;
  repoHint?: string;
}

interface IAdHocThreadState {
  personaId: string;
  expiresAt: number;
}

function extractLastMeaningfulLines(output: string, maxLines = 4): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return '';
  return lines.slice(-maxLines).join(' | ');
}

interface IInboundSlackEvent {
  type?: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
}

interface IEventsApiPayload {
  ack?: () => Promise<void>;
  event?: IInboundSlackEvent;
  body?: {
    event?: IInboundSlackEvent;
  };
  payload?: {
    event?: IInboundSlackEvent;
  };
}

function extractInboundEvent(payload: IEventsApiPayload): IInboundSlackEvent | null {
  return payload.event ?? payload.body?.event ?? payload.payload?.event ?? null;
}

export function buildInboundMessageKey(
  channel: string,
  ts: string,
  type: string | undefined,
): string {
  return `${channel}:${ts}:${type ?? 'message'}`;
}

// Helper for parsing - uses normalizeText with preservePaths option
function normalizeForParsing(text: string): string {
  return normalizeText(text, { preservePaths: true });
}


export function isAmbientTeamMessage(text: string): boolean {
  const normalized = normalizeForParsing(stripSlackUserMentions(text));
  if (!normalized) return false;

  if (/^(hey|hi|hello|yo|sup)\b/.test(normalized) && /\b(guys|team|everyone|folks)\b/.test(normalized)) {
    return true;
  }

  if (/^(hey|hi|hello|yo|sup)\b/.test(normalized) && normalized.split(' ').length <= 6) {
    return true;
  }

  return false;
}

export function parseSlackJobRequest(text: string): ISlackJobRequest | null {
  const withoutMentions = stripSlackUserMentions(text);
  const normalized = normalizeForParsing(withoutMentions);
  if (!normalized) return null;

  // Be tolerant of wrapped/copied URLs where whitespace/newlines split segments.
  const compactForUrl = withoutMentions.replace(/\s+/g, '');
  const prUrlMatch = compactForUrl.match(/https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i);
  const prPathMatch = compactForUrl.match(/\/pull\/(\d+)(?:[/?#]|$)/i);
  const prHashMatch = withoutMentions.match(/(?:^|\s)#(\d+)(?:\s|$)/);
  const conflictSignal = /\b(conflict|conflicts|merge conflict|merge issues?|rebase)\b/i.test(normalized);
  const requestSignal = /\b(can someone|someone|anyone|please|need|look at|take a look|fix|review|check)\b/i.test(normalized);

  const match = normalized.match(/\b(run|review|qa)\b(?:\s+(?:for|on)?\s*([a-z0-9./_-]+))?/i);
  if (!match && !prUrlMatch && !prHashMatch) return null;

  const explicitJob = match?.[1]?.toLowerCase() as TSlackJobName | undefined;
  const hasPrReference = Boolean(prUrlMatch?.[3] ?? prPathMatch?.[1] ?? prHashMatch?.[1]);
  const inferredReviewJob = conflictSignal || (hasPrReference && requestSignal);
  const job: TSlackJobName | undefined = explicitJob ?? (inferredReviewJob ? 'review' : undefined);
  if (!job || !['run', 'review', 'qa'].includes(job)) return null;

  const prNumber = prUrlMatch?.[3] ?? prPathMatch?.[1] ?? prHashMatch?.[1];
  const repoHintFromUrl = prUrlMatch?.[2]?.toLowerCase();
  const candidates = [match?.[2]?.toLowerCase(), repoHintFromUrl].filter(
    (value): value is string => Boolean(value && !JOB_STOPWORDS.has(value)),
  );
  const projectHint = candidates[0];

  const request: ISlackJobRequest = { job };
  if (projectHint) request.projectHint = projectHint;
  if (prNumber) request.prNumber = prNumber;
  if (job === 'review' && conflictSignal) request.fixConflicts = true;

  return request;
}

export function parseSlackIssuePickupRequest(text: string): ISlackIssuePickupRequest | null {
  const withoutMentions = stripSlackUserMentions(text);
  const normalized = normalizeForParsing(withoutMentions);
  if (!normalized) return null;

  // Extract GitHub issue URL — NOT pull requests (those handled by parseSlackJobRequest)
  const compactForUrl = withoutMentions.replace(/\s+/g, '');

  let issueUrl: string;
  let issueNumber: string;
  let repo: string;

  // Standard format: github.com/{owner}/{repo}/issues/{number}
  const directIssueMatch = compactForUrl.match(/https?:\/\/github\.com\/([^/\s<>]+)\/([^/\s<>]+)\/issues\/(\d+)/i);

  if (directIssueMatch) {
    [issueUrl, , repo, issueNumber] = directIssueMatch;
    repo = repo.toLowerCase();
  } else {
    // Project board format: github.com/...?...&issue={owner}%7C{repo}%7C{number}
    // e.g. github.com/users/jonit-dev/projects/41/views/2?pane=issue&issue=jonit-dev%7Cnight-watch-cli%7C12
    const boardMatch = compactForUrl.match(/https?:\/\/github\.com\/[^<>\s]*[?&]issue=([^<>\s&]+)/i);
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
  const pickupSignal = /\b(pick\s+up|pickup|work\s+on|implement|tackle|start\s+on|grab|handle\s+this|ship\s+this)\b/i.test(normalized);
  const requestSignal = /\b(please|can\s+someone|anyone)\b/i.test(normalized) && /\bthis\s+issue\b/i.test(normalized);
  if (!pickupSignal && !requestSignal) return null;

  return {
    issueNumber,
    issueUrl,
    repoHint: repo,
  };
}

export function parseSlackProviderRequest(text: string): ISlackProviderRequest | null {
  const withoutMentions = stripSlackUserMentions(text);
  if (!withoutMentions.trim()) return null;

  // Explicit direct-provider invocation from Slack, e.g.:
  // "claude fix the flaky tests", "run codex on repo-x: investigate CI failures"
  const prefixMatch = withoutMentions.match(
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

export function shouldIgnoreInboundSlackEvent(
  event: IInboundSlackEvent,
  botUserId: string | null,
): boolean {
  if (!event.channel || !event.ts) return true;
  if (!event.user) return true;
  if (event.subtype) return true;
  if (event.bot_id) return true;
  if (botUserId && event.user === botUserId) return true;
  return false;
}

/**
 * Extract GitHub issue or PR URLs from a message string.
 */
export function extractGitHubIssueUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/github\.com\/[^\s<>]+/g) ?? [];
  return matches.filter((u) => /\/(issues|pull)\/\d+/.test(u));
}

/**
 * Fetch GitHub issue/PR content via `gh api` for agent context.
 * Returns a formatted string, or '' on failure.
 */
async function fetchGitHubIssueContext(urls: string[]): Promise<string> {
  if (urls.length === 0) return '';

  const parts: string[] = [];

  for (const url of urls.slice(0, 3)) {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/);
    if (!match) continue;
    const [, owner, repo, type, number] = match;
    const endpoint =
      type === 'pull'
        ? `/repos/${owner}/${repo}/pulls/${number}`
        : `/repos/${owner}/${repo}/issues/${number}`;

    try {
      const raw = execFileSync('gh', ['api', endpoint, '--jq', '{title: .title, state: .state, body: .body, labels: [.labels[].name]}'], {
        timeout: 10_000,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const data = JSON.parse(raw) as { title: string; state: string; body: string | null; labels: string[] };
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

export class SlackInteractionListener {
  private readonly _config: INightWatchConfig;
  private readonly _slackClient: SlackClient;
  private readonly _engine: DeliberationEngine;
  private _socketClient: SocketModeClient | null = null;
  private _botUserId: string | null = null;
  private readonly _processedMessageKeys = new Set<string>();
  private readonly _processedMessageOrder: string[] = [];
  private readonly _lastPersonaReplyAt = new Map<string, number>();
  private readonly _adHocThreadState = new Map<string, IAdHocThreadState>();
  private readonly _lastChannelActivityAt = new Map<string, number>();
  private readonly _lastProactiveAt = new Map<string, number>();
  private readonly _lastCodeWatchAt = new Map<string, number>();
  private _proactiveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: INightWatchConfig) {
    this._config = config;
    const token = config.slack?.botToken ?? '';
    const serverBaseUrl = config.slack?.serverBaseUrl ?? 'http://localhost:7575';
    this._slackClient = new SlackClient(token, serverBaseUrl);
    this._engine = new DeliberationEngine(this._slackClient, config);
  }

  async start(): Promise<void> {
    const slack = this._config.slack;
    if (
      !slack?.enabled ||
      !slack.discussionEnabled ||
      !slack.botToken ||
      !slack.appToken
    ) {
      return;
    }

    if (this._socketClient) {
      return;
    }

    try {
      this._botUserId = await this._slackClient.getBotUserId();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Slack interaction listener: failed to resolve bot user id (${msg})`);
      this._botUserId = null;
    }

    const socket = new SocketModeClient({
      appToken: slack.appToken,
    });

    const onInboundEvent = (payload: IEventsApiPayload) => {
      void this._handleEventsApi(payload);
    };

    // Socket Mode emits concrete event types (e.g. "app_mention", "message")
    // for Events API payloads in current SDK versions.
    socket.on('app_mention', onInboundEvent);
    socket.on('message', onInboundEvent);
    // Keep compatibility with alternate wrappers/older payload routing.
    socket.on('events_api', onInboundEvent);

    socket.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Slack interaction listener error: ${msg}`);
    });

    await socket.start();
    this._socketClient = socket;
    console.log('Slack interaction listener started (Socket Mode)');
    this._startProactiveLoop();
    void this._postPersonaIntros();
  }

  async stop(): Promise<void> {
    this._stopProactiveLoop();

    if (!this._socketClient) {
      return;
    }

    const socket = this._socketClient;
    this._socketClient = null;

    try {
      await Promise.race([
        socket.disconnect(),
        sleep(SOCKET_DISCONNECT_TIMEOUT_MS).then(() => {
          throw new Error(`timed out after ${SOCKET_DISCONNECT_TIMEOUT_MS}ms`);
        }),
      ]);
      console.log('Slack interaction listener stopped');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Slack interaction listener shutdown failed: ${msg}`);
    } finally {
      socket.removeAllListeners();
    }
  }

  /**
   * Join all configured channels, generate avatars for personas that need them,
   * and post a one-time personality-driven intro for each new persona.
   */
  private async _postPersonaIntros(): Promise<void> {
    const slack = this._config.slack;
    if (!slack) return;

    // Join all configured channels so the bot receives messages in them
    const channelIds = Object.values(slack.channels ?? {}).filter(Boolean);
    const now = Date.now();
    for (const channelId of channelIds) {
      this._lastChannelActivityAt.set(channelId, now);
    }

    for (const channelId of channelIds) {
      try {
        await this._slackClient.joinChannel(channelId);
        console.log(`[slack] Joined channel ${channelId}`);
      } catch {
        // Ignore — channel may already be joined or private
      }
    }

    const engChannelId = slack.channels?.eng;
    if (!engChannelId) return;

    const db = getDb();
    const metaRow = db
      .prepare(`SELECT value FROM schema_meta WHERE key = 'slack_persona_intros_v4'`)
      .get() as { value: string } | undefined;
    const introduced = new Set<string>(
      metaRow ? (JSON.parse(metaRow.value) as string[]) : [],
    );

    const repos = getRepositories();
    const personas = repos.agentPersona.getActive();
    const newPersonas = personas.filter((p) => !introduced.has(p.id));
    if (newPersonas.length === 0) {
      console.log('[slack] All personas already introduced — skipping intros');
      return;
    }

    console.log(`[slack] Introducing ${newPersonas.length} persona(s) to #eng`);

    for (const persona of newPersonas) {
      // Generate avatar if missing and Replicate token is configured
      let currentPersona = persona;
      if (!currentPersona.avatarUrl && slack.replicateApiToken) {
        try {
          console.log(`[slack] Generating avatar for ${persona.name}…`);
          const avatarUrl = await generatePersonaAvatar(persona.name, persona.role, slack.replicateApiToken);
          if (avatarUrl) {
            currentPersona = repos.agentPersona.update(persona.id, { avatarUrl });
            console.log(`[slack] Avatar set for ${persona.name}: ${avatarUrl}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[slack] Avatar generation failed for ${persona.name}: ${msg}`);
        }
      }

      // Personality-driven intro — persona's own voice, no canned boilerplate
      const whoIAm = currentPersona.soul?.whoIAm?.trim() ?? '';
      // Personas are not real Slack users (they share the Night Watch AI bot).
      // Users invoke them by @-mentioning the Night Watch AI bot and including the agent name.
      const howToTag = `To reach me: mention \`@Night Watch AI\` in any message and include my name — e.g. \`@Night Watch AI ${currentPersona.name}, what do you think about this PR?\``;
      const intro = whoIAm
        ? `${whoIAm}\n\n${howToTag}`
        : `*${currentPersona.name}* — ${currentPersona.role}.\n\n${howToTag}`;

      try {
        await this._slackClient.postAsAgent(engChannelId, intro, currentPersona);
        introduced.add(persona.id);
        db.prepare(
          `INSERT INTO schema_meta (key, value) VALUES ('slack_persona_intros_v4', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ).run(JSON.stringify(Array.from(introduced)));
        console.log(`[slack] Intro posted for ${persona.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[slack] Persona intro failed for ${persona.name}: ${msg}`);
      }
    }
  }

  private async _handleEventsApi(payload: IEventsApiPayload): Promise<void> {
    if (payload.ack) {
      try {
        await payload.ack();
      } catch {
        // Ignore ack races/timeouts; processing can continue.
      }
    }

    const event = extractInboundEvent(payload);
    if (!event) return;

    if (event.type !== 'message' && event.type !== 'app_mention') return;

    const ignored = shouldIgnoreInboundSlackEvent(event, this._botUserId);
    if (ignored) {
      console.log(
        `[slack] ignored self/system event type=${event.type ?? '?'} subtype=${event.subtype ?? '-'} channel=${event.channel ?? '-'} user=${event.user ?? '-'} bot_id=${event.bot_id ?? '-'}`,
      );
      return;
    }

    console.log(
      `[slack] inbound human event type=${event.type ?? '?'} channel=${event.channel ?? '-'} user=${event.user ?? '-'} text=${(event.text ?? '').slice(0, 80)}`,
    );

    // Direct bot mentions arrive as app_mention; ignore the mirrored message event
    // to avoid duplicate or out-of-order handling on the same Slack message ts.
    if (
      event.type === 'message'
      && this._botUserId
      && (event.text ?? '').includes(`<@${this._botUserId}>`)
    ) {
      console.log('[slack] ignoring mirrored message event for direct bot mention');
      return;
    }

    try {
      await this._handleInboundMessage(event);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Slack interaction message handling failed: ${msg}`);
    }
  }

  private _rememberMessageKey(key: string): boolean {
    if (this._processedMessageKeys.has(key)) {
      return false;
    }

    this._processedMessageKeys.add(key);
    this._processedMessageOrder.push(key);

    while (this._processedMessageOrder.length > MAX_PROCESSED_MESSAGE_KEYS) {
      const oldest = this._processedMessageOrder.shift();
      if (oldest) {
        this._processedMessageKeys.delete(oldest);
      }
    }

    return true;
  }

  private _isPersonaOnCooldown(
    channel: string,
    threadTs: string,
    personaId: string,
  ): boolean {
    const key = `${channel}:${threadTs}:${personaId}`;
    const last = this._lastPersonaReplyAt.get(key);
    if (!last) return false;
    return Date.now() - last < PERSONA_REPLY_COOLDOWN_MS;
  }

  private _markPersonaReply(
    channel: string,
    threadTs: string,
    personaId: string,
  ): void {
    const key = `${channel}:${threadTs}:${personaId}`;
    this._lastPersonaReplyAt.set(key, Date.now());
  }

  private _threadKey(channel: string, threadTs: string): string {
    return `${channel}:${threadTs}`;
  }

  private _markChannelActivity(channel: string): void {
    this._lastChannelActivityAt.set(channel, Date.now());
  }

  private _rememberAdHocThreadPersona(
    channel: string,
    threadTs: string,
    personaId: string,
  ): void {
    this._adHocThreadState.set(this._threadKey(channel, threadTs), {
      personaId,
      expiresAt: Date.now() + AD_HOC_THREAD_MEMORY_MS,
    });
  }

  /**
   * After an agent posts a reply, check if the text mentions other personas by plain name.
   * If so, trigger those personas to respond once (no further cascading — depth 1 only).
   * This enables natural agent-to-agent handoffs like "Carlos, what's the priority here?"
   */
  private async _followAgentMentions(
    postedText: string,
    channel: string,
    threadTs: string,
    personas: IAgentPersona[],
    projectContext: string,
    skipPersonaId: string,
  ): Promise<void> {
    if (!postedText) return;

    const mentioned = resolvePersonasByPlainName(postedText, personas).filter(
      (p) => p.id !== skipPersonaId && !this._isPersonaOnCooldown(channel, threadTs, p.id),
    );

    if (mentioned.length === 0) return;

    console.log(`[slack] agent mention follow-up: ${mentioned.map((p) => p.name).join(', ')}`);

    for (const persona of mentioned) {
      // Small human-like delay before the tagged persona responds
      await sleep(this._randomInt(RESPONSE_DELAY_MIN_MS * 2, RESPONSE_DELAY_MAX_MS * 3));
      // replyAsAgent fetches thread history internally so Carlos sees Dev's message
      await this._engine.replyAsAgent(channel, threadTs, postedText, persona, projectContext);
      this._markPersonaReply(channel, threadTs, persona.id);
      this._rememberAdHocThreadPersona(channel, threadTs, persona.id);
    }
  }

  /**
   * Recover the persona that last replied in a thread by scanning its history.
   * Used as a fallback when in-memory state was lost (e.g. after a server restart).
   * Matches message `username` fields against known persona names.
   */
  private async _recoverPersonaFromThreadHistory(
    channel: string,
    threadTs: string,
    personas: IAgentPersona[],
  ): Promise<IAgentPersona | null> {
    try {
      const history = await this._slackClient.getChannelHistory(channel, threadTs, 50);
      // Walk backwards to find the most recent message sent by a persona
      for (const msg of [...history].reverse()) {
        if (!msg.username) continue;
        const matched = personas.find(
          (p) => p.name.toLowerCase() === msg.username!.toLowerCase(),
        );
        if (matched) return matched;
      }
    } catch {
      // Ignore — treat as no prior context
    }
    return null;
  }

  private _getRememberedAdHocPersona(
    channel: string,
    threadTs: string,
    personas: IAgentPersona[],
  ): IAgentPersona | null {
    const key = this._threadKey(channel, threadTs);
    const remembered = this._adHocThreadState.get(key);
    if (!remembered) return null;
    if (Date.now() > remembered.expiresAt) {
      this._adHocThreadState.delete(key);
      return null;
    }
    return personas.find((p) => p.id === remembered.personaId) ?? null;
  }

  private _pickRandomPersona(
    personas: IAgentPersona[],
    channel: string,
    threadTs: string,
  ): IAgentPersona | null {
    if (personas.length === 0) return null;
    const available = personas.filter((p) => !this._isPersonaOnCooldown(channel, threadTs, p.id));
    const pool = available.length > 0 ? available : personas;
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  }

  private _findPersonaByName(personas: IAgentPersona[], name: string): IAgentPersona | null {
    const target = name.toLowerCase();
    return personas.find((p) => p.name.toLowerCase() === target) ?? null;
  }

  private _buildProjectContext(channel: string, projects: IRegistryEntry[]): string {
    if (projects.length === 0) return '';
    const inChannel = projects.find((p) => p.slackChannelId === channel);
    const names = projects.map((p) => p.name).join(', ');
    if (inChannel) {
      return `Current channel project: ${inChannel.name}. Registered projects: ${names}.`;
    }
    return `Registered projects: ${names}.`;
  }

  private _buildRoadmapContext(channel: string, projects: IRegistryEntry[]): string {
    if (projects.length === 0) return '';

    const parts: string[] = [];
    for (const project of projects) {
      try {
        const status = getRoadmapStatus(project.path, this._config);
        if (!status.found || status.items.length === 0) continue;

        const pending = status.items.filter((i) => !i.processed && !i.checked);
        const done = status.items.filter((i) => i.processed);
        const total = status.items.length;

        let summary = `${project.name}: ${done.length}/${total} roadmap items done`;
        if (pending.length > 0) {
          const nextItems = pending.slice(0, 3).map((i) => i.title);
          summary += `. Next up: ${nextItems.join(', ')}`;
        }
        if (done.length === total) {
          summary += ' (all complete)';
        }
        parts.push(summary);
      } catch {
        // Skip projects where roadmap can't be read
      }
    }

    return parts.join('\n');
  }

  private _resolveProjectByHint(
    projects: IRegistryEntry[],
    hint: string,
  ): IRegistryEntry | null {
    const normalizedHint = normalizeProjectRef(hint);
    if (!normalizedHint) return null;

    const byNameExact = projects.find(
      (p) => normalizeProjectRef(p.name) === normalizedHint,
    );
    if (byNameExact) return byNameExact;

    const byPathExact = projects.find((p) => {
      const base = p.path.split('/').pop() ?? '';
      return normalizeProjectRef(base) === normalizedHint;
    });
    if (byPathExact) return byPathExact;

    const byNameContains = projects.find((p) =>
      normalizeProjectRef(p.name).includes(normalizedHint),
    );
    if (byNameContains) return byNameContains;

    return projects.find((p) => {
      const base = p.path.split('/').pop() ?? '';
      return normalizeProjectRef(base).includes(normalizedHint);
    }) ?? null;
  }

  private _resolveTargetProject(
    channel: string,
    projects: IRegistryEntry[],
    projectHint?: string,
  ): IRegistryEntry | null {
    if (projectHint) {
      return this._resolveProjectByHint(projects, projectHint);
    }
    const byChannel = projects.find((p) => p.slackChannelId === channel);
    if (byChannel) return byChannel;
    if (projects.length === 1) return projects[0];
    return null;
  }

  private _isMessageAddressedToBot(event: IInboundSlackEvent): boolean {
    if (event.type === 'app_mention') return true;
    const text = normalizeForParsing(stripSlackUserMentions(event.text ?? ''));
    return /^night[-\s]?watch\b/.test(text) || /^nw\b/.test(text);
  }

  private _randomInt(min: number, max: number): number {
    if (max <= min) return min;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private _reactionCandidatesForPersona(persona: IAgentPersona): string[] {
    const role = persona.role.toLowerCase();
    if (role.includes('security')) return ['eyes', 'thinking_face', 'shield', 'thumbsup'];
    if (role.includes('qa') || role.includes('quality')) return ['test_tube', 'mag', 'thinking_face', 'thumbsup'];
    if (role.includes('lead') || role.includes('architect')) return ['thinking_face', 'thumbsup', 'memo', 'eyes'];
    if (role.includes('implementer') || role.includes('developer')) return ['wrench', 'hammer_and_wrench', 'thumbsup', 'eyes'];
    return ['eyes', 'thinking_face', 'thumbsup', 'wave'];
  }

  private async _maybeReactToHumanMessage(
    channel: string,
    messageTs: string,
    persona: IAgentPersona,
  ): Promise<void> {
    if (Math.random() > HUMAN_REACTION_PROBABILITY) {
      return;
    }

    const candidates = this._reactionCandidatesForPersona(persona);
    const reaction = candidates[this._randomInt(0, candidates.length - 1)];

    await sleep(this._randomInt(REACTION_DELAY_MIN_MS, REACTION_DELAY_MAX_MS));
    try {
      await this._slackClient.addReaction(channel, messageTs, reaction);
    } catch {
      // Ignore reaction failures (permissions, already reacted, etc.)
    }
  }

  private async _applyHumanResponseTiming(
    channel: string,
    messageTs: string,
    persona: IAgentPersona,
  ): Promise<void> {
    await this._maybeReactToHumanMessage(channel, messageTs, persona);
    await sleep(this._randomInt(RESPONSE_DELAY_MIN_MS, RESPONSE_DELAY_MAX_MS));
  }

  private async _spawnNightWatchJob(
    job: TSlackJobName,
    project: IRegistryEntry,
    channel: string,
    threadTs: string,
    persona: IAgentPersona,
    opts?: { prNumber?: string; fixConflicts?: boolean; issueNumber?: string },
  ): Promise<void> {
    const invocationArgs = buildCurrentCliInvocation([job]);
    const prRef = opts?.prNumber ? ` PR #${opts.prNumber}` : '';
    if (!invocationArgs) {
      console.warn(
        `[slack][job] ${persona.name} cannot start ${job} for ${project.name}${prRef ? ` (${prRef.trim()})` : ''}: CLI entry path unavailable`,
      );
      await this._slackClient.postAsAgent(
        channel,
        `Can't start that ${job} right now — runtime issue. Checking it.`,
        persona,
        threadTs,
      );
      this._markChannelActivity(channel);
      this._markPersonaReply(channel, threadTs, persona.id);
      return;
    }

    console.log(
      `[slack][job] persona=${persona.name} project=${project.name}${opts?.prNumber ? ` pr=${opts.prNumber}` : ''} spawn=${formatCommandForLog(process.execPath, invocationArgs)}`,
    );

    const child = spawn(
      process.execPath,
      invocationArgs,
      {
        cwd: project.path,
        env: {
          ...process.env,
          NW_EXECUTION_CONTEXT: 'agent',
          ...(opts?.prNumber ? { NW_TARGET_PR: opts.prNumber } : {}),
          ...(opts?.issueNumber ? { NW_TARGET_ISSUE: opts.issueNumber } : {}),
          ...(opts?.fixConflicts
            ? {
              NW_SLACK_FEEDBACK: JSON.stringify({
                source: 'slack',
                kind: 'merge_conflict_resolution',
                prNumber: opts.prNumber ?? '',
                changes: 'Resolve merge conflicts and stabilize the PR for re-review.',
              }),
            }
            : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    console.log(
      `[slack][job] ${persona.name} spawned ${job} for ${project.name}${opts?.prNumber ? ` (PR #${opts.prNumber})` : ''} pid=${child.pid ?? 'unknown'}`,
    );

    let output = '';
    let errored = false;
    const appendOutput = (chunk: Buffer): void => {
      output += chunk.toString();
      if (output.length > MAX_JOB_OUTPUT_CHARS) {
        output = output.slice(-MAX_JOB_OUTPUT_CHARS);
      }
    };

    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);

    child.on('error', async (err) => {
      errored = true;
      console.warn(
        `[slack][job] ${persona.name} ${job} spawn error for ${project.name}${opts?.prNumber ? ` (PR #${opts.prNumber})` : ''}: ${err.message}`,
      );
      await this._slackClient.postAsAgent(
        channel,
        `Couldn't kick off that ${job}. Error logged — looking into it.`,
        persona,
        threadTs,
      );
      this._markChannelActivity(channel);
      this._markPersonaReply(channel, threadTs, persona.id);
    });

    child.on('close', async (code) => {
      if (errored) return;
      console.log(
        `[slack][job] ${persona.name} ${job} finished for ${project.name}${opts?.prNumber ? ` (PR #${opts.prNumber})` : ''} exit=${code ?? 'unknown'}`,
      );
      const parsed = parseScriptResult(output);
      const status = parsed?.status ? ` (${parsed.status})` : '';
      const detail = extractLastMeaningfulLines(output);

      if (code === 0) {
        const doneMessage =
          job === 'review'
            ? `Review done${prRef ? ` on${prRef}` : ''}.`
            : job === 'qa'
              ? `QA pass done${prRef ? ` on${prRef}` : ''}.`
              : `Run finished${prRef ? ` for${prRef}` : ''}.`;
        await this._slackClient.postAsAgent(
          channel,
          doneMessage,
          persona,
          threadTs,
        );
      } else {
        if (detail) {
          console.warn(`[slack][job] ${persona.name} ${job} failure detail: ${detail}`);
        }
        await this._slackClient.postAsAgent(
          channel,
          `Hit a snag running ${job}${prRef ? ` on${prRef}` : ''}. Logged the details — looking into it.`,
          persona,
          threadTs,
        );
      }
      if (code !== 0 && status) {
        console.warn(`[slack][job] ${persona.name} ${job} status=${status.replace(/[()]/g, '')}`);
      }
      this._markChannelActivity(channel);
      this._markPersonaReply(channel, threadTs, persona.id);
    });
  }

  private async _spawnDirectProviderRequest(
    request: ISlackProviderRequest,
    project: IRegistryEntry,
    channel: string,
    threadTs: string,
    persona: IAgentPersona,
  ): Promise<void> {
    const providerLabel = request.provider === 'claude' ? 'Claude' : 'Codex';
    const args = request.provider === 'claude'
      ? ['-p', request.prompt, '--dangerously-skip-permissions']
      : ['--quiet', '--yolo', '--prompt', request.prompt];

    console.log(
      `[slack][provider] persona=${persona.name} provider=${request.provider} project=${project.name} spawn=${formatCommandForLog(request.provider, args)}`,
    );

    const child = spawn(
      request.provider,
      args,
      {
        cwd: project.path,
        env: {
          ...process.env,
          ...(this._config.providerEnv ?? {}),
          NW_EXECUTION_CONTEXT: 'agent',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    console.log(
      `[slack][provider] ${persona.name} spawned ${request.provider} for ${project.name} pid=${child.pid ?? 'unknown'}`,
    );

    let output = '';
    let errored = false;
    const appendOutput = (chunk: Buffer): void => {
      output += chunk.toString();
      if (output.length > MAX_JOB_OUTPUT_CHARS) {
        output = output.slice(-MAX_JOB_OUTPUT_CHARS);
      }
    };

    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);

    child.on('error', async (err) => {
      errored = true;
      console.warn(
        `[slack][provider] ${persona.name} ${request.provider} spawn error for ${project.name}: ${err.message}`,
      );
      await this._slackClient.postAsAgent(
        channel,
        `Couldn't start ${providerLabel}. Error logged — looking into it.`,
        persona,
        threadTs,
      );
      this._markChannelActivity(channel);
      this._markPersonaReply(channel, threadTs, persona.id);
    });

    child.on('close', async (code) => {
      if (errored) return;
      console.log(
        `[slack][provider] ${persona.name} ${request.provider} finished for ${project.name} exit=${code ?? 'unknown'}`,
      );

      const detail = extractLastMeaningfulLines(output);
      if (code === 0) {
        await this._slackClient.postAsAgent(
          channel,
          `${providerLabel} command finished.`,
          persona,
          threadTs,
        );
      } else {
        if (detail) {
          console.warn(`[slack][provider] ${persona.name} ${request.provider} failure detail: ${detail}`);
        }
        await this._slackClient.postAsAgent(
          channel,
          `${providerLabel} hit a snag. Logged the details — looking into it.`,
          persona,
          threadTs,
        );
      }

      this._markChannelActivity(channel);
      this._markPersonaReply(channel, threadTs, persona.id);
    });
  }

  private async _triggerDirectProviderIfRequested(
    event: IInboundSlackEvent,
    channel: string,
    threadTs: string,
    messageTs: string,
    personas: IAgentPersona[],
  ): Promise<boolean> {
    const request = parseSlackProviderRequest(event.text ?? '');
    if (!request) return false;

    const addressedToBot = this._isMessageAddressedToBot(event);
    const normalized = normalizeForParsing(stripSlackUserMentions(event.text ?? ''));
    const startsWithProviderCommand = /^(?:can\s+(?:you|someone|anyone)\s+)?(?:please\s+)?(?:(?:run|use|invoke|trigger|ask)\s+)?(?:claude|codex)\b/i.test(normalized);
    if (!addressedToBot && !startsWithProviderCommand) {
      return false;
    }

    const repos = getRepositories();
    const projects = repos.projectRegistry.getAll();
    const persona =
      this._findPersonaByName(personas, 'Dev')
      ?? this._pickRandomPersona(personas, channel, threadTs)
      ?? personas[0];
    if (!persona) return false;

    const targetProject = this._resolveTargetProject(channel, projects, request.projectHint);
    if (!targetProject) {
      const projectNames = projects.map((p) => p.name).join(', ') || '(none registered)';
      await this._slackClient.postAsAgent(
        channel,
        `Which project? Registered: ${projectNames}.`,
        persona,
        threadTs,
      );
      this._markChannelActivity(channel);
      this._markPersonaReply(channel, threadTs, persona.id);
      return true;
    }

    console.log(
      `[slack][provider] routing provider=${request.provider} to persona=${persona.name} project=${targetProject.name}`,
    );

    const providerLabel = request.provider === 'claude' ? 'Claude' : 'Codex';
    const compactPrompt = request.prompt.replace(/\s+/g, ' ').trim();
    const promptPreview = compactPrompt.length > 120
      ? `${compactPrompt.slice(0, 117)}...`
      : compactPrompt;

    await this._applyHumanResponseTiming(channel, messageTs, persona);
    await this._slackClient.postAsAgent(
      channel,
      `Running ${providerLabel} directly${request.projectHint ? ` on ${targetProject.name}` : ''}: "${promptPreview}"`,
      persona,
      threadTs,
    );
    this._markChannelActivity(channel);
    this._markPersonaReply(channel, threadTs, persona.id);
    this._rememberAdHocThreadPersona(channel, threadTs, persona.id);

    await this._spawnDirectProviderRequest(
      request,
      targetProject,
      channel,
      threadTs,
      persona,
    );
    return true;
  }

  private async _triggerSlackJobIfRequested(
    event: IInboundSlackEvent,
    channel: string,
    threadTs: string,
    messageTs: string,
    personas: IAgentPersona[],
  ): Promise<boolean> {
    const request = parseSlackJobRequest(event.text ?? '');
    if (!request) return false;

    const addressedToBot = this._isMessageAddressedToBot(event);
    const normalized = normalizeForParsing(stripSlackUserMentions(event.text ?? ''));
    const teamRequestLanguage = /\b(can someone|someone|anyone|please|need)\b/i.test(normalized);
    const startsWithCommand = /^(run|review|qa)\b/i.test(normalized);

    if (
      !addressedToBot
      && !request.prNumber
      && !request.fixConflicts
      && !teamRequestLanguage
      && !startsWithCommand
    ) {
      return false;
    }

    const repos = getRepositories();
    const projects = repos.projectRegistry.getAll();

    const persona =
      (request.job === 'run' ? this._findPersonaByName(personas, 'Dev') : null)
      ?? (request.job === 'qa' ? this._findPersonaByName(personas, 'Priya') : null)
      ?? (request.job === 'review' ? this._findPersonaByName(personas, 'Carlos') : null)
      ?? this._pickRandomPersona(personas, channel, threadTs)
      ?? personas[0];

    if (!persona) return false;

    const targetProject = this._resolveTargetProject(channel, projects, request.projectHint);
    if (!targetProject) {
      const projectNames = projects.map((p) => p.name).join(', ') || '(none registered)';
      await this._slackClient.postAsAgent(
        channel,
        `Which project? Registered: ${projectNames}.`,
        persona,
        threadTs,
      );
      this._markChannelActivity(channel);
      this._markPersonaReply(channel, threadTs, persona.id);
      return true;
    }

    console.log(
      `[slack][job] routing job=${request.job} to persona=${persona.name} project=${targetProject.name}${request.prNumber ? ` pr=${request.prNumber}` : ''}${request.fixConflicts ? ' fix_conflicts=true' : ''}`,
    );

    const planLine =
      request.job === 'review'
        ? `On it${request.prNumber ? ` — PR #${request.prNumber}` : ''}${request.fixConflicts ? ', including the conflicts' : ''}.`
        : request.job === 'qa'
          ? `Running QA${request.prNumber ? ` on #${request.prNumber}` : ''}.`
          : `Starting the run${request.prNumber ? ` for #${request.prNumber}` : ''}.`;

    await this._applyHumanResponseTiming(channel, messageTs, persona);

    await this._slackClient.postAsAgent(
      channel,
      `${planLine}`,
      persona,
      threadTs,
    );
    console.log(
      `[slack][job] ${persona.name} accepted job=${request.job} project=${targetProject.name}${request.prNumber ? ` pr=${request.prNumber}` : ''}`,
    );
    this._markChannelActivity(channel);
    this._markPersonaReply(channel, threadTs, persona.id);
    this._rememberAdHocThreadPersona(channel, threadTs, persona.id);

    await this._spawnNightWatchJob(
      request.job,
      targetProject,
      channel,
      threadTs,
      persona,
      { prNumber: request.prNumber, fixConflicts: request.fixConflicts },
    );
    return true;
  }

  private async _triggerIssuePickupIfRequested(
    event: IInboundSlackEvent,
    channel: string,
    threadTs: string,
    messageTs: string,
    personas: IAgentPersona[],
  ): Promise<boolean> {
    const request = parseSlackIssuePickupRequest(event.text ?? '');
    if (!request) return false;

    const addressedToBot = this._isMessageAddressedToBot(event);
    const normalized = normalizeForParsing(stripSlackUserMentions(event.text ?? ''));
    const teamRequestLanguage = /\b(can someone|someone|anyone|please|need)\b/i.test(normalized);
    if (!addressedToBot && !teamRequestLanguage) return false;

    const repos = getRepositories();
    const projects = repos.projectRegistry.getAll();

    const persona =
      this._findPersonaByName(personas, 'Dev')
      ?? this._pickRandomPersona(personas, channel, threadTs)
      ?? personas[0];
    if (!persona) return false;

    const targetProject = this._resolveTargetProject(channel, projects, request.repoHint);
    if (!targetProject) {
      const projectNames = projects.map((p) => p.name).join(', ') || '(none registered)';
      await this._slackClient.postAsAgent(
        channel,
        `Which project? Registered: ${projectNames}.`,
        persona,
        threadTs,
      );
      this._markChannelActivity(channel);
      this._markPersonaReply(channel, threadTs, persona.id);
      return true;
    }

    console.log(
      `[slack][issue-pickup] routing issue=#${request.issueNumber} to persona=${persona.name} project=${targetProject.name}`,
    );

    await this._applyHumanResponseTiming(channel, messageTs, persona);
    await this._slackClient.postAsAgent(
      channel,
      `On it — picking up #${request.issueNumber}. Starting the run now.`,
      persona,
      threadTs,
    );
    this._markChannelActivity(channel);
    this._markPersonaReply(channel, threadTs, persona.id);
    this._rememberAdHocThreadPersona(channel, threadTs, persona.id);

    // Move issue to In Progress on board (best-effort, spawn via CLI subprocess)
    const boardArgs = buildCurrentCliInvocation([
      'board', 'move-issue', request.issueNumber, '--column', 'In Progress',
    ]);
    if (boardArgs) {
      try {
        execFileSync(process.execPath, boardArgs, {
          cwd: targetProject.path,
          timeout: 15_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        console.log(`[slack][issue-pickup] moved #${request.issueNumber} to In Progress`);
      } catch {
        console.warn(`[slack][issue-pickup] failed to move #${request.issueNumber} to In Progress`);
      }
    }

    console.log(`[slack][issue-pickup] spawning run for #${request.issueNumber}`);
    await this._spawnNightWatchJob('run', targetProject, channel, threadTs, persona, {
      issueNumber: request.issueNumber,
    });
    return true;
  }

  private _resolveProactiveChannelForProject(project: IRegistryEntry): string | null {
    const slack = this._config.slack;
    if (!slack) return null;
    return project.slackChannelId || slack.channels.eng || null;
  }

  private _spawnCodeWatchAudit(project: IRegistryEntry, channel: string): void {
    if (!fs.existsSync(project.path)) {
      console.warn(
        `[slack][codewatch] audit skipped for ${project.name}: missing project path ${project.path}`,
      );
      return;
    }

    const invocationArgs = buildCurrentCliInvocation(['audit']);
    if (!invocationArgs) {
      console.warn(`[slack][codewatch] audit spawn failed for ${project.name}: CLI entry path unavailable`);
      return;
    }

    console.log(
      `[slack][codewatch] spawning audit for ${project.name} → ${channel} cmd=${formatCommandForLog(process.execPath, invocationArgs)}`,
    );

    const startedAt = Date.now();
    const child = spawn(process.execPath, invocationArgs, {
      cwd: project.path,
      env: { ...process.env, NW_EXECUTION_CONTEXT: 'agent' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    console.log(`[slack][codewatch] audit spawned for ${project.name} pid=${child.pid ?? 'unknown'}`);
    let output = '';
    const appendOutput = (chunk: Buffer): void => {
      output += chunk.toString();
      if (output.length > MAX_JOB_OUTPUT_CHARS) {
        output = output.slice(-MAX_JOB_OUTPUT_CHARS);
      }
    };

    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);

    let spawnErrored = false;
    child.on('error', (err) => {
      spawnErrored = true;
      console.warn(`[slack][codewatch] audit spawn error for ${project.name}: ${err.message}`);
    });

    child.on('close', async (code) => {
      console.log(`[slack][codewatch] audit finished for ${project.name} exit=${code ?? 'unknown'}`);
      if (spawnErrored) {
        return;
      }

      if (code !== 0) {
        const detail = extractLastMeaningfulLines(output);
        if (detail) {
          console.warn(`[slack][codewatch] audit failure detail for ${project.name}: ${detail}`);
        }
        return;
      }

      const reportPath = path.join(project.path, 'logs', 'audit-report.md');
      let reportStat: fs.Stats;
      let report: string;
      try {
        reportStat = fs.statSync(reportPath);
        report = fs.readFileSync(reportPath, 'utf-8').trim();
      } catch {
        const parsed = parseScriptResult(output);
        if (parsed?.status?.startsWith('skip_')) {
          console.log(`[slack][codewatch] audit skipped for ${project.name} (${parsed.status})`);
        } else {
          console.log(`[slack][codewatch] no audit report found at ${reportPath}`);
        }
        return;
      }

      // Ignore old reports when an audit exits early without producing a fresh output.
      if (reportStat.mtimeMs + 1000 < startedAt) {
        console.log(`[slack][codewatch] stale audit report ignored at ${reportPath}`);
        return;
      }

      if (!report) {
        console.log(`[slack][codewatch] empty audit report ignored at ${reportPath}`);
        return;
      }

      try {
        await this._engine.handleAuditReport(report, project.name, project.path, channel);
        this._markChannelActivity(channel);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[slack][codewatch] handleAuditReport failed for ${project.name}: ${msg}`);
      }
    });
  }

  private async _runProactiveCodeWatch(
    projects: IRegistryEntry[],
    now: number,
  ): Promise<void> {
    for (const project of projects) {
      const channel = this._resolveProactiveChannelForProject(project);
      if (!channel) continue;

      const lastScan = this._lastCodeWatchAt.get(project.path) ?? 0;
      if (now - lastScan < PROACTIVE_CODEWATCH_MIN_INTERVAL_MS) {
        continue;
      }
      this._lastCodeWatchAt.set(project.path, now);

      this._spawnCodeWatchAudit(project, channel);
    }
  }

  private _startProactiveLoop(): void {
    if (this._proactiveTimer) return;

    this._proactiveTimer = setInterval(() => {
      void this._sendProactiveMessages();
    }, PROACTIVE_SWEEP_INTERVAL_MS);

    this._proactiveTimer.unref?.();
  }

  private _stopProactiveLoop(): void {
    if (!this._proactiveTimer) return;
    clearInterval(this._proactiveTimer);
    this._proactiveTimer = null;
  }

  private async _sendProactiveMessages(): Promise<void> {
    const slack = this._config.slack;
    if (!slack?.enabled || !slack.discussionEnabled) return;

    const channelIds = Object.values(slack.channels ?? {}).filter(Boolean);
    if (channelIds.length === 0) return;

    const repos = getRepositories();
    const personas = repos.agentPersona.getActive();
    if (personas.length === 0) return;

    const now = Date.now();
    const projects = repos.projectRegistry.getAll();
    await this._runProactiveCodeWatch(projects, now);

    for (const channel of channelIds) {
      const lastActivity = this._lastChannelActivityAt.get(channel) ?? now;
      const lastProactive = this._lastProactiveAt.get(channel) ?? 0;
      if (now - lastActivity < PROACTIVE_IDLE_MS) continue;
      if (now - lastProactive < PROACTIVE_MIN_INTERVAL_MS) continue;

      const persona = this._pickRandomPersona(personas, channel, `${now}`) ?? personas[0];
      if (!persona) continue;

      const projectContext = this._buildProjectContext(channel, projects);
      const roadmapContext = this._buildRoadmapContext(channel, projects);

      try {
        await this._engine.postProactiveMessage(channel, persona, projectContext, roadmapContext);
        this._lastProactiveAt.set(channel, now);
        this._markChannelActivity(channel);
        console.log(`[slack] proactive message posted by ${persona.name} in ${channel}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Slack proactive message failed: ${msg}`);
      }
    }
  }

  private async _handleInboundMessage(event: IInboundSlackEvent): Promise<void> {
    if (shouldIgnoreInboundSlackEvent(event, this._botUserId)) {
      console.log(`[slack] ignoring event — failed shouldIgnore check (user=${event.user}, bot_id=${event.bot_id ?? '-'}, subtype=${event.subtype ?? '-'})`);
      return;
    }

    const channel = event.channel as string;
    const ts = event.ts as string;
    const threadTs = event.thread_ts ?? ts;
    const text = event.text ?? '';
    const messageKey = buildInboundMessageKey(channel, ts, event.type);
    this._markChannelActivity(channel);

    // Deduplicate retried/replayed events to prevent response loops.
    if (!this._rememberMessageKey(messageKey)) {
      console.log(`[slack] duplicate event ${messageKey} — skipping`);
      return;
    }

    const repos = getRepositories();
    const personas = repos.agentPersona.getActive();
    const projects = repos.projectRegistry.getAll();
    const projectContext = this._buildProjectContext(channel, projects);

    // Fetch GitHub issue/PR content from URLs in the message so agents can inspect them.
    const githubUrls = extractGitHubIssueUrls(text);
    console.log(`[slack] processing message channel=${channel} thread=${threadTs} urls=${githubUrls.length}`);
    const githubContext = githubUrls.length > 0 ? await fetchGitHubIssueContext(githubUrls) : '';
    const fullContext = githubContext ? `${projectContext}\n\nReferenced GitHub content:\n${githubContext}` : projectContext;

    if (await this._triggerDirectProviderIfRequested(event, channel, threadTs, ts, personas)) {
      return;
    }

    if (await this._triggerSlackJobIfRequested(event, channel, threadTs, ts, personas)) {
      return;
    }

    if (await this._triggerIssuePickupIfRequested(event, channel, threadTs, ts, personas)) {
      return;
    }

    // @mention matching: "@maya ..."
    let mentionedPersonas = resolveMentionedPersonas(text, personas);

    // Also try plain-name matching (e.g. "Carlos, are you there?").
    // For app_mention text like "<@UBOTID> maya check this", the @-regex won't find "maya".
    if (mentionedPersonas.length === 0) {
      mentionedPersonas = resolvePersonasByPlainName(text, personas);
      if (mentionedPersonas.length > 0) {
        console.log(`[slack] plain-name match: ${mentionedPersonas.map((p) => p.name).join(', ')}`);
      }
    }

    // Persona mentioned → respond regardless of whether a formal discussion exists.
    if (mentionedPersonas.length > 0) {
      console.log(`[slack] routing to persona(s): ${mentionedPersonas.map((p) => p.name).join(', ')} in ${channel}`);
      const discussion = repos
        .slackDiscussion
        .getActive('')
        .find((d) => d.channelId === channel && d.threadTs === threadTs);

      let lastPosted = '';
      let lastPersonaId = '';
      for (const persona of mentionedPersonas) {
        if (this._isPersonaOnCooldown(channel, threadTs, persona.id)) {
          console.log(`[slack] ${persona.name} is on cooldown — skipping`);
          continue;
        }
        await this._applyHumanResponseTiming(channel, ts, persona);
        if (discussion) {
          await this._engine.contributeAsAgent(discussion.id, persona);
        } else {
          console.log(`[slack] replying as ${persona.name} in ${channel}`);
          lastPosted = await this._engine.replyAsAgent(channel, threadTs, text, persona, fullContext);
          lastPersonaId = persona.id;
        }
        this._markPersonaReply(channel, threadTs, persona.id);
      }

      if (!discussion && mentionedPersonas[0]) {
        this._rememberAdHocThreadPersona(channel, threadTs, mentionedPersonas[0].id);
      }

      // Follow up if the last agent reply mentions other teammates by name.
      if (lastPosted && lastPersonaId) {
        await this._followAgentMentions(lastPosted, channel, threadTs, personas, fullContext, lastPersonaId);
      }
      return;
    }

    console.log(`[slack] no persona match — checking for active discussion in ${channel}:${threadTs}`);

    // No persona mention — only handle within an existing Night Watch discussion thread.
    const discussion = repos
      .slackDiscussion
      .getActive('')
      .find((d) => d.channelId === channel && d.threadTs === threadTs);

    if (discussion) {
      await this._engine.handleHumanMessage(
        channel,
        threadTs,
        text,
        event.user as string,
      );
      return;
    }

    // Continue ad-hoc threads even without a persisted discussion.
    const rememberedPersona = this._getRememberedAdHocPersona(channel, threadTs, personas);
    if (rememberedPersona) {
      const followUpPersona = selectFollowUpPersona(rememberedPersona, personas, text);
      if (followUpPersona.id !== rememberedPersona.id) {
        console.log(`[slack] handing off ad-hoc thread from ${rememberedPersona.name} to ${followUpPersona.name} based on topic`);
      } else {
        console.log(`[slack] continuing ad-hoc thread with ${rememberedPersona.name}`);
      }
      await this._applyHumanResponseTiming(channel, ts, followUpPersona);
      console.log(`[slack] replying as ${followUpPersona.name} in ${channel}`);
      const postedText = await this._engine.replyAsAgent(channel, threadTs, text, followUpPersona, fullContext);
      this._markPersonaReply(channel, threadTs, followUpPersona.id);
      this._rememberAdHocThreadPersona(channel, threadTs, followUpPersona.id);
      await this._followAgentMentions(postedText, channel, threadTs, personas, fullContext, followUpPersona.id);
      return;
    }

    // In-memory state was lost (e.g. server restart) — recover persona from thread history.
    if (threadTs) {
      const recoveredPersona = await this._recoverPersonaFromThreadHistory(channel, threadTs, personas);
      if (recoveredPersona) {
        const followUpPersona = selectFollowUpPersona(recoveredPersona, personas, text);
        console.log(`[slack] recovered ad-hoc thread persona ${recoveredPersona.name} from history, replying as ${followUpPersona.name}`);
        await this._applyHumanResponseTiming(channel, ts, followUpPersona);
        console.log(`[slack] replying as ${followUpPersona.name} in ${channel}`);
        const postedText = await this._engine.replyAsAgent(channel, threadTs, text, followUpPersona, fullContext);
        this._markPersonaReply(channel, threadTs, followUpPersona.id);
        this._rememberAdHocThreadPersona(channel, threadTs, followUpPersona.id);
        await this._followAgentMentions(postedText, channel, threadTs, personas, fullContext, followUpPersona.id);
        return;
      }
    }

    // Direct bot mentions always get a reply.
    if (event.type === 'app_mention') {
      const randomPersona = this._pickRandomPersona(personas, channel, threadTs);
      if (randomPersona) {
        console.log(`[slack] app_mention auto-engaging via ${randomPersona.name}`);
        await this._applyHumanResponseTiming(channel, ts, randomPersona);
        const postedText = await this._engine.replyAsAgent(channel, threadTs, text, randomPersona, fullContext);
        this._markPersonaReply(channel, threadTs, randomPersona.id);
        this._rememberAdHocThreadPersona(channel, threadTs, randomPersona.id);
        await this._followAgentMentions(postedText, channel, threadTs, personas, fullContext, randomPersona.id);
        return;
      }
    }

    // Any human message: agents independently decide whether to react.
    for (const persona of personas) {
      if (!this._isPersonaOnCooldown(channel, threadTs, persona.id) && Math.random() < RANDOM_REACTION_PROBABILITY) {
        void this._maybeReactToHumanMessage(channel, ts, persona);
      }
    }

    // Guaranteed fallback reply — someone always responds.
    const randomPersona = this._pickRandomPersona(personas, channel, threadTs);
    if (randomPersona) {
      console.log(`[slack] fallback engage via ${randomPersona.name}`);
      await this._applyHumanResponseTiming(channel, ts, randomPersona);
      const postedText = await this._engine.replyAsAgent(channel, threadTs, text, randomPersona, fullContext);
      this._markPersonaReply(channel, threadTs, randomPersona.id);
      this._rememberAdHocThreadPersona(channel, threadTs, randomPersona.id);
      await this._followAgentMentions(postedText, channel, threadTs, personas, fullContext, randomPersona.id);
      return;
    }

    console.log(`[slack] no active discussion found — ignoring message`);
  }
}

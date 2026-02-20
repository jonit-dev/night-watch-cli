/**
 * Slack interaction listener.
 * Listens to human messages (Socket Mode), routes @persona mentions,
 * and applies loop-protection safeguards.
 */

import { SocketModeClient } from '@slack/socket-mode';
import { spawn } from 'child_process';
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

const MAX_PROCESSED_MESSAGE_KEYS = 2000;
const PERSONA_REPLY_COOLDOWN_MS = 45_000;
const AD_HOC_THREAD_MEMORY_MS = 60 * 60_000; // 1h
const PROACTIVE_IDLE_MS = 20 * 60_000; // 20 min
const PROACTIVE_MIN_INTERVAL_MS = 90 * 60_000; // per channel
const PROACTIVE_SWEEP_INTERVAL_MS = 60_000;
const PROACTIVE_CODEWATCH_MIN_INTERVAL_MS = 3 * 60 * 60_000; // per project
const PROACTIVE_CODEWATCH_REPEAT_COOLDOWN_MS = 24 * 60 * 60_000; // per issue signature
const MAX_JOB_OUTPUT_CHARS = 12_000;
const HUMAN_REACTION_PROBABILITY = 0.65;
const REACTION_DELAY_MIN_MS = 180;
const REACTION_DELAY_MAX_MS = 1200;
const RESPONSE_DELAY_MIN_MS = 700;
const RESPONSE_DELAY_MAX_MS = 3400;
const CODEWATCH_MAX_FILES = 250;
const CODEWATCH_MAX_FILE_BYTES = 256_000;
const CODEWATCH_INCLUDE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rb',
  '.java',
  '.kt',
  '.rs',
  '.php',
  '.cs',
  '.swift',
  '.scala',
  '.sh',
]);
const CODEWATCH_IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
  '.cache',
  'logs',
  '.yarn',
  'vendor',
  'tmp',
  'temp',
]);

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

type TSlackJobName = 'run' | 'review' | 'qa';

interface ISlackJobRequest {
  job: TSlackJobName;
  projectHint?: string;
  prNumber?: string;
  fixConflicts?: boolean;
}

interface IAdHocThreadState {
  personaId: string;
  expiresAt: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractLastMeaningfulLines(output: string, maxLines = 4): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return '';
  return lines.slice(-maxLines).join(' | ');
}

function buildCurrentCliInvocation(args: string[]): string[] | null {
  const cliEntry = process.argv[1];
  if (!cliEntry) return null;
  return [...process.execArgv, cliEntry, ...args];
}

function formatCommandForLog(bin: string, args: string[]): string {
  return [bin, ...args].map((part) => JSON.stringify(part)).join(' ');
}

type TPersonaDomain = 'security' | 'qa' | 'lead' | 'dev' | 'general';
type TCodeWatchSignalType = 'empty_catch' | 'critical_todo';

export interface ICodeWatchSignal {
  type: TCodeWatchSignalType;
  index: number;
  summary: string;
  snippet: string;
}

interface ICodeWatchCandidate extends ICodeWatchSignal {
  relativePath: string;
  line: number;
  signature: string;
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

function normalizeProjectRef(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stripSlackUserMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, ' ');
}

function normalizeForParsing(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s./-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCodeWatchSourceFile(filePath: string): boolean {
  return CODEWATCH_INCLUDE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function lineNumberAt(content: string, index: number): number {
  if (index <= 0) return 1;
  let line = 1;
  for (let i = 0; i < index && i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

function extractLineSnippet(content: string, index: number): string {
  const clamped = Math.max(0, Math.min(index, content.length));
  const before = content.lastIndexOf('\n', clamped);
  const after = content.indexOf('\n', clamped);
  const start = before === -1 ? 0 : before + 1;
  const end = after === -1 ? content.length : after;
  return content.slice(start, end).trim().slice(0, 220);
}

function walkProjectFilesForCodeWatch(projectPath: string): string[] {
  const files: string[] = [];
  const stack = [projectPath];

  while (stack.length > 0 && files.length < CODEWATCH_MAX_FILES) {
    const dir = stack.pop();
    if (!dir) break;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (files.length >= CODEWATCH_MAX_FILES) break;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (CODEWATCH_IGNORE_DIRS.has(entry.name)) {
          continue;
        }
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (isCodeWatchSourceFile(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

export function findCodeWatchSignal(content: string): ICodeWatchSignal | null {
  if (!content || content.trim().length === 0) return null;

  const emptyCatchMatch = /catch\s*(?:\([^)]*\))?\s*\{\s*(?:(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*\}/gm.exec(content);
  const criticalTodoMatch = /\b(?:TODO|FIXME|HACK)\b[^\n]{0,140}\b(?:bug|security|race|leak|crash|hotfix|rollback|unsafe)\b/gi.exec(content);

  const emptyCatchIndex = emptyCatchMatch?.index ?? Number.POSITIVE_INFINITY;
  const criticalTodoIndex = criticalTodoMatch?.index ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(emptyCatchIndex) && !Number.isFinite(criticalTodoIndex)) {
    return null;
  }

  if (emptyCatchIndex <= criticalTodoIndex) {
    return {
      type: 'empty_catch',
      index: emptyCatchIndex,
      summary: 'empty catch block may hide runtime failures',
      snippet: extractLineSnippet(content, emptyCatchIndex),
    };
  }

  return {
    type: 'critical_todo',
    index: criticalTodoIndex,
    summary: 'high-risk TODO/FIXME likely indicates unresolved bug or security concern',
    snippet: (criticalTodoMatch?.[0] ?? extractLineSnippet(content, criticalTodoIndex)).trim().slice(0, 220),
  };
}

function detectCodeWatchCandidate(projectPath: string): ICodeWatchCandidate | null {
  const files = walkProjectFilesForCodeWatch(projectPath);

  for (const filePath of files) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (stat.size <= 0 || stat.size > CODEWATCH_MAX_FILE_BYTES) {
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    if (content.includes('\u0000')) {
      continue;
    }

    const signal = findCodeWatchSignal(content);
    if (!signal) continue;

    const relativePath = path.relative(projectPath, filePath).replace(/\\/g, '/');
    const line = lineNumberAt(content, signal.index);
    const signature = `${signal.type}:${relativePath}:${line}`;

    return {
      ...signal,
      relativePath,
      line,
      signature,
    };
  }

  return null;
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

function getPersonaDomain(persona: IAgentPersona): TPersonaDomain {
  const role = persona.role.toLowerCase();
  const expertise = (persona.soul?.expertise ?? []).join(' ').toLowerCase();
  const blob = `${role} ${expertise}`;

  if (/\bsecurity|auth|pentest|owasp|crypt|vuln\b/.test(blob)) return 'security';
  if (/\bqa|quality|test|e2e\b/.test(blob)) return 'qa';
  if (/\blead|architect|architecture|systems\b/.test(blob)) return 'lead';
  if (/\bimplementer|developer|executor|engineer\b/.test(blob)) return 'dev';
  return 'general';
}

export function scorePersonaForText(text: string, persona: IAgentPersona): number {
  const normalized = normalizeForParsing(stripSlackUserMentions(text));
  if (!normalized) return 0;

  let score = 0;
  const domain = getPersonaDomain(persona);

  if (normalized.includes(persona.name.toLowerCase())) {
    score += 12;
  }

  const securitySignal = /\b(security|auth|vuln|owasp|xss|csrf|token|permission|exploit|threat)\b/.test(normalized);
  const qaSignal = /\b(qa|test|testing|bug|e2e|playwright|regression|flaky)\b/.test(normalized);
  const leadSignal = /\b(architecture|architect|design|scalability|performance|tech debt|tradeoff|strategy)\b/.test(normalized);
  const devSignal = /\b(implement|implementation|code|build|fix|patch|ship|pr)\b/.test(normalized);

  if (securitySignal && domain === 'security') score += 8;
  if (qaSignal && domain === 'qa') score += 8;
  if (leadSignal && domain === 'lead') score += 8;
  if (devSignal && domain === 'dev') score += 8;

  const personaTokens = new Set([
    ...persona.role.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3),
    ...(persona.soul?.expertise ?? [])
      .flatMap((s) => s.toLowerCase().split(/[^a-z0-9]+/))
      .filter((t) => t.length >= 3),
  ]);

  const textTokens = normalized.split(/\s+/).filter((t) => t.length >= 3);
  for (const token of textTokens) {
    if (personaTokens.has(token)) {
      score += 2;
    }
  }

  return score;
}

export function selectFollowUpPersona(
  preferred: IAgentPersona,
  personas: IAgentPersona[],
  text: string,
): IAgentPersona {
  if (personas.length === 0) return preferred;

  const preferredScore = scorePersonaForText(text, preferred);
  let best = preferred;
  let bestScore = preferredScore;

  for (const persona of personas) {
    const score = scorePersonaForText(text, persona);
    if (score > bestScore) {
      best = persona;
      bestScore = score;
    }
  }

  // Default to continuity unless another persona is clearly a better fit.
  if (best.id !== preferred.id && bestScore >= preferredScore + 4 && bestScore >= 8) {
    return best;
  }
  return preferred;
}

function normalizeHandle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Extract @handle mentions from raw Slack text.
 * Example: "@maya please check this" -> ["maya"]
 */
export function extractMentionHandles(text: string): string[] {
  const matches = text.match(/@([a-z0-9._-]{2,32})/gi) ?? [];
  const seen = new Set<string>();
  const handles: string[] = [];

  for (const match of matches) {
    const normalized = normalizeHandle(match.slice(1));
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    handles.push(normalized);
  }

  return handles;
}

/**
 * Resolve mention handles to active personas by display name.
 * Matches @-prefixed handles in text (e.g. "@maya").
 */
export function resolveMentionedPersonas(
  text: string,
  personas: IAgentPersona[],
): IAgentPersona[] {
  const handles = extractMentionHandles(text);
  if (handles.length === 0) return [];

  const byHandle = new Map<string, IAgentPersona>();
  for (const persona of personas) {
    byHandle.set(normalizeHandle(persona.name), persona);
  }

  const resolved: IAgentPersona[] = [];
  const seenPersonaIds = new Set<string>();

  for (const handle of handles) {
    const persona = byHandle.get(handle);
    if (!persona || seenPersonaIds.has(persona.id)) {
      continue;
    }
    seenPersonaIds.add(persona.id);
    resolved.push(persona);
  }

  return resolved;
}

/**
 * Match personas whose name appears as a word in the text (case-insensitive, no @ needed).
 * Used for app_mention events where text looks like "<@BOTID> maya check this PR".
 */
export function resolvePersonasByPlainName(
  text: string,
  personas: IAgentPersona[],
): IAgentPersona[] {
  // Strip Slack user ID mentions like <@U12345678> to avoid false positives
  const stripped = text.replace(/<@[A-Z0-9]+>/g, '').toLowerCase();

  const resolved: IAgentPersona[] = [];
  const seenPersonaIds = new Set<string>();

  for (const persona of personas) {
    if (seenPersonaIds.has(persona.id)) continue;
    const nameLower = persona.name.toLowerCase();
    // Word-boundary match: persona name as a whole word
    const re = new RegExp(`\\b${nameLower}\\b`);
    if (re.test(stripped)) {
      resolved.push(persona);
      seenPersonaIds.add(persona.id);
    }
  }

  return resolved;
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
  private readonly _lastCodeWatchSignatureAt = new Map<string, number>();
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
      socket.removeAllListeners();
      await socket.disconnect();
      console.log('Slack interaction listener stopped');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Slack interaction listener shutdown failed: ${msg}`);
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
    opts?: { prNumber?: string; fixConflicts?: boolean },
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

  private _resolveProactiveChannelForProject(project: IRegistryEntry): string | null {
    const slack = this._config.slack;
    if (!slack) return null;
    return project.slackChannelId || slack.channels.eng || null;
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

      const candidate = detectCodeWatchCandidate(project.path);
      if (!candidate) {
        continue;
      }

      const signatureKey = `${project.path}:${candidate.signature}`;
      const lastSeen = this._lastCodeWatchSignatureAt.get(signatureKey) ?? 0;
      if (now - lastSeen < PROACTIVE_CODEWATCH_REPEAT_COOLDOWN_MS) {
        continue;
      }

      const ref = `codewatch-${candidate.signature}`;
      const context =
        `Project: ${project.name}\n` +
        `Signal: ${candidate.summary}\n` +
        `Location: ${candidate.relativePath}:${candidate.line}\n` +
        `Snippet: ${candidate.snippet}\n` +
        `Question: Is this intentional, or should we patch it now?`;

      console.log(
        `[slack][codewatch] project=${project.name} location=${candidate.relativePath}:${candidate.line} signal=${candidate.type}`,
      );

      try {
        await this._engine.startDiscussion({
          type: 'code_watch',
          projectPath: project.path,
          ref,
          context,
          channelId: channel,
        });
        this._lastCodeWatchSignatureAt.set(signatureKey, now);
        this._markChannelActivity(channel);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[slack][codewatch] failed for ${project.name}: ${msg}`);
      }
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

    if (await this._triggerSlackJobIfRequested(event, channel, threadTs, ts, personas)) {
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

      for (const persona of mentionedPersonas) {
        if (this._isPersonaOnCooldown(channel, threadTs, persona.id)) {
          console.log(`[slack] ${persona.name} is on cooldown — skipping`);
          continue;
        }
        await this._applyHumanResponseTiming(channel, ts, persona);
        if (discussion) {
          await this._engine.contributeAsAgent(discussion.id, persona);
        } else {
          await this._engine.replyAsAgent(channel, threadTs, text, persona, projectContext);
        }
        this._markPersonaReply(channel, threadTs, persona.id);
      }

      if (!discussion && mentionedPersonas[0]) {
        this._rememberAdHocThreadPersona(channel, threadTs, mentionedPersonas[0].id);
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
      await this._engine.replyAsAgent(
        channel,
        threadTs,
        text,
        followUpPersona,
        projectContext,
      );
      this._markPersonaReply(channel, threadTs, followUpPersona.id);
      this._rememberAdHocThreadPersona(channel, threadTs, followUpPersona.id);
      return;
    }

    // In-memory state was lost (e.g. server restart) — recover persona from thread history.
    if (threadTs) {
      const recoveredPersona = await this._recoverPersonaFromThreadHistory(channel, threadTs, personas);
      if (recoveredPersona) {
        const followUpPersona = selectFollowUpPersona(recoveredPersona, personas, text);
        console.log(`[slack] recovered ad-hoc thread persona ${recoveredPersona.name} from history, replying as ${followUpPersona.name}`);
        await this._applyHumanResponseTiming(channel, ts, followUpPersona);
        await this._engine.replyAsAgent(channel, threadTs, text, followUpPersona, projectContext);
        this._markPersonaReply(channel, threadTs, followUpPersona.id);
        this._rememberAdHocThreadPersona(channel, threadTs, followUpPersona.id);
        return;
      }
    }

    // Keep the channel alive: direct mentions and ambient greetings get a random responder.
    const shouldAutoEngage = event.type === 'app_mention' || isAmbientTeamMessage(text);
    if (shouldAutoEngage) {
      const randomPersona = this._pickRandomPersona(personas, channel, threadTs);
      if (randomPersona) {
        console.log(`[slack] auto-engaging via ${randomPersona.name}`);
        await this._applyHumanResponseTiming(channel, ts, randomPersona);
        await this._engine.replyAsAgent(
          channel,
          threadTs,
          text,
          randomPersona,
          projectContext,
        );
        this._markPersonaReply(channel, threadTs, randomPersona.id);
        this._rememberAdHocThreadPersona(channel, threadTs, randomPersona.id);
        return;
      }
    }

    console.log(`[slack] no active discussion found — ignoring message`);
  }
}

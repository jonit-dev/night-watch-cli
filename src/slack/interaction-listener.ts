/**
 * Slack interaction listener.
 * Listens to human messages (Socket Mode), routes @persona mentions,
 * and applies loop-protection safeguards.
 */

import { SocketModeClient } from '@slack/socket-mode';
import { IAgentPersona } from '../../shared/types.js';
import { getDb } from '../storage/sqlite/client.js';
import { getRepositories } from '../storage/repositories/index.js';
import { INightWatchConfig } from '../types.js';
import { DeliberationEngine } from './deliberation.js';
import { SlackClient } from './client.js';

const MAX_PROCESSED_MESSAGE_KEYS = 2000;
const PERSONA_REPLY_COOLDOWN_MS = 45_000;

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
  ack: () => Promise<void>;
  event: IInboundSlackEvent;
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

  constructor(config: INightWatchConfig) {
    this._config = config;
    const token = config.slack?.botToken ?? '';
    this._slackClient = new SlackClient(token);
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

    socket.on('events_api', (payload: IEventsApiPayload) => {
      void this._handleEventsApi(payload);
    });

    socket.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Slack interaction listener error: ${msg}`);
    });

    await socket.start();
    this._socketClient = socket;
    console.log('Slack interaction listener started (Socket Mode)');
    void this._postPersonaIntros();
  }

  async stop(): Promise<void> {
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
   * Post a self-introduction message for each active persona that hasn't
   * introduced themselves to the eng channel yet. Tracked persistently in
   * schema_meta so it only fires once per persona across restarts.
   */
  private async _postPersonaIntros(): Promise<void> {
    const channelId = this._config.slack?.channels?.eng;
    if (!channelId) return;

    const db = getDb();
    const metaRow = db
      .prepare(`SELECT value FROM schema_meta WHERE key = 'slack_persona_intros'`)
      .get() as { value: string } | undefined;
    const introduced = new Set<string>(
      metaRow ? (JSON.parse(metaRow.value) as string[]) : [],
    );

    const repos = getRepositories();
    const personas = repos.agentPersona.getActive();

    for (const persona of personas) {
      if (introduced.has(persona.id)) continue;

      const whoIAm = persona.soul?.whoIAm?.trim() ?? '';
      const intro = whoIAm
        ? `👋 Hey! I'm *${persona.name}*, ${persona.role}. ${whoIAm}`
        : `👋 Hey! I'm *${persona.name}*, ${persona.role}. Ready to collaborate!`;

      try {
        await this._slackClient.postAsAgent(channelId, intro, persona);
        introduced.add(persona.id);
        db.prepare(
          `INSERT INTO schema_meta (key, value) VALUES ('slack_persona_intros', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ).run(JSON.stringify(Array.from(introduced)));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Slack persona intro failed for ${persona.name}: ${msg}`);
      }
    }
  }

  private async _handleEventsApi(payload: IEventsApiPayload): Promise<void> {
    try {
      await payload.ack();
    } catch {
      // Ignore ack races/timeouts; processing can continue.
    }

    const event = payload.event;
    if (!event) return;
    if (event.type !== 'message' && event.type !== 'app_mention') return;

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

  private async _handleInboundMessage(event: IInboundSlackEvent): Promise<void> {
    if (shouldIgnoreInboundSlackEvent(event, this._botUserId)) {
      return;
    }

    const channel = event.channel as string;
    const ts = event.ts as string;
    const threadTs = event.thread_ts ?? ts;
    const text = event.text ?? '';
    const messageKey = `${channel}:${ts}`;

    // Deduplicate retried/replayed events to prevent response loops.
    if (!this._rememberMessageKey(messageKey)) {
      return;
    }

    const repos = getRepositories();
    const discussion = repos
      .slackDiscussion
      .getActive('')
      .find((d) => d.channelId === channel && d.threadTs === threadTs);

    if (!discussion) {
      return;
    }

    const personas = repos.agentPersona.getActive();
    const mentionedPersonas = resolveMentionedPersonas(text, personas);

    // Explicit @persona mention -> only those persona(s) respond.
    if (mentionedPersonas.length > 0) {
      for (const persona of mentionedPersonas) {
        if (this._isPersonaOnCooldown(channel, threadTs, persona.id)) {
          continue;
        }
        await this._engine.contributeAsAgent(discussion.id, persona);
        this._markPersonaReply(channel, threadTs, persona.id);
      }
      return;
    }

    // No explicit persona mention -> treat as generic human input for the discussion.
    await this._engine.handleHumanMessage(
      channel,
      threadTs,
      text,
      event.user as string,
    );
  }
}

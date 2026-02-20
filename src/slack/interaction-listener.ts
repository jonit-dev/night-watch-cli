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
import { generatePersonaAvatar } from '../utils/avatar-generator.js';
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
   * Join all configured channels, generate avatars for personas that need them,
   * and post a one-time personality-driven intro for each new persona.
   */
  private async _postPersonaIntros(): Promise<void> {
    const slack = this._config.slack;
    if (!slack) return;

    // Join all configured channels so the bot receives messages in them
    const channelIds = Object.values(slack.channels ?? {}).filter(Boolean);
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
      .prepare(`SELECT value FROM schema_meta WHERE key = 'slack_persona_intros_v3'`)
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
          const avatarUrl = await generatePersonaAvatar(persona.role, slack.replicateApiToken);
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
      const intro = whoIAm
        ? `${whoIAm}\n\nType \`@${currentPersona.name}\` in any channel message to get my take.`
        : `*${currentPersona.name}* — ${currentPersona.role}.\n\nType \`@${currentPersona.name}\` in any channel message to get my take.`;

      try {
        await this._slackClient.postAsAgent(engChannelId, intro, currentPersona);
        introduced.add(persona.id);
        db.prepare(
          `INSERT INTO schema_meta (key, value) VALUES ('slack_persona_intros_v3', ?)
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
    const personas = repos.agentPersona.getActive();
    const mentionedPersonas = resolveMentionedPersonas(text, personas);

    // Explicit @persona mention → respond regardless of whether a formal discussion exists.
    if (mentionedPersonas.length > 0) {
      console.log(`[slack] @mention detected in ${channel}: ${mentionedPersonas.map((p) => p.name).join(', ')}`);
      const discussion = repos
        .slackDiscussion
        .getActive('')
        .find((d) => d.channelId === channel && d.threadTs === threadTs);

      for (const persona of mentionedPersonas) {
        if (this._isPersonaOnCooldown(channel, threadTs, persona.id)) {
          console.log(`[slack] ${persona.name} is on cooldown — skipping`);
          continue;
        }
        if (discussion) {
          await this._engine.contributeAsAgent(discussion.id, persona);
        } else {
          // No formal discussion — ad-hoc reply in the thread
          await this._engine.replyAsAgent(channel, threadTs, text, persona);
        }
        this._markPersonaReply(channel, threadTs, persona.id);
      }
      return;
    }

    // No @mention — only handle within an existing Night Watch discussion thread.
    const discussion = repos
      .slackDiscussion
      .getActive('')
      .find((d) => d.channelId === channel && d.threadTs === threadTs);

    if (!discussion) {
      return;
    }

    await this._engine.handleHumanMessage(
      channel,
      threadTs,
      text,
      event.user as string,
    );
  }
}

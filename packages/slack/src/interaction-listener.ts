/**
 * Slack interaction listener.
 * Listens to human messages (Socket Mode), routes @persona mentions,
 * and applies loop-protection safeguards.
 */

import {
  IAgentPersona,
  INightWatchConfig,
  generatePersonaAvatar,
  getDb,
  getRepositories,
  getRoadmapStatus,
} from '@night-watch/core';
import type { IRegistryEntry } from '@night-watch/core';
import { SocketModeClient } from '@slack/socket-mode';
import { execFileSync } from 'child_process';
import { SlackClient } from './client.js';
import { ContextFetcher } from './context-fetcher.js';
import { DeliberationEngine } from './deliberation.js';
import { JobSpawner } from './job-spawner.js';
import type { IJobSpawnerCallbacks } from './job-spawner.js';
import { ProactiveLoop } from './proactive-loop.js';
import { MessageParser } from './message-parser.js';
import type { IAdHocThreadState, IEventsApiPayload, IInboundSlackEvent } from './message-parser.js';
import {
  resolveMentionedPersonas,
  resolvePersonasByPlainName,
  selectFollowUpPersona,
} from './personas.js';
import {
  buildCurrentCliInvocation,
  normalizeProjectRef,
  sleep,
  stripSlackUserMentions,
} from './utils.js';

const MAX_PROCESSED_MESSAGE_KEYS = 2000;
const PERSONA_REPLY_COOLDOWN_MS = 45_000;
const AD_HOC_THREAD_MEMORY_MS = 60 * 60_000; // 1h
const HUMAN_REACTION_PROBABILITY = 0.65;
const RANDOM_REACTION_PROBABILITY = 0.25;
const REACTION_DELAY_MIN_MS = 180;
const REACTION_DELAY_MAX_MS = 1200;
const RESPONSE_DELAY_MIN_MS = 700;
const RESPONSE_DELAY_MAX_MS = 3400;
const SOCKET_DISCONNECT_TIMEOUT_MS = 5_000;
// Chance a second persona spontaneously chimes in after the first replies
const PIGGYBACK_REPLY_PROBABILITY = 0.4;
const PIGGYBACK_DELAY_MIN_MS = 4_000;
const PIGGYBACK_DELAY_MAX_MS = 15_000;

export class SlackInteractionListener {
  private readonly config: INightWatchConfig;
  private readonly slackClient: SlackClient;
  private readonly engine: DeliberationEngine;
  private readonly parser = new MessageParser();
  private readonly contextFetcher = new ContextFetcher();
  private readonly jobSpawner: JobSpawner;
  private readonly jobCallbacks: IJobSpawnerCallbacks;
  private readonly proactiveLoop: ProactiveLoop;
  private socketClient: SocketModeClient | null = null;
  private botUserId: string | null = null;
  private readonly processedMessageKeys = new Set<string>();
  private readonly processedMessageOrder: string[] = [];
  private readonly lastPersonaReplyAt = new Map<string, number>();
  private readonly adHocThreadState = new Map<string, IAdHocThreadState>();
  private readonly lastChannelActivityAt = new Map<string, number>();

  constructor(slackClient: SlackClient, engine: DeliberationEngine, config: INightWatchConfig) {
    this.slackClient = slackClient;
    this.engine = engine;
    this.config = config;
    this.jobSpawner = new JobSpawner(slackClient, engine, config);
    this.jobCallbacks = {
      markChannelActivity: (ch) => this.markChannelActivity(ch),
      markPersonaReply: (ch, ts, pid) => this.markPersonaReply(ch, ts, pid),
    };
    this.proactiveLoop = new ProactiveLoop(
      config,
      engine,
      this.jobSpawner,
      this.jobCallbacks,
      this.lastChannelActivityAt,
      {
        markChannelActivity: (ch) => this.markChannelActivity(ch),
        buildProjectContext: (ch, p) => this.buildProjectContext(ch, p),
        buildRoadmapContext: (ch, p) => this.buildRoadmapContext(ch, p),
      },
    );
  }

  async start(): Promise<void> {
    const slack = this.config.slack;
    if (!slack?.enabled || !slack.discussionEnabled || !slack.botToken || !slack.appToken) {
      return;
    }

    if (this.socketClient) {
      return;
    }

    try {
      this.botUserId = await this.slackClient.getBotUserId();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Slack interaction listener: failed to resolve bot user id (${msg})`);
      this.botUserId = null;
    }

    const socket = new SocketModeClient({
      appToken: slack.appToken,
    });

    const onInboundEvent = (payload: IEventsApiPayload) => {
      void this.handleEventsApi(payload);
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
    this.socketClient = socket;
    console.log('Slack interaction listener started (Socket Mode)');
    this.proactiveLoop.start();
    void this.postPersonaIntros();
  }

  async stop(): Promise<void> {
    this.proactiveLoop.stop();

    if (!this.socketClient) {
      return;
    }

    const socket = this.socketClient;
    this.socketClient = null;

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
  private async postPersonaIntros(): Promise<void> {
    const slack = this.config.slack;
    if (!slack) return;

    // Join all configured channels so the bot receives messages in them
    const channelIds = Object.values(slack.channels ?? {}).filter(Boolean);
    const now = Date.now();
    for (const channelId of channelIds) {
      this.lastChannelActivityAt.set(channelId, now);
    }

    for (const channelId of channelIds) {
      try {
        await this.slackClient.joinChannel(channelId);
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
    const introduced = new Set<string>(metaRow ? (JSON.parse(metaRow.value) as string[]) : []);

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
          const avatarUrl = await generatePersonaAvatar(
            persona.name,
            persona.role,
            slack.replicateApiToken,
          );
          if (avatarUrl) {
            currentPersona = repos.agentPersona.update(persona.id, {
              avatarUrl,
            });
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
        await this.slackClient.postAsAgent(engChannelId, intro, currentPersona);
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

  private async handleEventsApi(payload: IEventsApiPayload): Promise<void> {
    if (payload.ack) {
      try {
        await payload.ack();
      } catch {
        // Ignore ack races/timeouts; processing can continue.
      }
    }

    const event = this.parser.extractInboundEvent(payload);
    if (!event) return;

    if (event.type !== 'message' && event.type !== 'app_mention') return;

    const ignored = this.parser.shouldIgnoreInboundSlackEvent(event, this.botUserId);
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
      event.type === 'message' &&
      this.botUserId &&
      (event.text ?? '').includes(`<@${this.botUserId}>`)
    ) {
      console.log('[slack] ignoring mirrored message event for direct bot mention');
      return;
    }

    try {
      await this.handleInboundMessage(event);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Slack interaction message handling failed: ${msg}`);
    }
  }

  private rememberMessageKey(key: string): boolean {
    if (this.processedMessageKeys.has(key)) {
      return false;
    }

    this.processedMessageKeys.add(key);
    this.processedMessageOrder.push(key);

    while (this.processedMessageOrder.length > MAX_PROCESSED_MESSAGE_KEYS) {
      const oldest = this.processedMessageOrder.shift();
      if (oldest) {
        this.processedMessageKeys.delete(oldest);
      }
    }

    return true;
  }

  private isPersonaOnCooldown(channel: string, threadTs: string, personaId: string): boolean {
    const key = `${channel}:${threadTs}:${personaId}`;
    const last = this.lastPersonaReplyAt.get(key);
    if (!last) return false;
    return Date.now() - last < PERSONA_REPLY_COOLDOWN_MS;
  }

  private markPersonaReply(channel: string, threadTs: string, personaId: string): void {
    const key = `${channel}:${threadTs}:${personaId}`;
    this.lastPersonaReplyAt.set(key, Date.now());
  }

  private threadKey(channel: string, threadTs: string): string {
    return `${channel}:${threadTs}`;
  }

  private markChannelActivity(channel: string): void {
    this.lastChannelActivityAt.set(channel, Date.now());
  }

  private rememberAdHocThreadPersona(channel: string, threadTs: string, personaId: string): void {
    this.adHocThreadState.set(this.threadKey(channel, threadTs), {
      personaId,
      expiresAt: Date.now() + AD_HOC_THREAD_MEMORY_MS,
    });
  }

  /**
   * After an agent posts a reply, check if the text mentions other personas by plain name.
   * If so, trigger those personas to respond once (no further cascading — depth 1 only).
   * This enables natural agent-to-agent handoffs like "Carlos, what's the priority here?"
   */
  private async followAgentMentions(
    postedText: string,
    channel: string,
    threadTs: string,
    personas: IAgentPersona[],
    projectContext: string,
    skipPersonaId: string,
  ): Promise<void> {
    if (!postedText) return;

    const mentioned = resolvePersonasByPlainName(postedText, personas).filter(
      (p) => p.id !== skipPersonaId && !this.isPersonaOnCooldown(channel, threadTs, p.id),
    );

    if (mentioned.length === 0) return;

    console.log(`[slack] agent mention follow-up: ${mentioned.map((p) => p.name).join(', ')}`);

    for (const persona of mentioned) {
      // Small human-like delay before the tagged persona responds
      await sleep(this.randomInt(RESPONSE_DELAY_MIN_MS * 2, RESPONSE_DELAY_MAX_MS * 3));
      // replyAsAgent fetches thread history internally so Carlos sees Dev's message
      await this.engine.replyAsAgent(channel, threadTs, postedText, persona, projectContext);
      this.markPersonaReply(channel, threadTs, persona.id);
      this.rememberAdHocThreadPersona(channel, threadTs, persona.id);
    }
  }

  /**
   * After a persona replies, spontaneously trigger a second persona to chime in.
   * Simulates the organic team dynamics where a teammate jumps in unprompted.
   * Fire-and-forget: call with `void` to avoid blocking the main reply path.
   */
  private async maybePiggybackReply(
    channel: string,
    threadTs: string,
    text: string,
    personas: IAgentPersona[],
    projectContext: string,
    excludePersonaId: string,
  ): Promise<void> {
    if (Math.random() > PIGGYBACK_REPLY_PROBABILITY) return;

    const others = personas.filter(
      (p) => p.id !== excludePersonaId && !this.isPersonaOnCooldown(channel, threadTs, p.id),
    );
    if (others.length === 0) return;

    const persona = others[Math.floor(Math.random() * others.length)];
    await sleep(this.randomInt(PIGGYBACK_DELAY_MIN_MS, PIGGYBACK_DELAY_MAX_MS));

    const postedText = await this.engine.replyAsAgent(
      channel,
      threadTs,
      text,
      persona,
      projectContext,
    );
    this.markPersonaReply(channel, threadTs, persona.id);
    this.rememberAdHocThreadPersona(channel, threadTs, persona.id);
    if (postedText) {
      await this.followAgentMentions(
        postedText,
        channel,
        threadTs,
        personas,
        projectContext,
        persona.id,
      );
    }
  }

  /**
   * Engage multiple personas for ambient team messages ("hey guys", "happy friday", etc.)
   * Picks 2-3 personas and has them reply with staggered natural delays.
   */
  private async engageMultiplePersonas(
    channel: string,
    threadTs: string,
    messageTs: string,
    text: string,
    personas: IAgentPersona[],
    projectContext: string,
  ): Promise<void> {
    const available = personas.filter((p) => !this.isPersonaOnCooldown(channel, threadTs, p.id));
    if (available.length === 0) return;

    // Shuffle and pick 2-3 personas
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const count = Math.min(shuffled.length, this.randomInt(2, 3));
    const participants = shuffled.slice(0, count);

    let firstPostedPersonaId = '';
    for (let i = 0; i < participants.length; i++) {
      const persona = participants[i];
      if (i > 0) {
        // Stagger subsequent replies
        await sleep(this.randomInt(PIGGYBACK_DELAY_MIN_MS, PIGGYBACK_DELAY_MAX_MS));
      } else {
        await this.applyHumanResponseTiming(channel, messageTs, persona);
      }
      const postedText = await this.engine.replyAsAgent(
        channel,
        threadTs,
        text,
        persona,
        projectContext,
      );
      this.markPersonaReply(channel, threadTs, persona.id);
      this.rememberAdHocThreadPersona(channel, threadTs, persona.id);
      if (i === 0) firstPostedPersonaId = persona.id;
      if (postedText && i === participants.length - 1 && firstPostedPersonaId) {
        await this.followAgentMentions(
          postedText,
          channel,
          threadTs,
          personas,
          projectContext,
          persona.id,
        );
      }
    }
  }

  /**
   * Recover the persona that last replied in a thread by scanning its history.
   * Used as a fallback when in-memory state was lost (e.g. after a server restart).
   * Matches message `username` fields against known persona names.
   */
  private async recoverPersonaFromThreadHistory(
    channel: string,
    threadTs: string,
    personas: IAgentPersona[],
  ): Promise<IAgentPersona | null> {
    try {
      const history = await this.slackClient.getChannelHistory(channel, threadTs, 50);
      // Walk backwards to find the most recent message sent by a persona
      for (const msg of [...history].reverse()) {
        if (!msg.username) continue;
        const matched = personas.find((p) => p.name.toLowerCase() === msg.username!.toLowerCase());
        if (matched) return matched;
      }
    } catch {
      // Ignore — treat as no prior context
    }
    return null;
  }

  private getRememberedAdHocPersona(
    channel: string,
    threadTs: string,
    personas: IAgentPersona[],
  ): IAgentPersona | null {
    const key = this.threadKey(channel, threadTs);
    const remembered = this.adHocThreadState.get(key);
    if (!remembered) return null;
    if (Date.now() > remembered.expiresAt) {
      this.adHocThreadState.delete(key);
      return null;
    }
    return personas.find((p) => p.id === remembered.personaId) ?? null;
  }

  private pickRandomPersona(
    personas: IAgentPersona[],
    channel: string,
    threadTs: string,
  ): IAgentPersona | null {
    if (personas.length === 0) return null;
    const available = personas.filter((p) => !this.isPersonaOnCooldown(channel, threadTs, p.id));
    const pool = available.length > 0 ? available : personas;
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  }

  private findPersonaByName(personas: IAgentPersona[], name: string): IAgentPersona | null {
    const target = name.toLowerCase();
    return personas.find((p) => p.name.toLowerCase() === target) ?? null;
  }

  private buildProjectContext(channel: string, projects: IRegistryEntry[]): string {
    if (projects.length === 0) return '';
    const inChannel = projects.find((p) => p.slackChannelId === channel);
    if (inChannel) {
      return `Current channel project: ${inChannel.name}.`;
    }
    const names = projects.map((p) => p.name).join(', ');
    return `Registered projects: ${names}.`;
  }

  private buildRoadmapContext(channel: string, projects: IRegistryEntry[]): string {
    if (projects.length === 0) return '';

    // Scope to the channel's project if one is assigned; otherwise use all projects.
    const inChannel = projects.find((p) => p.slackChannelId === channel);
    const scopedProjects = inChannel ? [inChannel] : projects;

    const parts: string[] = [];
    for (const project of scopedProjects) {
      try {
        const status = getRoadmapStatus(project.path, this.config);
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

  private resolveProjectByHint(projects: IRegistryEntry[], hint: string): IRegistryEntry | null {
    const normalizedHint = normalizeProjectRef(hint);
    if (!normalizedHint) return null;

    const byNameExact = projects.find((p) => normalizeProjectRef(p.name) === normalizedHint);
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

    return (
      projects.find((p) => {
        const base = p.path.split('/').pop() ?? '';
        return normalizeProjectRef(base).includes(normalizedHint);
      }) ?? null
    );
  }

  private resolveTargetProject(
    channel: string,
    projects: IRegistryEntry[],
    projectHint?: string,
  ): IRegistryEntry | null {
    if (projectHint) {
      return this.resolveProjectByHint(projects, projectHint);
    }
    const byChannel = projects.find((p) => p.slackChannelId === channel);
    if (byChannel) return byChannel;
    if (projects.length === 1) return projects[0];
    return null;
  }

  private isMessageAddressedToBot(event: IInboundSlackEvent): boolean {
    if (event.type === 'app_mention') return true;
    const text = this.parser.normalizeForParsing(stripSlackUserMentions(event.text ?? ''));
    return /^night[-\s]?watch\b/.test(text) || /^nw\b/.test(text);
  }

  private randomInt(min: number, max: number): number {
    if (max <= min) return min;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private reactionCandidatesForPersona(persona: IAgentPersona): string[] {
    const role = persona.role.toLowerCase();
    if (role.includes('security')) return ['eyes', 'thinking_face', 'shield', 'thumbsup'];
    if (role.includes('qa') || role.includes('quality'))
      return ['test_tube', 'mag', 'thinking_face', 'thumbsup'];
    if (role.includes('lead') || role.includes('architect'))
      return ['thinking_face', 'thumbsup', 'memo', 'eyes'];
    if (role.includes('implementer') || role.includes('developer'))
      return ['wrench', 'hammer_and_wrench', 'thumbsup', 'eyes'];
    return ['eyes', 'thinking_face', 'thumbsup', 'wave'];
  }

  private async maybeReactToHumanMessage(
    channel: string,
    messageTs: string,
    persona: IAgentPersona,
  ): Promise<void> {
    if (Math.random() > HUMAN_REACTION_PROBABILITY) {
      return;
    }

    const candidates = this.reactionCandidatesForPersona(persona);
    const reaction = candidates[this.randomInt(0, candidates.length - 1)];

    await sleep(this.randomInt(REACTION_DELAY_MIN_MS, REACTION_DELAY_MAX_MS));
    try {
      await this.slackClient.addReaction(channel, messageTs, reaction);
    } catch {
      // Ignore reaction failures (permissions, already reacted, etc.)
    }
  }

  private async applyHumanResponseTiming(
    channel: string,
    messageTs: string,
    persona: IAgentPersona,
  ): Promise<void> {
    await this.maybeReactToHumanMessage(channel, messageTs, persona);
    await sleep(this.randomInt(RESPONSE_DELAY_MIN_MS, RESPONSE_DELAY_MAX_MS));
  }

  private async triggerDirectProviderIfRequested(
    event: IInboundSlackEvent,
    channel: string,
    threadTs: string,
    messageTs: string,
    personas: IAgentPersona[],
  ): Promise<boolean> {
    const request = this.parser.parseSlackProviderRequest(event.text ?? '');
    if (!request) return false;

    const addressedToBot = this.isMessageAddressedToBot(event);
    const normalized = this.parser.normalizeForParsing(stripSlackUserMentions(event.text ?? ''));
    const startsWithProviderCommand =
      /^(?:can\s+(?:you|someone|anyone)\s+)?(?:please\s+)?(?:(?:run|use|invoke|trigger|ask)\s+)?(?:claude|codex)\b/i.test(
        normalized,
      );
    if (!addressedToBot && !startsWithProviderCommand) {
      return false;
    }

    const repos = getRepositories();
    const projects = repos.projectRegistry.getAll();
    const persona =
      this.findPersonaByName(personas, 'Dev') ??
      this.pickRandomPersona(personas, channel, threadTs) ??
      personas[0];
    if (!persona) return false;

    const targetProject = this.resolveTargetProject(channel, projects, request.projectHint);
    if (!targetProject) {
      const projectNames = projects.map((p) => p.name).join(', ') || '(none registered)';
      await this.slackClient.postAsAgent(
        channel,
        `Which project? Registered: ${projectNames}.`,
        persona,
        threadTs,
      );
      this.markChannelActivity(channel);
      this.markPersonaReply(channel, threadTs, persona.id);
      return true;
    }

    console.log(
      `[slack][provider] routing provider=${request.provider} to persona=${persona.name} project=${targetProject.name}`,
    );

    const providerLabel = request.provider === 'claude' ? 'Claude' : 'Codex';
    const compactPrompt = request.prompt.replace(/\s+/g, ' ').trim();
    const promptPreview =
      compactPrompt.length > 120 ? `${compactPrompt.slice(0, 117)}...` : compactPrompt;

    await this.applyHumanResponseTiming(channel, messageTs, persona);
    await this.slackClient.postAsAgent(
      channel,
      `Running ${providerLabel} directly${request.projectHint ? ` on ${targetProject.name}` : ''}: "${promptPreview}"`,
      persona,
      threadTs,
    );
    this.markChannelActivity(channel);
    this.markPersonaReply(channel, threadTs, persona.id);
    this.rememberAdHocThreadPersona(channel, threadTs, persona.id);

    await this.jobSpawner.spawnDirectProviderRequest(
      request,
      targetProject,
      channel,
      threadTs,
      persona,
      this.jobCallbacks,
    );
    return true;
  }

  private async triggerSlackJobIfRequested(
    event: IInboundSlackEvent,
    channel: string,
    threadTs: string,
    messageTs: string,
    personas: IAgentPersona[],
  ): Promise<boolean> {
    const request = this.parser.parseSlackJobRequest(event.text ?? '');
    if (!request) return false;

    const addressedToBot = this.isMessageAddressedToBot(event);
    const normalized = this.parser.normalizeForParsing(stripSlackUserMentions(event.text ?? ''));
    const teamRequestLanguage = /\b(can someone|someone|anyone|please|need)\b/i.test(normalized);
    const startsWithCommand = /^(run|review|qa)\b/i.test(normalized);

    if (
      !addressedToBot &&
      !request.prNumber &&
      !request.fixConflicts &&
      !teamRequestLanguage &&
      !startsWithCommand
    ) {
      return false;
    }

    const repos = getRepositories();
    const projects = repos.projectRegistry.getAll();

    const persona =
      (request.job === 'run' ? this.findPersonaByName(personas, 'Dev') : null) ??
      (request.job === 'qa' ? this.findPersonaByName(personas, 'Priya') : null) ??
      (request.job === 'review' ? this.findPersonaByName(personas, 'Carlos') : null) ??
      this.pickRandomPersona(personas, channel, threadTs) ??
      personas[0];

    if (!persona) return false;

    const targetProject = this.resolveTargetProject(channel, projects, request.projectHint);
    if (!targetProject) {
      const projectNames = projects.map((p) => p.name).join(', ') || '(none registered)';
      await this.slackClient.postAsAgent(
        channel,
        `Which project? Registered: ${projectNames}.`,
        persona,
        threadTs,
      );
      this.markChannelActivity(channel);
      this.markPersonaReply(channel, threadTs, persona.id);
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

    await this.applyHumanResponseTiming(channel, messageTs, persona);

    await this.slackClient.postAsAgent(channel, `${planLine}`, persona, threadTs);
    console.log(
      `[slack][job] ${persona.name} accepted job=${request.job} project=${targetProject.name}${request.prNumber ? ` pr=${request.prNumber}` : ''}`,
    );
    this.markChannelActivity(channel);
    this.markPersonaReply(channel, threadTs, persona.id);
    this.rememberAdHocThreadPersona(channel, threadTs, persona.id);

    await this.jobSpawner.spawnNightWatchJob(
      request.job,
      targetProject,
      channel,
      threadTs,
      persona,
      {
        prNumber: request.prNumber,
        fixConflicts: request.fixConflicts,
      },
      this.jobCallbacks,
    );
    return true;
  }

  private async triggerIssuePickupIfRequested(
    event: IInboundSlackEvent,
    channel: string,
    threadTs: string,
    messageTs: string,
    personas: IAgentPersona[],
  ): Promise<boolean> {
    const request = this.parser.parseSlackIssuePickupRequest(event.text ?? '');
    if (!request) return false;

    const addressedToBot = this.isMessageAddressedToBot(event);
    const normalized = this.parser.normalizeForParsing(stripSlackUserMentions(event.text ?? ''));
    const teamRequestLanguage = /\b(can someone|someone|anyone|please|need)\b/i.test(normalized);
    if (!addressedToBot && !teamRequestLanguage) return false;

    const repos = getRepositories();
    const projects = repos.projectRegistry.getAll();

    const persona =
      this.findPersonaByName(personas, 'Dev') ??
      this.pickRandomPersona(personas, channel, threadTs) ??
      personas[0];
    if (!persona) return false;

    const targetProject = this.resolveTargetProject(channel, projects, request.repoHint);
    if (!targetProject) {
      const projectNames = projects.map((p) => p.name).join(', ') || '(none registered)';
      await this.slackClient.postAsAgent(
        channel,
        `Which project? Registered: ${projectNames}.`,
        persona,
        threadTs,
      );
      this.markChannelActivity(channel);
      this.markPersonaReply(channel, threadTs, persona.id);
      return true;
    }

    console.log(
      `[slack][issue-pickup] routing issue=#${request.issueNumber} to persona=${persona.name} project=${targetProject.name}`,
    );

    await this.applyHumanResponseTiming(channel, messageTs, persona);
    await this.slackClient.postAsAgent(
      channel,
      `On it — picking up #${request.issueNumber}. Starting the run now.`,
      persona,
      threadTs,
    );
    this.markChannelActivity(channel);
    this.markPersonaReply(channel, threadTs, persona.id);
    this.rememberAdHocThreadPersona(channel, threadTs, persona.id);

    // Move issue to In Progress on board (best-effort, spawn via CLI subprocess)
    const boardArgs = buildCurrentCliInvocation([
      'board',
      'move-issue',
      request.issueNumber,
      '--column',
      'In Progress',
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
    await this.jobSpawner.spawnNightWatchJob(
      'run',
      targetProject,
      channel,
      threadTs,
      persona,
      {
        issueNumber: request.issueNumber,
      },
      this.jobCallbacks,
    );
    return true;
  }

  private async handleInboundMessage(event: IInboundSlackEvent): Promise<void> {
    if (this.parser.shouldIgnoreInboundSlackEvent(event, this.botUserId)) {
      console.log(
        `[slack] ignoring event — failed shouldIgnore check (user=${event.user}, bot_id=${event.bot_id ?? '-'}, subtype=${event.subtype ?? '-'})`,
      );
      return;
    }

    const channel = event.channel as string;
    const ts = event.ts as string;
    const threadTs = event.thread_ts ?? ts;
    const text = event.text ?? '';
    const messageKey = this.parser.buildInboundMessageKey(channel, ts, event.type);
    this.markChannelActivity(channel);

    // Deduplicate retried/replayed events to prevent response loops.
    if (!this.rememberMessageKey(messageKey)) {
      console.log(`[slack] duplicate event ${messageKey} — skipping`);
      return;
    }

    const repos = getRepositories();
    const personas = repos.agentPersona.getActive();
    const projects = repos.projectRegistry.getAll();
    const projectContext = this.buildProjectContext(channel, projects);

    // Fetch GitHub issue/PR content from URLs in the message so agents can inspect them.
    const githubUrls = this.parser.extractGitHubIssueUrls(text);
    const genericUrls = this.parser.extractGenericUrls(text);
    console.log(
      `[slack] processing message channel=${channel} thread=${threadTs} github_urls=${githubUrls.length} generic_urls=${genericUrls.length}`,
    );
    const githubContext =
      githubUrls.length > 0 ? await this.contextFetcher.fetchGitHubIssueContext(githubUrls) : '';
    const urlContext =
      genericUrls.length > 0 ? await this.contextFetcher.fetchUrlSummaries(genericUrls) : '';
    let fullContext = projectContext;
    if (githubContext) fullContext += `\n\nReferenced GitHub content:\n${githubContext}`;
    if (urlContext) fullContext += `\n\nReferenced links:\n${urlContext}`;

    if (await this.triggerDirectProviderIfRequested(event, channel, threadTs, ts, personas)) {
      return;
    }

    if (await this.triggerSlackJobIfRequested(event, channel, threadTs, ts, personas)) {
      return;
    }

    if (await this.triggerIssuePickupIfRequested(event, channel, threadTs, ts, personas)) {
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
      console.log(
        `[slack] routing to persona(s): ${mentionedPersonas.map((p) => p.name).join(', ')} in ${channel}`,
      );
      const discussion = repos.slackDiscussion
        .getActive('')
        .find((d) => d.channelId === channel && d.threadTs === threadTs);

      let lastPosted = '';
      let lastPersonaId = '';
      for (const persona of mentionedPersonas) {
        if (this.isPersonaOnCooldown(channel, threadTs, persona.id)) {
          console.log(`[slack] ${persona.name} is on cooldown — skipping`);
          continue;
        }
        await this.applyHumanResponseTiming(channel, ts, persona);
        if (discussion) {
          await this.engine.contributeAsAgent(discussion.id, persona);
        } else {
          console.log(`[slack] replying as ${persona.name} in ${channel}`);
          lastPosted = await this.engine.replyAsAgent(
            channel,
            threadTs,
            text,
            persona,
            fullContext,
          );
          lastPersonaId = persona.id;
        }
        this.markPersonaReply(channel, threadTs, persona.id);
      }

      if (!discussion && mentionedPersonas[0]) {
        this.rememberAdHocThreadPersona(channel, threadTs, mentionedPersonas[0].id);
      }

      // Follow up if the last agent reply mentions other teammates by name.
      if (lastPosted && lastPersonaId) {
        await this.followAgentMentions(
          lastPosted,
          channel,
          threadTs,
          personas,
          fullContext,
          lastPersonaId,
        );
      }
      return;
    }

    console.log(
      `[slack] no persona match — checking for active discussion in ${channel}:${threadTs}`,
    );

    // No persona mention — only handle within an existing Night Watch discussion thread.
    const discussion = repos.slackDiscussion
      .getActive('')
      .find((d) => d.channelId === channel && d.threadTs === threadTs);

    if (discussion) {
      await this.engine.handleHumanMessage(channel, threadTs, text, event.user as string);
      return;
    }

    // Continue ad-hoc threads even without a persisted discussion.
    const rememberedPersona = this.getRememberedAdHocPersona(channel, threadTs, personas);
    if (rememberedPersona) {
      const followUpPersona = selectFollowUpPersona(rememberedPersona, personas, text);
      if (followUpPersona.id !== rememberedPersona.id) {
        console.log(
          `[slack] handing off ad-hoc thread from ${rememberedPersona.name} to ${followUpPersona.name} based on topic`,
        );
      } else {
        console.log(`[slack] continuing ad-hoc thread with ${rememberedPersona.name}`);
      }
      await this.applyHumanResponseTiming(channel, ts, followUpPersona);
      console.log(`[slack] replying as ${followUpPersona.name} in ${channel}`);
      const postedText = await this.engine.replyAsAgent(
        channel,
        threadTs,
        text,
        followUpPersona,
        fullContext,
      );
      this.markPersonaReply(channel, threadTs, followUpPersona.id);
      this.rememberAdHocThreadPersona(channel, threadTs, followUpPersona.id);
      await this.followAgentMentions(
        postedText,
        channel,
        threadTs,
        personas,
        fullContext,
        followUpPersona.id,
      );
      void this.maybePiggybackReply(
        channel,
        threadTs,
        text,
        personas,
        fullContext,
        followUpPersona.id,
      );
      return;
    }

    // In-memory state was lost (e.g. server restart) — recover persona from thread history.
    if (threadTs) {
      const recoveredPersona = await this.recoverPersonaFromThreadHistory(
        channel,
        threadTs,
        personas,
      );
      if (recoveredPersona) {
        const followUpPersona = selectFollowUpPersona(recoveredPersona, personas, text);
        console.log(
          `[slack] recovered ad-hoc thread persona ${recoveredPersona.name} from history, replying as ${followUpPersona.name}`,
        );
        await this.applyHumanResponseTiming(channel, ts, followUpPersona);
        console.log(`[slack] replying as ${followUpPersona.name} in ${channel}`);
        const postedText = await this.engine.replyAsAgent(
          channel,
          threadTs,
          text,
          followUpPersona,
          fullContext,
        );
        this.markPersonaReply(channel, threadTs, followUpPersona.id);
        this.rememberAdHocThreadPersona(channel, threadTs, followUpPersona.id);
        await this.followAgentMentions(
          postedText,
          channel,
          threadTs,
          personas,
          fullContext,
          followUpPersona.id,
        );
        void this.maybePiggybackReply(
          channel,
          threadTs,
          text,
          personas,
          fullContext,
          followUpPersona.id,
        );
        return;
      }
    }

    // Ambient team messages ("hey guys", "happy friday", "are you all alive?") get multiple replies.
    if (this.parser.isAmbientTeamMessage(text)) {
      console.log(`[slack] ambient team message detected — engaging multiple personas`);
      await this.engageMultiplePersonas(channel, threadTs, ts, text, personas, fullContext);
      return;
    }

    // Direct bot mentions always get a reply.
    if (event.type === 'app_mention') {
      const randomPersona = this.pickRandomPersona(personas, channel, threadTs);
      if (randomPersona) {
        console.log(`[slack] app_mention auto-engaging via ${randomPersona.name}`);
        await this.applyHumanResponseTiming(channel, ts, randomPersona);
        const postedText = await this.engine.replyAsAgent(
          channel,
          threadTs,
          text,
          randomPersona,
          fullContext,
        );
        this.markPersonaReply(channel, threadTs, randomPersona.id);
        this.rememberAdHocThreadPersona(channel, threadTs, randomPersona.id);
        await this.followAgentMentions(
          postedText,
          channel,
          threadTs,
          personas,
          fullContext,
          randomPersona.id,
        );
        // Spontaneous second voice
        void this.maybePiggybackReply(
          channel,
          threadTs,
          text,
          personas,
          fullContext,
          randomPersona.id,
        );
        return;
      }
    }

    // Any human message: agents independently decide whether to react.
    for (const persona of personas) {
      if (
        !this.isPersonaOnCooldown(channel, threadTs, persona.id) &&
        Math.random() < RANDOM_REACTION_PROBABILITY
      ) {
        void this.maybeReactToHumanMessage(channel, ts, persona);
      }
    }

    // Guaranteed fallback reply — someone always responds.
    const randomPersona = this.pickRandomPersona(personas, channel, threadTs);
    if (randomPersona) {
      console.log(`[slack] fallback engage via ${randomPersona.name}`);
      await this.applyHumanResponseTiming(channel, ts, randomPersona);
      const postedText = await this.engine.replyAsAgent(
        channel,
        threadTs,
        text,
        randomPersona,
        fullContext,
      );
      this.markPersonaReply(channel, threadTs, randomPersona.id);
      this.rememberAdHocThreadPersona(channel, threadTs, randomPersona.id);
      await this.followAgentMentions(
        postedText,
        channel,
        threadTs,
        personas,
        fullContext,
        randomPersona.id,
      );
      // Spontaneous second voice
      void this.maybePiggybackReply(
        channel,
        threadTs,
        text,
        personas,
        fullContext,
        randomPersona.id,
      );
      return;
    }

    console.log(`[slack] no active discussion found — ignoring message`);
  }
}

import {
  IAgentPersona,
  INightWatchConfig,
  IRegistryEntry,
  createLogger,
  generatePersonaAvatar,
  getDb,
  getRepositories,
  getRoadmapStatus,
} from '@night-watch/core';

const log = createLogger('slack');
import { SocketModeClient } from '@slack/socket-mode';
import { CascadingReplyHandler } from './cascading-reply-handler.js';
import { SlackClient } from './client.js';
import { ContextFetcher } from './context-fetcher.js';
import { DeliberationEngine } from './deliberation.js';
import { JobSpawner } from './job-spawner.js';
import type { IJobSpawnerCallbacks } from './job-spawner.js';
import { ProactiveLoop } from './proactive-loop.js';
import { MessageParser } from './message-parser.js';
import type { IEventsApiPayload, IInboundSlackEvent } from './message-parser.js';
import {
  resolveMentionedPersonas,
  resolvePersonasByPlainName,
  selectFollowUpPersona,
} from './personas.js';
import { sleep } from './utils.js';
import { ThreadStateManager } from './thread-state-manager.js';
import { TriggerRouter } from './trigger-router.js';

const SOCKET_DISCONNECT_TIMEOUT_MS = 5_000;

export class SlackInteractionListener {
  private readonly config: INightWatchConfig;
  private readonly slackClient: SlackClient;
  private readonly engine: DeliberationEngine;
  private readonly parser = new MessageParser();
  private readonly contextFetcher = new ContextFetcher();
  private readonly jobSpawner: JobSpawner;
  private readonly jobCallbacks: IJobSpawnerCallbacks;
  private readonly proactiveLoop: ProactiveLoop;
  private readonly state = new ThreadStateManager();
  private readonly triggerRouter: TriggerRouter;
  private readonly replyHandler: CascadingReplyHandler;
  private socketClient: SocketModeClient | null = null;
  private botUserId: string | null = null;

  constructor(slackClient: SlackClient, engine: DeliberationEngine, config: INightWatchConfig) {
    this.slackClient = slackClient;
    this.engine = engine;
    this.config = config;
    this.jobSpawner = new JobSpawner(slackClient, engine, config);
    this.jobCallbacks = {
      markChannelActivity: (ch) => this.state.markChannelActivity(ch),
      markPersonaReply: (ch, ts, pid) => this.state.markPersonaReply(ch, ts, pid),
    };
    this.replyHandler = new CascadingReplyHandler(this.slackClient, this.engine, this.state);
    this.triggerRouter = new TriggerRouter(
      this.parser,
      this.slackClient,
      this.engine,
      this.jobSpawner,
      this.state,
      this.contextFetcher,
      this.config,
      this.replyHandler,
    );
    this.proactiveLoop = new ProactiveLoop(
      config,
      engine,
      this.jobSpawner,
      this.jobCallbacks,
      this.state.getLastChannelActivityAt(),
      {
        markChannelActivity: (ch) => this.state.markChannelActivity(ch),
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

    if (this.socketClient) return;

    try {
      this.botUserId = await this.slackClient.getBotUserId();
    } catch (err) {
      log.warn('failed to resolve bot user id', { error: String(err) });
      this.botUserId = null;
    }

    const socket = new SocketModeClient({ appToken: slack.appToken });

    const onInboundEvent = (payload: IEventsApiPayload) => {
      void this.handleEventsApi(payload);
    };

    socket.on('app_mention', onInboundEvent);
    socket.on('message', onInboundEvent);
    socket.on('events_api', onInboundEvent);
    socket.on('error', (err: unknown) => {
      log.warn('socket error', { error: String(err) });
    });

    await socket.start();
    this.socketClient = socket;
    log.info('interaction listener started (Socket Mode)');
    this.proactiveLoop.start();
    void this.postPersonaIntros();
  }

  async stop(): Promise<void> {
    this.proactiveLoop.stop();

    if (!this.socketClient) return;

    const socket = this.socketClient;
    this.socketClient = null;

    try {
      await Promise.race([
        socket.disconnect(),
        sleep(SOCKET_DISCONNECT_TIMEOUT_MS).then(() => {
          throw new Error(`timed out after ${SOCKET_DISCONNECT_TIMEOUT_MS}ms`);
        }),
      ]);
      log.info('interaction listener stopped');
    } catch (err) {
      log.warn('shutdown failed', { error: String(err) });
    } finally {
      socket.removeAllListeners();
    }
  }

  private async postPersonaIntros(): Promise<void> {
    const slack = this.config.slack;
    if (!slack) return;

    // Join all project channels so the bot receives messages in them
    const repos = getRepositories();
    const projectChannelIds = repos.projectRegistry
      .getAll()
      .map((p) => p.slackChannelId)
      .filter(Boolean) as string[];

    for (const channelId of projectChannelIds) {
      this.state.markChannelActivity(channelId);
    }

    for (const channelId of projectChannelIds) {
      try {
        await this.slackClient.joinChannel(channelId);
        log.info('joined channel', { channel: channelId });
      } catch {
        // Ignore — channel may already be joined or private
      }
    }

    const introChannelId = projectChannelIds[0];
    if (!introChannelId) return;

    const db = getDb();
    const metaRow = db
      .prepare(`SELECT value FROM schema_meta WHERE key = 'slack_persona_intros_v4'`)
      .get() as { value: string } | undefined;
    const introduced = new Set<string>(metaRow ? (JSON.parse(metaRow.value) as string[]) : []);

    const personas = repos.agentPersona.getActive();
    const newPersonas = personas.filter((p) => !introduced.has(p.id));
    if (newPersonas.length === 0) {
      log.info('all personas already introduced — skipping intros');
      return;
    }

    log.info('introducing personas to #eng', { count: newPersonas.length });

    for (const persona of newPersonas) {
      // Generate avatar if missing and Replicate token is configured
      let currentPersona = persona;
      if (!currentPersona.avatarUrl && slack.replicateApiToken) {
        try {
          log.info('generating avatar', { agent: persona.name });
          const avatarUrl = await generatePersonaAvatar(
            persona.name,
            persona.role,
            slack.replicateApiToken,
          );
          if (avatarUrl) {
            currentPersona = repos.agentPersona.update(persona.id, {
              avatarUrl,
            });
            log.info('avatar set', { agent: persona.name, url: avatarUrl });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn('avatar generation failed', { agent: persona.name, error: msg });
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
        await this.slackClient.postAsAgent(introChannelId, intro, currentPersona);
        introduced.add(persona.id);
        db.prepare(
          `INSERT INTO schema_meta (key, value) VALUES ('slack_persona_intros_v4', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ).run(JSON.stringify(Array.from(introduced)));
        log.info('persona intro posted', { agent: persona.name });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn('persona intro failed', { agent: persona.name, error: msg });
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

    // Bot-posted root messages with issue URLs trigger an async review before the ignore filter.
    if (
      event.bot_id &&
      event.type === 'message' &&
      !event.subtype &&
      !event.thread_ts &&
      event.channel &&
      event.ts
    ) {
      const issueUrls = this.parser.extractGitHubIssueUrls(event.text ?? '');
      if (issueUrls.length > 0) {
        const repos = getRepositories();
        void this.triggerRouter
          .triggerIssueReviewIfFound(
            event.channel,
            event.ts,
            event.text ?? '',
            repos.projectRegistry.getAll(),
          )
          .catch((e: unknown) => log.warn('bot message issue-review failed', { error: String(e) }));
      }
    }

    if (this.parser.shouldIgnoreInboundSlackEvent(event, this.botUserId)) {
      log.debug('ignored self/system event', {
        type: event.type,
        subtype: event.subtype,
        channel: event.channel,
        bot_id: event.bot_id,
      });
      return;
    }

    log.info('inbound human event', {
      type: event.type,
      channel: event.channel,
      user: event.user,
      text: (event.text ?? '').slice(0, 80),
    });

    // Direct bot mentions arrive as app_mention; ignore the mirrored message event
    // to avoid duplicate or out-of-order handling on the same Slack message ts.
    if (
      event.type === 'message' &&
      this.botUserId &&
      (event.text ?? '').includes(`<@${this.botUserId}>`)
    ) {
      log.debug('ignoring mirrored message event for direct bot mention');
      return;
    }

    try {
      await this.handleInboundMessage(event);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('message handling failed', { error: msg });
    }
  }

  private buildProjectContext(channel: string, projects: IRegistryEntry[]): string {
    if (projects.length === 0) return '';
    const inChannel = projects.find((p) => p.slackChannelId === channel);
    return inChannel
      ? `Current channel project: ${inChannel.name}.`
      : `Registered projects: ${projects.map((p) => p.name).join(', ')}.`;
  }

  private buildRoadmapContext(channel: string, projects: IRegistryEntry[]): string {
    if (projects.length === 0) return '';
    const inChannel = projects.find((p) => p.slackChannelId === channel);
    const scoped = inChannel ? [inChannel] : projects;
    return scoped
      .flatMap((project) => {
        try {
          const status = getRoadmapStatus(project.path, this.config);
          if (!status.found || status.items.length === 0) return [];
          const pending = status.items.filter((i) => !i.processed && !i.checked);
          const done = status.items.filter((i) => i.processed);
          let summary = `${project.name}: ${done.length}/${status.items.length} roadmap items done`;
          if (pending.length > 0)
            summary += `. Next up: ${pending
              .slice(0, 3)
              .map((i) => i.title)
              .join(', ')}`;
          if (done.length === status.items.length) summary += ' (all complete)';
          return [summary];
        } catch {
          return [];
        }
      })
      .join('\n');
  }

  private async handleInboundMessage(event: IInboundSlackEvent): Promise<void> {
    if (this.parser.shouldIgnoreInboundSlackEvent(event, this.botUserId)) {
      log.debug('ignoring event — shouldIgnore check', {
        user: event.user,
        bot_id: event.bot_id,
        subtype: event.subtype,
      });
      return;
    }

    const channel = event.channel as string;
    const ts = event.ts as string;
    const threadTs = event.thread_ts ?? ts;
    const text = event.text ?? '';
    const messageKey = this.parser.buildInboundMessageKey(channel, ts, event.type);
    this.state.markChannelActivity(channel);

    // Deduplicate retried/replayed events to prevent response loops.
    if (!this.state.rememberMessageKey(messageKey)) {
      log.debug('duplicate event, skipping', { key: messageKey });
      return;
    }

    const repos = getRepositories();
    const personas = repos.agentPersona.getActive();
    const projects = repos.projectRegistry.getAll();
    const projectContext = this.buildProjectContext(channel, projects);

    // Fetch GitHub issue/PR content from URLs in the message so agents can inspect them.
    const githubUrls = this.parser.extractGitHubIssueUrls(text);
    const genericUrls = this.parser.extractGenericUrls(text);
    log.info('processing message', {
      channel,
      thread: threadTs,
      github_urls: githubUrls.length,
      generic_urls: genericUrls.length,
    });
    const githubContext =
      githubUrls.length > 0 ? await this.contextFetcher.fetchGitHubIssueContext(githubUrls) : '';
    const urlContext =
      genericUrls.length > 0 ? await this.contextFetcher.fetchUrlSummaries(genericUrls) : '';
    let fullContext = projectContext;
    if (githubContext) fullContext += `\n\nReferenced GitHub content:\n${githubContext}`;
    if (urlContext) fullContext += `\n\nReferenced links:\n${urlContext}`;

    if (
      await this.triggerRouter.tryRoute({
        event,
        channel,
        threadTs,
        messageTs: ts,
        personas,
        projects,
      })
    ) {
      return;
    }

    // @mention matching: "@maya ..."
    let mentionedPersonas = resolveMentionedPersonas(text, personas);

    // Also try plain-name matching (e.g. "Carlos, are you there?").
    // For app_mention text like "<@UBOTID> maya check this", the @-regex won't find "maya".
    if (mentionedPersonas.length === 0) {
      mentionedPersonas = resolvePersonasByPlainName(text, personas);
      if (mentionedPersonas.length > 0) {
        log.info('plain-name match', { agents: mentionedPersonas.map((p) => p.name).join(', ') });
      }
    }

    // Persona mentioned → respond regardless of whether a formal discussion exists.
    if (mentionedPersonas.length > 0) {
      log.info('routing to mentioned persona(s)', {
        agents: mentionedPersonas.map((p) => p.name).join(', '),
        channel,
      });
      const discussion = repos.slackDiscussion
        .getActive('')
        .find((d) => d.channelId === channel && d.threadTs === threadTs);

      let lastPosted = '';
      let lastPersonaId = '';
      for (const persona of mentionedPersonas) {
        if (this.state.isPersonaOnCooldown(channel, threadTs, persona.id)) continue;
        await this.replyHandler.applyHumanResponseTiming(channel, ts, persona);
        if (discussion) {
          await this.engine.contributeAsAgent(discussion.id, persona);
        } else {
          log.info('replying as agent', { agent: persona.name, channel });
          lastPosted = await this.engine.replyAsAgent(
            channel,
            threadTs,
            text,
            persona,
            fullContext,
          );
          lastPersonaId = persona.id;
        }
        this.state.markPersonaReply(channel, threadTs, persona.id);
      }

      if (!discussion && mentionedPersonas[0]) {
        this.state.rememberAdHocThreadPersona(channel, threadTs, mentionedPersonas[0].id);
      }

      // Follow up if the last agent reply mentions other teammates by name.
      if (lastPosted && lastPersonaId) {
        await this.replyHandler.followAgentMentions(
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

    log.debug('no persona match — checking for active discussion', { channel, thread: threadTs });

    // No persona mention — only handle within an existing Night Watch discussion thread.
    const discussion = repos.slackDiscussion
      .getActive('')
      .find((d) => d.channelId === channel && d.threadTs === threadTs);

    if (discussion) {
      await this.engine.handleHumanMessage(channel, threadTs, text, event.user as string);
      return;
    }

    // Continue ad-hoc threads even without a persisted discussion.
    const rememberedPersona = this.state.getRememberedAdHocPersona(channel, threadTs, personas);
    if (rememberedPersona) {
      const followUpPersona = selectFollowUpPersona(rememberedPersona, personas, text);
      if (followUpPersona.id !== rememberedPersona.id) {
        log.info('handing off ad-hoc thread', {
          from: rememberedPersona.name,
          to: followUpPersona.name,
          channel,
        });
      } else {
        log.info('continuing ad-hoc thread', { agent: rememberedPersona.name, channel });
      }
      await this.replyAndFollowUp(
        channel,
        threadTs,
        ts,
        text,
        followUpPersona,
        personas,
        fullContext,
      );
      return;
    }

    // In-memory state was lost (e.g. server restart) — recover persona from thread history.
    if (threadTs) {
      const recoveredPersona = await this.replyHandler.recoverPersonaFromThreadHistory(
        channel,
        threadTs,
        personas,
      );
      if (recoveredPersona) {
        const followUpPersona = selectFollowUpPersona(recoveredPersona, personas, text);
        log.info('recovered ad-hoc thread persona from history', {
          recovered: recoveredPersona.name,
          replyingAs: followUpPersona.name,
          channel,
        });
        await this.replyAndFollowUp(
          channel,
          threadTs,
          ts,
          text,
          followUpPersona,
          personas,
          fullContext,
        );
        return;
      }
    }

    // Ambient team messages ("hey guys", "happy friday", "are you all alive?") get multiple replies.
    if (this.parser.isAmbientTeamMessage(text)) {
      log.info('ambient team message — engaging multiple personas', { channel });
      await this.replyHandler.engageMultiplePersonas(
        channel,
        threadTs,
        ts,
        text,
        personas,
        fullContext,
      );
      return;
    }

    // Direct bot mentions always get a reply.
    if (event.type === 'app_mention') {
      const randomPersona = this.state.pickRandomPersona(personas, channel, threadTs);
      if (randomPersona) {
        log.info('app_mention auto-engaging', { agent: randomPersona.name, channel });
        await this.replyAndFollowUp(
          channel,
          threadTs,
          ts,
          text,
          randomPersona,
          personas,
          fullContext,
        );
        return;
      }
    }

    // Any human message: agents independently decide whether to react.
    for (const persona of personas) {
      if (
        !this.state.isPersonaOnCooldown(channel, threadTs, persona.id) &&
        Math.random() < this.replyHandler.randomReactionProbability
      ) {
        void this.replyHandler.maybeReactToHumanMessage(channel, ts, persona);
      }
    }

    // Guaranteed fallback reply — someone always responds.
    const randomPersona = this.state.pickRandomPersona(personas, channel, threadTs);
    if (randomPersona) {
      log.info('fallback engage', { agent: randomPersona.name, channel });
      await this.replyAndFollowUp(
        channel,
        threadTs,
        ts,
        text,
        randomPersona,
        personas,
        fullContext,
      );
      return;
    }

    log.debug('no active discussion found — ignoring message', { channel, thread: threadTs });
  }

  private async replyAndFollowUp(
    channel: string,
    threadTs: string,
    ts: string,
    text: string,
    persona: IAgentPersona,
    personas: IAgentPersona[],
    fullContext: string,
  ): Promise<void> {
    await this.replyHandler.applyHumanResponseTiming(channel, ts, persona);
    log.info('replying as agent', { agent: persona.name, channel });
    const postedText = await this.engine.replyAsAgent(
      channel,
      threadTs,
      text,
      persona,
      fullContext,
    );
    this.state.markPersonaReply(channel, threadTs, persona.id);
    this.state.rememberAdHocThreadPersona(channel, threadTs, persona.id);
    await this.replyHandler.followAgentMentions(
      postedText,
      channel,
      threadTs,
      personas,
      fullContext,
      persona.id,
    );
    void this.replyHandler.maybePiggybackReply(
      channel,
      threadTs,
      text,
      personas,
      fullContext,
      persona.id,
    );
  }
}

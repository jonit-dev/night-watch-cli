/**
 * TriggerRouter — routes inbound Slack messages to the appropriate handler.
 * Extracted from SlackInteractionListener to apply SRP: this class owns all
 * trigger-detection logic and delegates execution to JobSpawner / DeliberationEngine.
 */

import { INightWatchConfig, createLogger, getRepositories } from '@night-watch/core';
import type { IAgentPersona, IRegistryEntry } from '@night-watch/core';
import { execFileSync } from 'child_process';
import type { CascadingReplyHandler } from './cascading-reply-handler.js';
import { SlackClient } from './client.js';
import { ContextFetcher } from './context-fetcher.js';
import { DeliberationEngine } from './deliberation.js';
import { JobSpawner } from './job-spawner.js';
import type { IJobSpawnerCallbacks } from './job-spawner.js';
import { MessageParser } from './message-parser.js';
import type { IInboundSlackEvent, ISlackIssueReviewable } from './message-parser.js';
import { ThreadStateManager } from './thread-state-manager.js';
import { matchProjectToMessage } from './ai/project-matcher.js';
import { buildCurrentCliInvocation, normalizeProjectRef, stripSlackUserMentions } from './utils.js';

const log = createLogger('trigger-router');

export interface ITriggerContext {
  event: IInboundSlackEvent;
  channel: string;
  threadTs: string;
  messageTs: string;
  personas: IAgentPersona[];
  projects: IRegistryEntry[];
}

export class TriggerRouter {
  private readonly jobCallbacks: IJobSpawnerCallbacks;

  constructor(
    private readonly parser: MessageParser,
    private readonly slackClient: SlackClient,
    private readonly engine: DeliberationEngine,
    private readonly jobSpawner: JobSpawner,
    private readonly state: ThreadStateManager,
    private readonly contextFetcher: ContextFetcher,
    private readonly config: INightWatchConfig,
    private readonly replyHandler: CascadingReplyHandler,
  ) {
    this.jobCallbacks = {
      markChannelActivity: (ch) => this.state.markChannelActivity(ch),
      markPersonaReply: (ch, ts, pid) => this.state.markPersonaReply(ch, ts, pid),
    };
  }

  /**
   * Try all registered trigger handlers in priority order.
   * Returns true if a trigger was matched and handled (caller should return early).
   */
  async tryRoute(ctx: ITriggerContext): Promise<boolean> {
    const { event, channel, threadTs, messageTs, personas, projects } = ctx;
    if (await this.triggerDirectProviderIfRequested(event, channel, threadTs, messageTs, personas))
      return true;
    if (await this.triggerSlackJobIfRequested(event, channel, threadTs, messageTs, personas))
      return true;
    if (await this.triggerIssuePickupIfRequested(event, channel, threadTs, messageTs, personas))
      return true;
    if (
      !event.thread_ts &&
      (await this.triggerIssueReviewIfFound(channel, messageTs, event.text ?? '', projects))
    )
      return true;
    return false;
  }

  /**
   * Trigger an issue review discussion if the text contains a GitHub issue URL.
   * Anti-loop: tracked per-URL with a 30-minute cooldown. Only root messages trigger reviews.
   * Returns true if a review was started (caller should return early).
   * Public so handleEventsApi can call it directly for bot-posted messages.
   */
  async triggerIssueReviewIfFound(
    channel: string,
    ts: string,
    text: string,
    projects: IRegistryEntry[],
  ): Promise<boolean> {
    const reviewable: ISlackIssueReviewable | null = this.parser.parseSlackIssueReviewable(text);
    if (!reviewable) return false;

    if (this.state.isIssueOnReviewCooldown(reviewable.issueUrl)) {
      log.debug('issue-review cooldown active, skipping', { url: reviewable.issueUrl });
      return false;
    }

    const targetProject = this.resolveTargetProject(channel, projects);
    if (!targetProject) return false;

    const issueContext = await this.contextFetcher
      .fetchGitHubIssueContext([reviewable.issueUrl])
      .catch(() => '');

    const trigger = {
      type: 'issue_review' as const,
      ref: reviewable.issueRef,
      context: issueContext || `GitHub Issue: ${reviewable.issueUrl}`,
      channelId: channel,
      threadTs: ts,
      projectPath: targetProject.path,
    };

    this.state.markIssueReviewed(reviewable.issueUrl);
    log.info('starting issue review', { ref: reviewable.issueRef, channel, ts });
    void this.engine
      .startDiscussion(trigger)
      .catch((e: unknown) => log.warn('issue-review startDiscussion failed', { error: String(e) }));
    return true;
  }

  isMessageAddressedToBot(event: IInboundSlackEvent): boolean {
    if (event.type === 'app_mention') return true;
    const text = this.parser.normalizeForParsing(stripSlackUserMentions(event.text ?? ''));
    return /^night[-\s]?watch\b/.test(text) || /^nw\b/.test(text);
  }

  resolveProjectByHint(projects: IRegistryEntry[], hint: string): IRegistryEntry | null {
    const h = normalizeProjectRef(hint);
    if (!h) return null;
    const base = (p: IRegistryEntry) => normalizeProjectRef(p.path.split('/').pop() ?? '');
    return (
      projects.find((p) => normalizeProjectRef(p.name) === h) ??
      projects.find((p) => base(p) === h) ??
      projects.find((p) => normalizeProjectRef(p.name).includes(h)) ??
      projects.find((p) => base(p).includes(h)) ??
      projects.find((p) => h.includes(normalizeProjectRef(p.name))) ??
      projects.find((p) => h.includes(base(p))) ??
      null
    );
  }

  resolveTargetProject(
    channel: string,
    projects: IRegistryEntry[],
    projectHint?: string,
  ): IRegistryEntry | null {
    if (projectHint) return this.resolveProjectByHint(projects, projectHint);
    return (
      projects.find((p) => p.slackChannelId === channel) ??
      (projects.length === 1 ? projects[0] : null)
    );
  }

  /**
   * Resolve a target project: tries fast channel/hint matching first, then falls back
   * to an AI inference from the message text before giving up.
   */
  private async resolveProject(
    text: string,
    channel: string,
    projects: IRegistryEntry[],
    hint?: string,
  ): Promise<IRegistryEntry | null> {
    const fast = this.resolveTargetProject(channel, projects, hint);
    if (fast) return fast;
    return matchProjectToMessage(text, projects, this.config).catch(() => null);
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
      this.state.findPersonaByName(personas, 'Dev') ??
      this.state.pickRandomPersona(personas, channel, threadTs) ??
      personas[0];
    if (!persona) return false;

    const targetProject = await this.resolveProject(
      event.text ?? '',
      channel,
      projects,
      request.projectHint,
    );
    if (!targetProject) {
      const projectNames = projects.map((p) => p.name).join(', ') || '(none registered)';
      await this.slackClient.postAsAgent(
        channel,
        `Which project? Registered: ${projectNames}.`,
        persona,
        threadTs,
      );
      this.state.markChannelActivity(channel);
      this.state.markPersonaReply(channel, threadTs, persona.id);
      return true;
    }

    log.info('routing direct provider request', {
      provider: request.provider,
      agent: persona.name,
      project: targetProject.name,
    });

    const providerLabel = request.provider === 'claude' ? 'Claude' : 'Codex';
    const compactPrompt = request.prompt.replace(/\s+/g, ' ').trim();
    const promptPreview =
      compactPrompt.length > 120 ? `${compactPrompt.slice(0, 117)}...` : compactPrompt;

    await this.replyHandler.applyHumanResponseTiming(channel, messageTs, persona);
    await this.slackClient.postAsAgent(
      channel,
      `Running ${providerLabel} directly${request.projectHint ? ` on ${targetProject.name}` : ''}: "${promptPreview}"`,
      persona,
      threadTs,
    );
    this.state.markChannelActivity(channel);
    this.state.markPersonaReply(channel, threadTs, persona.id);
    this.state.rememberAdHocThreadPersona(channel, threadTs, persona.id);

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
      (request.job === 'run' ? this.state.findPersonaByName(personas, 'Dev') : null) ??
      (request.job === 'qa' ? this.state.findPersonaByName(personas, 'Priya') : null) ??
      (request.job === 'review' ? this.state.findPersonaByName(personas, 'Carlos') : null) ??
      this.state.pickRandomPersona(personas, channel, threadTs) ??
      personas[0];

    if (!persona) return false;

    const targetProject = await this.resolveProject(
      event.text ?? '',
      channel,
      projects,
      request.projectHint,
    );
    if (!targetProject) {
      const projectNames = projects.map((p) => p.name).join(', ') || '(none registered)';
      await this.slackClient.postAsAgent(
        channel,
        `Which project? Registered: ${projectNames}.`,
        persona,
        threadTs,
      );
      this.state.markChannelActivity(channel);
      this.state.markPersonaReply(channel, threadTs, persona.id);
      return true;
    }

    log.info('routing job request', {
      job: request.job,
      agent: persona.name,
      project: targetProject.name,
      pr: request.prNumber,
      fixConflicts: request.fixConflicts || undefined,
    });

    let planLine: string;
    if (request.job === 'review') {
      planLine = `On it${request.prNumber ? ` — PR #${request.prNumber}` : ''}${request.fixConflicts ? ', including the conflicts' : ''}.`;
    } else if (request.job === 'qa') {
      planLine = `Running QA${request.prNumber ? ` on #${request.prNumber}` : ''}.`;
    } else {
      planLine = `Starting the run${request.prNumber ? ` for #${request.prNumber}` : ''}.`;
    }

    await this.replyHandler.applyHumanResponseTiming(channel, messageTs, persona);

    await this.slackClient.postAsAgent(channel, `${planLine}`, persona, threadTs);
    log.info('agent accepted job', {
      agent: persona.name,
      job: request.job,
      project: targetProject.name,
      pr: request.prNumber,
    });
    this.state.markChannelActivity(channel);
    this.state.markPersonaReply(channel, threadTs, persona.id);
    this.state.rememberAdHocThreadPersona(channel, threadTs, persona.id);

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
      this.state.findPersonaByName(personas, 'Dev') ??
      this.state.pickRandomPersona(personas, channel, threadTs) ??
      personas[0];
    if (!persona) return false;

    const targetProject = await this.resolveProject(
      event.text ?? '',
      channel,
      projects,
      request.repoHint,
    );
    if (!targetProject) {
      const projectNames = projects.map((p) => p.name).join(', ') || '(none registered)';
      await this.slackClient.postAsAgent(
        channel,
        `Which project? Registered: ${projectNames}.`,
        persona,
        threadTs,
      );
      this.state.markChannelActivity(channel);
      this.state.markPersonaReply(channel, threadTs, persona.id);
      return true;
    }

    log.info('routing issue pickup', {
      issue: request.issueNumber,
      agent: persona.name,
      project: targetProject.name,
    });

    await this.replyHandler.applyHumanResponseTiming(channel, messageTs, persona);
    await this.slackClient.postAsAgent(
      channel,
      `On it — picking up #${request.issueNumber}. Starting the run now.`,
      persona,
      threadTs,
    );
    this.state.markChannelActivity(channel);
    this.state.markPersonaReply(channel, threadTs, persona.id);
    this.state.rememberAdHocThreadPersona(channel, threadTs, persona.id);

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
        log.info('issue moved to In Progress', { issue: request.issueNumber });
      } catch {
        log.warn('failed to move issue to In Progress', { issue: request.issueNumber });
      }
    }

    log.info('spawning run for issue', { issue: request.issueNumber });
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
}

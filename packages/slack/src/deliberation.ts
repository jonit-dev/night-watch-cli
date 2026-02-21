/**
 * Deliberation Engine for Night Watch.
 * Orchestrates multi-agent Slack discussions when trigger events occur.
 * Agents discuss in threads, reach consensus, and drive PR actions.
 */

import {
  IAgentPersona,
  IBoardProviderConfig,
  IDiscussionTrigger,
  INightWatchConfig,
  IReflectionContext,
  ISlackDiscussion,
  MemoryService,
  createBoardProvider,
  createLogger,
  getRepositories,
  loadConfig,
} from '@night-watch/core';

const log = createLogger('deliberation');
import { type ISlackMessage, SlackClient } from './client.js';
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import {
  buildCurrentCliInvocation,
  formatCommandForLog,
  getNightWatchTsconfigPath,
  normalizeText,
  sleep,
} from './utils.js';
import { humanizeSlackReply, isSkipMessage } from './humanizer.js';
import { findCarlos, findDev, getParticipatingPersonas } from './personas.js';
import {
  MAX_ROUNDS,
  buildContributionPrompt,
  buildIssueTitleFromTrigger,
  buildOpeningMessage,
  formatThreadHistory,
  hasConcreteCodeContext,
} from './deliberation-builders.js';
import {
  buildBoardTools,
  buildCodebaseQueryTool,
  callAIForContribution,
  callAIWithTools,
  executeBoardTool,
  executeCodebaseQuery,
  resolvePersonaAIConfig,
} from './ai/index.js';
import type { ToolRegistry } from './ai/index.js';

// Re-export humanizeSlackReply for backwards compatibility with existing tests

export { humanizeSlackReply } from './humanizer.js';

const MAX_CONTRIBUTIONS_PER_ROUND = 2;
const MAX_AGENT_THREAD_REPLIES = 4;
const HUMAN_DELAY_MIN_MS = 20_000; // Minimum pause between agent replies (20s)
const HUMAN_DELAY_MAX_MS = 60_000; // Maximum pause between agent replies (60s)
const DISCUSSION_RESUME_DELAY_MS = 60_000;
const DISCUSSION_REPLAY_GUARD_MS = 30 * 60_000;

const inFlightDiscussionStarts = new Map<string, Promise<ISlackDiscussion>>();

function discussionStartKey(trigger: IDiscussionTrigger): string {
  return `${trigger.projectPath}:${trigger.type}:${trigger.ref}`;
}

/**
 * Return a random delay in the human-like range so replies don't arrive
 * in an obviously robotic cadence.
 */
function humanDelay(): number {
  return HUMAN_DELAY_MIN_MS + Math.random() * (HUMAN_DELAY_MAX_MS - HUMAN_DELAY_MIN_MS);
}

/**
 * Determine which Slack channel to use for a trigger type
 */
function getChannelForTrigger(trigger: IDiscussionTrigger, config: INightWatchConfig): string {
  const slack = config.slack;
  if (!slack) return '';

  // Use explicitly provided channelId if given (e.g., for project-specific channels)
  if (trigger.channelId) return trigger.channelId;

  switch (trigger.type) {
    case 'pr_review':
      return slack.channels.prs;
    case 'build_failure':
      return slack.channels.incidents;
    case 'prd_kickoff':
      return slack.channels.eng; // Callers should populate trigger.channelId with proj channel
    case 'code_watch':
      return slack.channels.eng;
    case 'issue_review':
      return slack.channels.eng;
    default:
      return slack.channels.eng;
  }
}

function loadPrDiffExcerpt(projectPath: string, ref: string): string {
  const prNumber = Number.parseInt(ref, 10);
  if (Number.isNaN(prNumber)) return '';

  try {
    const diff = execFileSync('gh', ['pr', 'diff', String(prNumber), '--color=never'], {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 2 * 1024 * 1024,
    });
    const excerpt = diff.split('\n').slice(0, 160).join('\n').trim();
    if (!excerpt) return '';
    return `PR diff excerpt (first 160 lines):\n\`\`\`diff\n${excerpt}\n\`\`\``;
  } catch {
    return '';
  }
}

function countThreadReplies(messages: ISlackMessage[]): number {
  return Math.max(0, messages.length - 1);
}

function chooseRoundContributors(personas: IAgentPersona[], maxCount: number): IAgentPersona[] {
  if (maxCount <= 0) return [];

  const lead = findCarlos(personas);
  if (!lead) return personas.slice(0, maxCount);

  const nonLead = personas.filter((persona) => persona.id !== lead.id);
  const candidates = nonLead.length >= 2 ? nonLead : personas;
  return candidates.slice(0, maxCount);
}

export class DeliberationEngine {
  private readonly slackClient: SlackClient;
  private readonly config: INightWatchConfig;
  private readonly memoryService: MemoryService;
  private readonly humanResumeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly emojiCadenceCounter = new Map<string, number>();

  constructor(slackClient: SlackClient, config: INightWatchConfig) {
    this.slackClient = slackClient;
    this.config = config;
    this.memoryService = new MemoryService();
  }

  private resolveReplyProjectPath(channel: string, threadTs: string): string | null {
    const repos = getRepositories();
    const activeDiscussions = repos.slackDiscussion.getActive('');
    const discussion = activeDiscussions.find(
      (d) => d.channelId === channel && d.threadTs === threadTs,
    );
    if (discussion?.projectPath) {
      return discussion.projectPath;
    }

    const projects = repos.projectRegistry.getAll();
    const channelProject = projects.find((p) => p.slackChannelId === channel);
    if (channelProject?.path) {
      return channelProject.path;
    }

    return projects.length === 1 ? projects[0].path : null;
  }

  private resolveBoardConfig(projectPath: string): IBoardProviderConfig | null {
    try {
      const config = loadConfig(projectPath);
      const boardConfig = config.boardProvider;
      if (boardConfig?.enabled && typeof boardConfig.projectNumber === 'number') {
        return boardConfig;
      }
    } catch {
      // Ignore config loading failures and treat as board-not-configured.
    }
    return null;
  }

  private humanizeForPost(
    channel: string,
    threadTs: string,
    persona: IAgentPersona,
    raw: string,
  ): string {
    const key = `${channel}:${threadTs}:${persona.id}`;
    const count = (this.emojiCadenceCounter.get(key) ?? 0) + 1;
    this.emojiCadenceCounter.set(key, count);

    // Human cadence:
    // - emoji roughly every 3rd message by same persona in same thread
    // - non-facial emoji much rarer (roughly every 9th message)
    const allowEmoji = count % 3 === 0;
    const allowNonFacialEmoji = count % 9 === 0;

    // Vary sentence length naturally — some messages are punchy (1-2), others fuller (3)
    const maxSentences = Math.random() < 0.35 ? 1 : Math.random() < 0.6 ? 2 : 3;
    // Vary char ceiling so messages don't all end at the exact same cutoff
    const maxChars = 280 + Math.floor(Math.random() * 160); // 280-440

    return humanizeSlackReply(raw, { allowEmoji, allowNonFacialEmoji, maxSentences, maxChars });
  }

  /**
   * Start a new discussion thread for a trigger event.
   * Posts the opening message and kicks off the first round of contributions.
   */
  async startDiscussion(trigger: IDiscussionTrigger): Promise<ISlackDiscussion> {
    const key = discussionStartKey(trigger);
    const existingInFlight = inFlightDiscussionStarts.get(key);
    if (existingInFlight) {
      return existingInFlight;
    }

    const startPromise = this.startDiscussionInternal(trigger);
    inFlightDiscussionStarts.set(key, startPromise);

    try {
      return await startPromise;
    } finally {
      if (inFlightDiscussionStarts.get(key) === startPromise) {
        inFlightDiscussionStarts.delete(key);
      }
    }
  }

  private async startDiscussionInternal(trigger: IDiscussionTrigger): Promise<ISlackDiscussion> {
    const repos = getRepositories();
    const latest = repos.slackDiscussion.getLatestByTrigger(
      trigger.projectPath,
      trigger.type,
      trigger.ref,
    );
    if (latest) {
      if (latest.status === 'active') {
        return latest;
      }
      if (Date.now() - latest.updatedAt < DISCUSSION_REPLAY_GUARD_MS) {
        return latest;
      }
    }

    const personas = repos.agentPersona.getActive();

    const participants = getParticipatingPersonas(trigger.type, personas);

    // Resolve project channel for prd_kickoff
    const resolvedTrigger = { ...trigger };
    if (trigger.type === 'prd_kickoff' && !trigger.channelId) {
      const projects = repos.projectRegistry.getAll();
      const project = projects.find((p) => p.path === trigger.projectPath);
      if (project?.slackChannelId) {
        resolvedTrigger.channelId = project.slackChannelId;
      }
    }
    if (resolvedTrigger.type === 'pr_review' && !hasConcreteCodeContext(resolvedTrigger.context)) {
      const diffExcerpt = loadPrDiffExcerpt(resolvedTrigger.projectPath, resolvedTrigger.ref);
      if (diffExcerpt) {
        resolvedTrigger.context = `${resolvedTrigger.context}\n\n${diffExcerpt}`.slice(0, 5000);
      }
    }
    const channel = getChannelForTrigger(resolvedTrigger, this.config);

    if (!channel) {
      throw new Error(`No Slack channel configured for trigger type: ${trigger.type}`);
    }

    // Find the dev persona to open the thread
    const devPersona = findDev(participants) ?? participants[0];
    if (!devPersona) {
      throw new Error('No active agent personas found');
    }

    // Decide thread anchor: use existing thread ts or create new opening post
    const openingText = trigger.openingMessage ?? buildOpeningMessage(resolvedTrigger);
    let discussionThreadTs: string;
    let initialParticipants: string[];

    if (resolvedTrigger.threadTs) {
      // Thread already exists (e.g., reply anchored on a human-posted message)
      discussionThreadTs = resolvedTrigger.threadTs;
      initialParticipants = [];
    } else {
      const openingMsg = await this.slackClient.postAsAgent(channel, openingText, devPersona);
      await sleep(humanDelay());
      discussionThreadTs = openingMsg.ts;
      initialParticipants = [devPersona.id];
    }

    // Create discussion record
    const discussion = repos.slackDiscussion.create({
      projectPath: trigger.projectPath,
      triggerType: trigger.type,
      triggerRef: trigger.ref,
      channelId: channel,
      threadTs: discussionThreadTs,
      status: 'active',
      round: 1,
      participants: initialParticipants,
      consensusResult: null,
    });
    log.info('discussion started', {
      discussionId: discussion.id,
      trigger: trigger.type,
      ref: trigger.ref,
      channel,
      participants: participants.map((p) => p.name).join(', '),
    });

    // Run first round of contributions
    // When using an existing thread, all participants contribute (no opener was posted)
    const reviewers = resolvedTrigger.threadTs
      ? participants
      : participants.filter((p) => p.id !== devPersona.id);

    await this.runContributionRound(discussion.id, reviewers, resolvedTrigger, openingText);

    // Check consensus after first round
    await this.evaluateConsensus(discussion.id, resolvedTrigger);

    return repos.slackDiscussion.getById(discussion.id)!;
  }

  /**
   * Have a specific agent contribute to an existing discussion.
   */
  async contributeAsAgent(discussionId: string, persona: IAgentPersona): Promise<void> {
    const repos = getRepositories();
    const discussion = repos.slackDiscussion.getById(discussionId);
    if (!discussion || discussion.status !== 'active') return;

    // Get thread history for context
    const history = await this.slackClient.getChannelHistory(
      discussion.channelId,
      discussion.threadTs,
      10,
    );
    const historyText = formatThreadHistory(history);
    const historySet = new Set(history.map((m) => normalizeText(m.text)).filter(Boolean));

    // Rebuild trigger context from discussion record
    const trigger: IDiscussionTrigger = {
      type: discussion.triggerType,
      projectPath: discussion.projectPath,
      ref: discussion.triggerRef,
      context: historyText,
    };

    const contributionPrompt = buildContributionPrompt(
      persona,
      trigger,
      historyText,
      discussion.round,
    );

    let message: string;
    try {
      message = await callAIForContribution(persona, this.config, contributionPrompt);
    } catch (err) {
      log.error('callAIForContribution failed', { agent: persona.name, error: String(err) });
      message = `[Contribution from ${persona.name} unavailable — AI provider not configured]`;
    }

    if (message) {
      const finalMessage = this.humanizeForPost(
        discussion.channelId,
        discussion.threadTs,
        persona,
        message,
      );
      if (isSkipMessage(finalMessage)) return;
      const normalized = normalizeText(finalMessage);
      if (!normalized || historySet.has(normalized)) return;
      await this.slackClient.postAsAgent(
        discussion.channelId,
        finalMessage,
        persona,
        discussion.threadTs,
      );
      repos.slackDiscussion.addParticipant(discussionId, persona.id);
      await sleep(humanDelay());
    }
  }

  /**
   * Handle a human message posted in a discussion thread.
   * Pauses agent contributions; lead summarizes after silence.
   */
  async handleHumanMessage(
    channel: string,
    threadTs: string,
    _message: string,
    _userId: string,
  ): Promise<void> {
    // Find the discussion by threadTs
    const repos = getRepositories();
    const activeDiscussions = repos.slackDiscussion.getActive('');
    const discussion = activeDiscussions.find(
      (d) => d.channelId === channel && d.threadTs === threadTs,
    );

    if (!discussion) return;

    const existingTimer = this.humanResumeTimers.get(discussion.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Human is involved — debounce for a short pause before the lead summarizes.
    const timer = setTimeout(() => {
      void (async () => {
        const innerRepos = getRepositories();
        const personas = innerRepos.agentPersona.getActive();
        const carlos = findCarlos(personas) ?? personas[0];
        if (!carlos) return;

        const updated = innerRepos.slackDiscussion.getById(discussion.id);
        if (!updated || updated.status !== 'active') return;

        await this.slackClient.postAsAgent(
          channel,
          'Ok, picking this back up. Let me see where we landed.',
          carlos,
          threadTs,
        );
        await sleep(humanDelay());
        await this.evaluateConsensus(discussion.id, {
          type: discussion.triggerType,
          projectPath: discussion.projectPath,
          ref: discussion.triggerRef,
          context: '',
        });
      })().finally(() => {
        this.humanResumeTimers.delete(discussion.id);
      });
    }, DISCUSSION_RESUME_DELAY_MS);

    this.humanResumeTimers.set(discussion.id, timer);
  }

  /**
   * Run a round of contributions from the given personas.
   */
  private async runContributionRound(
    discussionId: string,
    personas: IAgentPersona[],
    trigger: IDiscussionTrigger,
    currentContext: string,
  ): Promise<void> {
    const repos = getRepositories();
    const discussion = repos.slackDiscussion.getById(discussionId);
    if (!discussion) return;

    // Get current thread history
    let history = await this.slackClient.getChannelHistory(
      discussion.channelId,
      discussion.threadTs,
      10,
    );
    let historyText = formatThreadHistory(history) || currentContext;
    const seenMessages = new Set(
      history.map((message) => normalizeText(message.text)).filter(Boolean),
    );

    const repliesUsed = countThreadReplies(history);
    const reviewerBudget = Math.max(0, MAX_AGENT_THREAD_REPLIES - repliesUsed - 1);
    if (reviewerBudget <= 0) return;

    const contributors = chooseRoundContributors(
      personas,
      Math.min(MAX_CONTRIBUTIONS_PER_ROUND, reviewerBudget),
    );
    let posted = 0;

    const projectSlug = basename(trigger.projectPath);

    for (const persona of contributors) {
      if (posted >= reviewerBudget) break;

      const updatedDiscussion = repos.slackDiscussion.getById(discussionId);
      if (!updatedDiscussion || updatedDiscussion.status !== 'active') break;

      const contributionPrompt = buildContributionPrompt(
        persona,
        trigger,
        historyText,
        updatedDiscussion.round,
      );

      // Fetch persona memory to inject into the system prompt (optional — ignore errors)
      let memory: string | undefined;
      try {
        memory = await this.memoryService.getMemory(persona.name, projectSlug);
      } catch {
        // Memory is optional — never block a contribution due to a read failure
      }

      let message: string;
      try {
        message = await callAIForContribution(
          persona,
          this.config,
          contributionPrompt,
          undefined,
          memory,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn('AI contribution failed', { agent: persona.name, error: msg });
        message = '';
      }

      if (!message || isSkipMessage(message)) continue;

      const finalMessage = this.humanizeForPost(
        discussion.channelId,
        discussion.threadTs,
        persona,
        message,
      );
      if (!finalMessage || isSkipMessage(finalMessage)) continue;

      const normalized = normalizeText(finalMessage);
      if (!normalized || seenMessages.has(normalized)) continue;

      await this.slackClient.postAsAgent(
        discussion.channelId,
        finalMessage,
        persona,
        discussion.threadTs,
      );
      repos.slackDiscussion.addParticipant(discussionId, persona.id);
      seenMessages.add(normalized);
      posted += 1;
      log.info('agent contributed', {
        agent: persona.name,
        discussionId,
        channel: discussion.channelId,
        round: updatedDiscussion.round,
        trigger: trigger.type,
      });

      // Fire-and-forget reflection after each successful post
      const reflectionContext: IReflectionContext = {
        triggerType: trigger.type,
        outcome: 'contributed',
        summary: finalMessage.slice(0, 200),
        filesChanged: [],
      };
      const llmCaller = (_sysPrompt: string, userPrompt: string): Promise<string> =>
        callAIForContribution(persona, this.config, userPrompt).catch(() => '');
      void this.memoryService
        .reflect(persona, projectSlug, reflectionContext, llmCaller)
        .catch((err: unknown) => log.warn('memory reflect failed', { error: String(err) }));

      history = [
        ...history,
        {
          ts: `${Date.now()}-${persona.id}`,
          channel: discussion.channelId,
          text: finalMessage,
          username: persona.name,
        },
      ];
      historyText = formatThreadHistory(history) || historyText;
      await sleep(humanDelay());
    }
  }

  /**
   * Evaluate whether consensus has been reached.
   * Lead agent (Carlos) decides: approve, request changes, or escalate.
   * Uses an iterative loop for multi-round handling (no recursion).
   */
  private async evaluateConsensus(
    discussionId: string,
    trigger: IDiscussionTrigger,
  ): Promise<void> {
    const repos = getRepositories();

    // Re-check state each round; stop when consensus/blocked or discussion disappears.
    while (true) {
      const discussion = repos.slackDiscussion.getById(discussionId);
      if (!discussion || discussion.status !== 'active') return;

      // issue_review uses READY/CLOSE/DRAFT evaluation logic — handle separately
      if (trigger.type === 'issue_review') {
        await this.evaluateIssueReviewConsensus(discussionId, trigger);
        return;
      }

      const personas = repos.agentPersona.getActive();
      const carlos = findCarlos(personas);

      if (!carlos) {
        repos.slackDiscussion.updateStatus(discussionId, 'consensus', 'approved');
        return;
      }

      // Get thread history and let Carlos evaluate
      const history = await this.slackClient.getChannelHistory(
        discussion.channelId,
        discussion.threadTs,
        20,
      );
      const historyText = formatThreadHistory(history);
      const repliesUsed = countThreadReplies(history);
      const repliesLeft = Math.max(0, MAX_AGENT_THREAD_REPLIES - repliesUsed);
      if (repliesLeft <= 0) {
        repos.slackDiscussion.updateStatus(discussionId, 'blocked', 'human_needed');
        return;
      }

      const consensusPrompt = `You are ${carlos.name}, ${carlos.role}. You're wrapping up a team discussion.

Thread:
${historyText || '(No thread history available)'}

Round: ${discussion.round}/${MAX_ROUNDS}

Make the call. Are we done, do we need one more pass, or does a human need to weigh in?
- Keep it brief and decisive. No recap of the whole thread.
- If you approve, do not restate prior arguments.

Respond with EXACTLY one of these formats (include the prefix):
- APPROVE: [one short closing message in your voice — e.g., "Clean. Let's ship it."]
- CHANGES: [what specifically still needs work — be concrete, not vague]
- HUMAN: [why this needs a human decision — be specific about what's ambiguous]

Write the prefix and your message. Nothing else.`;

      let decision: string;
      try {
        decision = await callAIForContribution(carlos, this.config, consensusPrompt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn('AI consensus evaluation failed', { error: msg });
        decision = 'HUMAN: AI evaluation failed — needs manual review';
      }

      if (decision.startsWith('APPROVE')) {
        const message = humanizeSlackReply(
          decision.replace(/^APPROVE:\s*/, '').trim() || 'Clean. Ship it.',
          { allowEmoji: false, maxSentences: 1 },
        );
        if (!isSkipMessage(message)) {
          await this.slackClient.postAsAgent(
            discussion.channelId,
            message,
            carlos,
            discussion.threadTs,
          );
        }
        repos.slackDiscussion.updateStatus(discussionId, 'consensus', 'approved');
        log.info('consensus reached', { discussionId, result: 'approved', trigger: trigger.type });
        if (trigger.type === 'code_watch') {
          await this.triggerIssueOpener(discussionId, trigger).catch((e: unknown) =>
            log.warn('issue opener failed', { error: String(e) }),
          );
        }
        return;
      }

      if (decision.startsWith('CHANGES') && discussion.round < MAX_ROUNDS && repliesLeft >= 3) {
        const changes = decision.replace(/^CHANGES:\s*/, '').trim();
        const changesMessage = humanizeSlackReply(
          changes || 'Need one more pass on a couple items.',
          {
            allowEmoji: false,
            maxSentences: 1,
          },
        );
        if (!isSkipMessage(changesMessage)) {
          await this.slackClient.postAsAgent(
            discussion.channelId,
            changesMessage,
            carlos,
            discussion.threadTs,
          );
        }
        await sleep(humanDelay());

        // Increment round and start another contribution round, then loop back.
        const nextRound = discussion.round + 1;
        repos.slackDiscussion.updateRound(discussionId, nextRound);

        const participants = getParticipatingPersonas(trigger.type, personas);
        const devPersona = findDev(personas);
        const reviewers = participants.filter((p) => !devPersona || p.id !== devPersona.id);
        await this.runContributionRound(discussionId, reviewers, trigger, changes);
        continue;
      }

      if (decision.startsWith('CHANGES')) {
        const changesSummary = decision.replace(/^CHANGES:\s*/, '').trim();
        const summaryMessage = humanizeSlackReply(
          changesSummary
            ? `Need changes before merge: ${changesSummary}`
            : 'Need changes before merge. Please address the thread notes.',
          { allowEmoji: false, maxSentences: 2 },
        );
        if (!isSkipMessage(summaryMessage)) {
          await this.slackClient.postAsAgent(
            discussion.channelId,
            summaryMessage,
            carlos,
            discussion.threadTs,
          );
        }
        repos.slackDiscussion.updateStatus(discussionId, 'consensus', 'changes_requested');
        log.info('consensus reached', {
          discussionId,
          result: 'changes_requested',
          trigger: trigger.type,
        });

        if (discussion.triggerType === 'pr_review') {
          await this.triggerPRRefinement(discussionId, changesSummary, discussion.triggerRef).catch(
            (e) => log.warn('PR refinement trigger failed', { error: String(e) }),
          );
        }
        return;
      }

      // HUMAN or fallback
      const humanReason = decision.replace(/^HUMAN:\s*/, '').trim();
      const humanMessage = humanizeSlackReply(
        humanReason
          ? `Need a human decision: ${humanReason}`
          : 'Need a human decision on this one.',
        { allowEmoji: false, maxSentences: 1 },
      );
      if (!isSkipMessage(humanMessage)) {
        await this.slackClient.postAsAgent(
          discussion.channelId,
          humanMessage,
          carlos,
          discussion.threadTs,
        );
      }
      repos.slackDiscussion.updateStatus(discussionId, 'blocked', 'human_needed');
      log.info('consensus reached', {
        discussionId,
        result: 'human_needed',
        trigger: trigger.type,
      });
      return;
    }
  }

  /**
   * Trigger the Night Watch reviewer agent with Slack discussion feedback.
   * Sets NW_SLACK_FEEDBACK env var with the changes summary.
   */
  async triggerPRRefinement(
    discussionId: string,
    changesSummary: string,
    prNumber: string,
  ): Promise<void> {
    const repos = getRepositories();
    const discussion = repos.slackDiscussion.getById(discussionId);
    if (!discussion) return;

    const personas = repos.agentPersona.getActive();
    const carlos = findCarlos(personas) ?? personas[0];
    const actor = carlos?.name ?? 'Night Watch';
    if (carlos) {
      await this.slackClient.postAsAgent(
        discussion.channelId,
        `Sending PR #${prNumber} back through with the notes.`,
        carlos,
        discussion.threadTs,
      );
      await sleep(humanDelay());
    }

    // Set NW_SLACK_FEEDBACK and trigger reviewer
    const feedback = JSON.stringify({ discussionId, prNumber, changes: changesSummary });
    const invocationArgs = buildCurrentCliInvocation(['review']);
    if (!invocationArgs) {
      log.warn('PR refinement reviewer spawn failed — CLI path unavailable', {
        actor,
        pr: prNumber,
      });
      if (carlos) {
        await this.slackClient.postAsAgent(
          discussion.channelId,
          `Can't start the reviewer right now — runtime issue. Will retry.`,
          carlos,
          discussion.threadTs,
        );
      }
      return;
    }
    log.info('PR refinement reviewer spawned', {
      actor,
      pr: prNumber,
      cmd: formatCommandForLog(process.execPath, invocationArgs),
    });

    // Spawn the reviewer as a detached process
    const tsconfigPath = getNightWatchTsconfigPath();
    const { spawn } = await import('child_process');
    const reviewer = spawn(process.execPath, invocationArgs, {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        NW_SLACK_FEEDBACK: feedback,
        NW_TARGET_PR: prNumber,
        ...(tsconfigPath ? { TSX_TSCONFIG_PATH: tsconfigPath } : {}),
      },
    });
    reviewer.unref();
  }

  /**
   * Reply as a persona in any Slack thread — no formal discussion required.
   * Used when someone @mentions a persona outside of a Night Watch discussion.
   */
  async replyAsAgent(
    channel: string,
    threadTs: string,
    incomingText: string,
    persona: IAgentPersona,
    projectContext?: string,
  ): Promise<string> {
    let history: ISlackMessage[] = [];
    try {
      history = await this.slackClient.getChannelHistory(channel, threadTs, 10);
    } catch {
      // Ignore — reply with just the incoming text as context
    }

    const historyText = formatThreadHistory(history);
    const historySet = new Set(history.map((m) => normalizeText(m.text)).filter(Boolean));

    // Detect if this is a casual/social message or a technical one
    const isCasual =
      /\b(hey|hi|hello|yo|sup|happy|morning|afternoon|evening|friday|weekend|alive|there|guys|team|everyone|folks)\b/i.test(
        incomingText,
      ) &&
      !/\b(bug|error|crash|fail|test|pr|code|build|deploy|security|auth|token|vuln|diff|commit|review|issue|impl)\b/i.test(
        incomingText,
      );

    const casualGuidance = isCasual
      ? `This is a casual social message — respond like a real colleague, not a bot. Be warm, brief, maybe crack a light comment about work or the day. Don't force a work topic. It's fine to just say hey back, ask how things are going, or make a quick joke. 1-2 sentences.\n`
      : `If the message is technical:\n- Base opinions on concrete evidence from context (file path, symbol, diff, or log detail).\n- If there's no concrete evidence and the question is technical, ask for the file/diff before opining.\n`;

    const urlGuidance = projectContext?.includes('Referenced links:')
      ? `There are linked URLs in the context above — you have seen their title and summary. Reference what the link is actually about if relevant; don't pretend you haven't seen it.\n`
      : '';

    const projectPathForTools = this.resolveReplyProjectPath(channel, threadTs);
    const boardConfig = projectPathForTools ? this.resolveBoardConfig(projectPathForTools) : null;
    const resolved = resolvePersonaAIConfig(persona, this.config);
    const useTools = Boolean(projectPathForTools && resolved.provider === 'anthropic');

    // For tools: strict project resolution (wrong project = wrong codebase queries)
    // For memory: best-effort — fall back to the channel's configured project or first registered
    const replyProjectSlug: string | undefined = (() => {
      if (projectPathForTools) return basename(projectPathForTools);
      const repos = getRepositories();
      const projects = repos.projectRegistry.getAll();
      const slack = this.config.slack;
      // Try to match channel against slack.channels config values
      if (slack?.channels) {
        const channelEntry = Object.entries(slack.channels).find(([, v]) => v === channel);
        if (channelEntry) {
          // Pick the first project that has a matching slackChannelId or fall back to first project
          const match = projects.find((p) => p.slackChannelId === channel) ?? projects[0];
          return match ? basename(match.path) : undefined;
        }
      }
      return projects[0] ? basename(projects[0].path) : undefined;
    })();
    log.info('ad-hoc reply memory probe', {
      agent: persona.name,
      channel,
      projectPath: projectPathForTools,
      projectSlug: replyProjectSlug ?? '(none)',
    });

    // Fetch persona memory to inject into system prompt (optional — ignore errors)
    let replyMemory: string | undefined;
    if (replyProjectSlug) {
      try {
        replyMemory = await this.memoryService.getMemory(persona.name, replyProjectSlug);
        if (replyMemory) {
          log.info('memory injected for ad-hoc reply', {
            agent: persona.name,
            project: replyProjectSlug,
            chars: replyMemory.length,
          });
        }
      } catch {
        // Memory is optional — never block a reply due to a read failure
      }
    }

    const codebaseGuidance = useTools
      ? `- You have a query_codebase tool. Before pointing at any file or making a code claim, call it and read the actual output. Then drop the specific line or snippet directly into your message — like a teammate who pulled it up in their editor, not a bot filing a report. Short inline backtick or a 2-3 line block is fine.\n`
      : `- If you make a specific code claim, back it up with a snippet from context. If you don't have it, ask for it.\n`;

    const prompt =
      `You are ${persona.name}, ${persona.role}.\n` +
      `Your teammates: Dev (implementer), Carlos (tech lead), Maya (security), Priya (QA).\n\n` +
      (projectContext ? `Project context:\n${projectContext}\n\n` : '') +
      (historyText ? `Thread so far:\n${historyText}\n\n` : '') +
      `Latest message: "${incomingText}"\n\n` +
      `Respond in your own voice. This is Slack — keep it conversational, 1-3 sentences max.\n` +
      `- Talk like a colleague who actually gives a damn, not a bot. No "Great question", "Of course", or "I hope this helps".\n` +
      `- Engage with the thread — if teammates said something you agree or disagree with, react to it directly.\n` +
      `- Tag a teammate by name naturally if their domain is more relevant ("Carlos would know better", "Maya, thoughts?").\n` +
      casualGuidance +
      urlGuidance +
      codebaseGuidance +
      `- No markdown headings or bullet lists. Inline backticks and short code blocks are fine when quoting actual code.\n` +
      `- Emojis: one max, only if it fits. Default to none.\n` +
      `- If the question is outside your domain, say so briefly and redirect.\n` +
      `- You have board tools available. If asked to open, update, or list issues, use them — don't just say you will.\n` +
      `- Only reference PR numbers, issue numbers, or URLs that appear in the context above. Never invent or guess links.\n\n` +
      `Write only your reply. No name prefix.`;

    const tools = [
      ...(useTools ? [buildCodebaseQueryTool()] : []),
      ...(boardConfig ? buildBoardTools() : []),
    ];

    let message: string;
    try {
      if (useTools && tools.length > 0) {
        const registry: ToolRegistry = new Map();
        if (useTools) {
          const codebaseProvider = (this.config.providerEnv?.['CODEBASE_QUERY_PROVIDER'] ??
            'claude') as 'claude' | 'codex';
          registry.set('query_codebase', (input) =>
            Promise.resolve(
              executeCodebaseQuery(
                String(input['prompt'] ?? ''),
                projectPathForTools!,
                codebaseProvider,
                this.config.providerEnv,
              ),
            ),
          );
        }
        if (boardConfig) {
          for (const tool of buildBoardTools()) {
            registry.set(tool.name, (input) =>
              executeBoardTool(tool.name, input, boardConfig, projectPathForTools!),
            );
          }
        }
        message = await callAIWithTools(persona, this.config, prompt, tools, registry);
      } else {
        // Allow up to 1024 tokens for ad-hoc replies so agents can write substantive responses
        message = await callAIForContribution(persona, this.config, prompt, 1024, replyMemory);
      }
    } catch (err) {
      log.error('ad-hoc reply failed', { agent: persona.name, error: String(err) });
      message = `[Reply from ${persona.name} unavailable — AI provider not configured]`;
    }

    if (message) {
      const finalMessage = this.humanizeForPost(channel, threadTs, persona, message);
      if (isSkipMessage(finalMessage)) return '';
      const normalized = normalizeText(finalMessage);
      if (!normalized || historySet.has(normalized)) return '';
      await this.slackClient.postAsAgent(channel, finalMessage, persona, threadTs);

      // Fire-and-forget reflection after ad-hoc reply
      if (replyProjectSlug) {
        const llmCaller = (_sysPrompt: string, userPrompt: string): Promise<string> =>
          callAIForContribution(persona, this.config, userPrompt).catch(() => '');
        const reflectionContext: IReflectionContext = {
          triggerType: 'slack_message',
          outcome: 'replied',
          summary: `Ad-hoc Slack reply in channel ${channel}: "${incomingText.slice(0, 200)}"`,
        };
        log.info('triggering memory reflect for ad-hoc reply', {
          agent: persona.name,
          project: replyProjectSlug,
        });
        void this.memoryService
          .reflect(persona, replyProjectSlug, reflectionContext, llmCaller)
          .catch((err: unknown) =>
            log.warn('ad-hoc memory reflect failed', { error: String(err) }),
          );
      }

      return finalMessage;
    }
    return '';
  }

  /**
   * Generate and post a proactive message from a persona.
   * Used by the interaction listener when a channel has been idle.
   * The persona shares an observation, question, or suggestion based on
   * project context and roadmap state — in their own voice.
   */
  async postProactiveMessage(
    channel: string,
    persona: IAgentPersona,
    projectContext: string,
    roadmapContext: string,
    projectSlug?: string,
  ): Promise<void> {
    const prompt =
      `You are ${persona.name}, ${persona.role}.\n` +
      `Your teammates: Dev (implementer), Carlos (tech lead), Maya (security), Priya (QA).\n\n` +
      `You're posting an unprompted message in the team's Slack channel. ` +
      `The channel has been quiet — you want to share something useful, not just fill silence.\n\n` +
      (projectContext ? `Project context: ${projectContext}\n\n` : '') +
      (roadmapContext ? `Roadmap/PRD status:\n${roadmapContext}\n\n` : '') +
      `Write a SHORT proactive message (1-2 sentences) that does ONE of these:\n` +
      `- Question a roadmap priority or ask if something should be reordered\n` +
      `- Flag something you've been thinking about from your domain (security concern, test gap, architectural question, implementation idea)\n` +
      `- Suggest an improvement or raise a "have we thought about..." question\n` +
      `- Share a concrete observation about the current state of the project\n` +
      `- Offer to kick off a task: "I can run a review on X if nobody's on it"\n\n` +
      `Rules:\n` +
      `- Stay in your lane. Only bring up things relevant to your expertise.\n` +
      `- Be specific — name the feature, file, or concern. No vague "we should think about things."\n` +
      `- Sound like a teammate dropping a thought in chat, not making an announcement.\n` +
      `- No markdown, headings, bullets. Just a message.\n` +
      `- No "Great question", "Just checking in", or "Hope everyone is doing well."\n` +
      `- Emojis: one max, only if natural. Default to none.\n` +
      `- Do not make up specific PR numbers, issue numbers, or URLs. If you don't have a concrete reference from context, speak in general terms.\n` +
      `- If you genuinely have nothing useful to say, write exactly: SKIP\n\n` +
      `Write only your message. No name prefix.`;

    let message: string;
    try {
      message = await callAIForContribution(persona, this.config, prompt);
    } catch {
      return; // Silently skip — proactive messages are optional
    }

    if (!message || message.trim().toUpperCase() === 'SKIP') {
      return;
    }

    const dummyTs = `${Date.now()}`;
    const finalMessage = this.humanizeForPost(channel, dummyTs, persona, message);
    if (finalMessage) {
      await this.slackClient.postAsAgent(channel, finalMessage, persona);
      log.info('proactive message posted', { agent: persona.name, channel, project: projectSlug });
      if (projectSlug) {
        const reflectionContext: IReflectionContext = {
          triggerType: 'code_watch',
          outcome: 'proactive_observation',
          summary: finalMessage.slice(0, 200),
          filesChanged: [],
        };
        const llmCaller = (_sysPrompt: string, userPrompt: string): Promise<string> =>
          callAIForContribution(persona, this.config, userPrompt).catch(() => '');
        void this.memoryService
          .reflect(persona, projectSlug, reflectionContext, llmCaller)
          .catch((err: unknown) =>
            log.warn('proactive memory reflect failed', { error: String(err) }),
          );
      }
    }
  }

  /**
   * Generate a structured GitHub issue body written by the Dev persona.
   */
  private async generateIssueBody(
    trigger: IDiscussionTrigger,
    devPersona: IAgentPersona,
  ): Promise<string> {
    const prompt = `You are ${devPersona.name}, ${devPersona.role}.
Use the PRD rigor from ~/.claude/skills/prd-creator/SKILL.md:
- explicit implementation plan
- testable phases
- concrete verification steps
- no vague filler

Write a concise GitHub issue body for this code scan finding.
Use this structure exactly (GitHub Markdown):

## Context
- Problem: one sentence
- Current behavior: one sentence
- Risk if ignored: one sentence

## Proposed Fix
- Primary approach
- Files likely touched (max 5, include paths when possible)

## Execution Plan
### Phase 1: [name]
- [ ] Implementation step
- [ ] Tests to add/update

### Phase 2: [name]
- [ ] Implementation step
- [ ] Tests to add/update

## Verification
- [ ] Automated: specific tests or commands to run
- [ ] Manual: one concrete validation step

## Done Criteria
- [ ] Bug condition is no longer reproducible
- [ ] Regression coverage is added
- [ ] Error handling/logging is clear and non-silent

Keep it under ~450 words. No fluff, no greetings, no generic "future work" sections.

Context:
${trigger.context}`;

    const raw = await callAIForContribution(devPersona, this.config, prompt);
    return raw.trim();
  }

  /**
   * Have Dev read the actual code and decide whether a scanner finding is worth raising.
   * Returns Dev's Slack-ready observation, or null if Dev thinks it's not worth posting.
   */
  async analyzeCodeCandidate(
    fileContext: string,
    signalSummary: string,
    location: string,
  ): Promise<string | null> {
    const repos = getRepositories();
    const personas = repos.agentPersona.getActive();
    const devPersona = findDev(personas);
    if (!devPersona) return null;

    const prompt =
      `You are ${devPersona.name}, ${devPersona.role}.\n` +
      `Your scanner flagged something. Before you bring it up with the team, read the actual code and decide if it's genuinely worth raising.\n\n` +
      `Signal: ${signalSummary}\n` +
      `Location: ${location}\n\n` +
      `Code:\n\`\`\`\n${fileContext.slice(0, 3000)}\n\`\`\`\n\n` +
      `Is this a real concern? Give your honest take in 1-2 sentences as a Slack message to the team.\n\n` +
      `Rules:\n` +
      `- If it's clearly fine (intentional, test code, well-handled, noise) → respond with exactly: SKIP\n` +
      `- If it's worth flagging, write what you'd drop in Slack in your own voice. Name the specific risk.\n` +
      `- Sound like a teammate noticing something, not a scanner filing a report.\n` +
      `- No markdown, no bullet points. No "I noticed" or "The code has".\n` +
      `- Never start with "Great question", "Of course", or similar.\n\n` +
      `Write only your message or SKIP.`;

    try {
      const result = await callAIForContribution(devPersona, this.config, prompt);
      if (!result || result.trim().toUpperCase() === 'SKIP') return null;
      return humanizeSlackReply(result, { allowEmoji: false, maxSentences: 2 });
    } catch {
      return null;
    }
  }

  /**
   * Triage an audit report, file a GitHub issue if warranted, and post a short Slack ping.
   * No discussion thread — Dev just drops a link in the channel and moves on.
   */
  async handleAuditReport(
    report: string,
    projectName: string,
    projectPath: string,
    channel: string,
  ): Promise<void> {
    if (!report || report.trim() === 'NO_ISSUES_FOUND') return;

    const repos = getRepositories();
    const personas = repos.agentPersona.getActive();
    const devPersona = findDev(personas);
    if (!devPersona) return;

    // Step 1: Dev triages the report — worth filing? If yes, give a one-liner for Slack.
    const triagePrompt =
      `You are ${devPersona.name}, ${devPersona.role}.\n` +
      `The code auditor just finished scanning ${projectName} and wrote this report:\n\n` +
      `${report.slice(0, 3000)}\n\n` +
      `Should this be filed as a GitHub issue for the team to track?\n\n` +
      `Rules:\n` +
      `- If the findings are genuinely worth tracking (medium or high severity, real risk) → reply with:\n` +
      `  FILE: [one short sentence you'd drop in Slack — specific about what was found, no filler]\n` +
      `- If everything is minor, intentional, or noise → reply with exactly: SKIP\n` +
      `- Be honest. Don't file issues for trivial noise.\n\n` +
      `Write only FILE: [sentence] or SKIP.`;

    let triage: string;
    try {
      triage = await callAIForContribution(devPersona, this.config, triagePrompt, 256);
    } catch {
      return;
    }

    if (!triage || triage.trim().toUpperCase() === 'SKIP' || !/^FILE:/i.test(triage.trim())) {
      log.info('audit: dev skipped filing', { project: projectName });
      return;
    }

    const slackOneliner = triage.replace(/^FILE:\s*/i, '').trim();
    if (!slackOneliner) return;

    // Step 2: Generate a proper GitHub issue body via Dev
    const fakeTrigger: IDiscussionTrigger = {
      type: 'code_watch',
      projectPath,
      ref: `audit-${Date.now()}`,
      context: `Project: ${projectName}\n\nAudit report:\n${report.slice(0, 2000)}`,
    };
    const issueTitle = `fix: ${slackOneliner
      .toLowerCase()
      .replace(/[.!?]+$/, '')
      .replace(/^(found|noticed|flagging|caught)\s+/i, '')
      .slice(0, 80)}`;
    const issueBody = await this.generateIssueBody(fakeTrigger, devPersona).catch(() =>
      report.slice(0, 1200),
    );

    // Step 3: Create GitHub issue (if board is configured for this project)
    const boardConfig = this.resolveBoardConfig(projectPath);
    let issueUrl: string | null = null;
    if (boardConfig) {
      try {
        const provider = createBoardProvider(boardConfig, projectPath);
        const issue = await provider.createIssue({
          title: issueTitle,
          body: issueBody,
          column: 'Ready',
        });
        issueUrl = issue.url;
        log.info('audit: filed issue', {
          project: projectName,
          issue: issue.number,
          url: issueUrl,
        });
      } catch (err) {
        log.warn('audit: failed to create GitHub issue', { error: String(err) });
      }
    }

    // Step 4: Post brief Slack notification — just a link drop, no thread
    const slackMsg = issueUrl
      ? `${slackOneliner} → ${issueUrl}`
      : humanizeSlackReply(slackOneliner, { allowEmoji: false, maxSentences: 2 });

    try {
      await this.slackClient.postAsAgent(channel, slackMsg, devPersona);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('audit: failed to post Slack notification', { error: msg });
    }
  }

  /**
   * Evaluate issue_review discussions using READY/CLOSE/DRAFT verdict logic.
   * The lead persona (tech lead role) makes the triage call; no multi-round loop.
   */
  private async evaluateIssueReviewConsensus(
    discussionId: string,
    trigger: IDiscussionTrigger,
  ): Promise<void> {
    const repos = getRepositories();
    const discussion = repos.slackDiscussion.getById(discussionId);
    if (!discussion || discussion.status !== 'active') return;

    const personas = repos.agentPersona.getActive();
    const lead = findCarlos(personas);

    if (!lead) {
      repos.slackDiscussion.updateStatus(discussionId, 'consensus', 'approved');
      return;
    }

    const history = await this.slackClient.getChannelHistory(
      discussion.channelId,
      discussion.threadTs,
      20,
    );
    const historyText = formatThreadHistory(history);

    const consensusPrompt = `You are ${lead.name}, ${lead.role}. You're wrapping up a team issue review.

Thread:
${historyText || '(No thread history available)'}

Based on the discussion above, make the triage call for this issue.

Respond with EXACTLY one of these formats (include the prefix):
- READY: [why — move to Ready column, issue is valid and prioritized]
- CLOSE: [why — invalid, duplicate, or won't fix]
- DRAFT: [why — valid but needs more context or lower priority]

Be concise and decisive. No recap of the whole thread. Write the prefix and your message. Nothing else.`;

    let decision: string;
    try {
      decision = await callAIForContribution(lead, this.config, consensusPrompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('issue-review: consensus evaluation failed', { error: msg });
      decision = 'DRAFT: AI evaluation failed — leaving in Draft for manual review';
    }

    if (decision.startsWith('READY')) {
      const message = humanizeSlackReply(
        decision.replace(/^READY:\s*/, '').trim() || 'Looks good — moving to Ready.',
        { allowEmoji: false, maxSentences: 1 },
      );
      if (!isSkipMessage(message)) {
        await this.slackClient.postAsAgent(
          discussion.channelId,
          message,
          lead,
          discussion.threadTs,
        );
      }
      repos.slackDiscussion.updateStatus(discussionId, 'consensus', 'approved');
      await this.triggerIssueStatusUpdate('ready', discussionId, trigger).catch((e: unknown) =>
        log.warn('issue-review: status update failed', { error: String(e) }),
      );
      return;
    }

    if (decision.startsWith('CLOSE')) {
      const message = humanizeSlackReply(
        decision.replace(/^CLOSE:\s*/, '').trim() || 'Closing this — not worth tracking.',
        { allowEmoji: false, maxSentences: 1 },
      );
      if (!isSkipMessage(message)) {
        await this.slackClient.postAsAgent(
          discussion.channelId,
          message,
          lead,
          discussion.threadTs,
        );
      }
      repos.slackDiscussion.updateStatus(discussionId, 'consensus', 'approved');
      await this.triggerIssueStatusUpdate('close', discussionId, trigger).catch((e: unknown) =>
        log.warn('issue-review: status update failed', { error: String(e) }),
      );
      return;
    }

    // DRAFT or fallback
    const message = humanizeSlackReply(
      decision.replace(/^DRAFT:\s*/, '').trim() || 'Leaving in Draft — needs more context.',
      { allowEmoji: false, maxSentences: 1 },
    );
    if (!isSkipMessage(message)) {
      await this.slackClient.postAsAgent(discussion.channelId, message, lead, discussion.threadTs);
    }
    repos.slackDiscussion.updateStatus(discussionId, 'consensus', 'approved');
  }

  /**
   * Execute the board/GitHub action for an issue_review verdict.
   * - ready: moves the issue to the Ready column on the board
   * - close: closes the issue via `gh issue close`
   */
  private async triggerIssueStatusUpdate(
    verdict: 'ready' | 'close',
    discussionId: string,
    trigger: IDiscussionTrigger,
  ): Promise<void> {
    const repos = getRepositories();
    const discussion = repos.slackDiscussion.getById(discussionId);
    if (!discussion) return;

    const personas = repos.agentPersona.getActive();
    const executor = findDev(personas) ?? findCarlos(personas) ?? personas[0];
    if (!executor) return;

    // Expect trigger.ref in the form "{owner}/{repo}#{number}"
    const refMatch = trigger.ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
    if (!refMatch) {
      log.warn('issue-review: unexpected trigger.ref format', { ref: trigger.ref });
      return;
    }
    const [, owner, repo, issueNumber] = refMatch;
    const repoArg = `${owner}/${repo}`;

    if (verdict === 'ready') {
      const boardConfig = this.resolveBoardConfig(trigger.projectPath);
      if (boardConfig) {
        try {
          const provider = createBoardProvider(boardConfig, trigger.projectPath);
          await provider.moveIssue(Number(issueNumber), 'Ready');
          await this.slackClient.postAsAgent(
            discussion.channelId,
            `Moved #${issueNumber} to Ready.`,
            executor,
            discussion.threadTs,
          );
          return;
        } catch (err) {
          log.warn('issue-review: board moveIssue failed, trying CLI fallback', {
            error: String(err),
          });
        }
      }
      // CLI fallback
      const boardArgs = buildCurrentCliInvocation([
        'board',
        'move-issue',
        issueNumber,
        '--column',
        'Ready',
      ]);
      if (boardArgs) {
        try {
          execFileSync(process.execPath, boardArgs, {
            cwd: trigger.projectPath,
            timeout: 15_000,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          await this.slackClient.postAsAgent(
            discussion.channelId,
            `Moved #${issueNumber} to Ready.`,
            executor,
            discussion.threadTs,
          );
        } catch {
          log.warn('issue-review: CLI board fallback also failed');
        }
      }
    } else if (verdict === 'close') {
      try {
        execFileSync('gh', ['issue', 'close', issueNumber, '-R', repoArg], {
          cwd: trigger.projectPath,
          timeout: 15_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        await this.slackClient.postAsAgent(
          discussion.channelId,
          `Closed #${issueNumber}.`,
          executor,
          discussion.threadTs,
        );
      } catch (err) {
        log.warn('issue-review: gh issue close failed', { error: String(err) });
      }
    }
  }

  /**
   * Open a GitHub issue from a code_watch finding and post back to the thread.
   * Called automatically after an approved code_watch consensus.
   */
  async triggerIssueOpener(discussionId: string, trigger: IDiscussionTrigger): Promise<void> {
    const repos = getRepositories();
    const discussion = repos.slackDiscussion.getById(discussionId);
    if (!discussion) return;

    const devPersona = findDev(repos.agentPersona.getActive());
    if (!devPersona) return;

    // Acknowledge before doing async work
    await this.slackClient.postAsAgent(
      discussion.channelId,
      'Agreed. Writing up an issue for this.',
      devPersona,
      discussion.threadTs,
    );

    const title = buildIssueTitleFromTrigger(trigger);
    const body = await this.generateIssueBody(trigger, devPersona);

    const boardConfig = this.resolveBoardConfig(trigger.projectPath);
    if (boardConfig) {
      try {
        const provider = createBoardProvider(boardConfig, trigger.projectPath);
        const issue = await provider.createIssue({ title, body, column: 'In Progress' });
        if (issue.column !== 'In Progress') {
          await provider.moveIssue(issue.number, 'In Progress').catch(() => undefined);
        }
        await this.slackClient.postAsAgent(
          discussion.channelId,
          `Opened #${issue.number}: ${issue.title} — ${issue.url}\nTaking first pass now. It's in In Progress.`,
          devPersona,
          discussion.threadTs,
        );
      } catch (err) {
        log.warn('issue opener: board createIssue failed', { error: String(err) });
        await this.slackClient.postAsAgent(
          discussion.channelId,
          `Couldn't open the issue automatically — board might not be configured. Here's the writeup:\n\n${body.slice(0, 600)}`,
          devPersona,
          discussion.threadTs,
        );
      }
    } else {
      // No board configured — post the writeup in thread so it's not lost
      await this.slackClient.postAsAgent(
        discussion.channelId,
        `No board configured, dropping the writeup here:\n\n${body.slice(0, 600)}`,
        devPersona,
        discussion.threadTs,
      );
    }
  }
}

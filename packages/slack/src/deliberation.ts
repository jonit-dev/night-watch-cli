/**
 * Deliberation Engine for Night Watch.
 * Orchestrates multi-agent Slack discussions when trigger events occur.
 * Agents discuss in threads, reach consensus, and drive PR actions.
 */

import {
  IAgentPersona,
  IDiscussionTrigger,
  INightWatchConfig,
  IReflectionContext,
  ISlackDiscussion,
  MemoryService,
  createLogger,
  getRepositories,
} from '@night-watch/core';

const log = createLogger('deliberation');
import { type ISlackMessage, SlackClient } from './client.js';
import { basename } from 'node:path';
import { BoardIntegration } from './board-integration.js';
import { ConsensusEvaluator } from './consensus-evaluator.js';
import type { IConsensusCallbacks } from './consensus-evaluator.js';
import {
  buildCurrentCliInvocation,
  buildSubprocessEnv,
  formatCommandForLog,
  getNightWatchTsconfigPath,
  normalizeText,
  sleep,
} from './utils.js';
import { humanizeSlackReply, isSkipMessage } from './humanizer.js';
import { findCarlos, findDev, getParticipatingPersonas } from './personas.js';
import {
  buildContributionPrompt,
  buildOpeningMessage,
  chooseRoundContributors,
  countThreadReplies,
  discussionStartKey,
  formatThreadHistory,
  getChannelForProject,
  hasConcreteCodeContext,
  humanDelay,
  loadPrDiffExcerpt,
  pickMaxSentences,
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
const DISCUSSION_RESUME_DELAY_MS = 60_000;
const DISCUSSION_REPLAY_GUARD_MS = 30 * 60_000;

const inFlightDiscussionStarts = new Map<string, Promise<ISlackDiscussion>>();

export class DeliberationEngine {
  private readonly slackClient: SlackClient;
  private readonly config: INightWatchConfig;
  private readonly memoryService: MemoryService;
  private readonly board: BoardIntegration;
  private readonly consensus: ConsensusEvaluator;
  private readonly humanResumeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly emojiCadenceCounter = new Map<string, number>();

  constructor(slackClient: SlackClient, config: INightWatchConfig) {
    this.slackClient = slackClient;
    this.config = config;
    this.memoryService = new MemoryService();
    this.board = new BoardIntegration(slackClient, config);
    this.consensus = new ConsensusEvaluator(slackClient, config, this.board);
  }

  private resolveReplyProjectPath(channel: string, threadTs: string): string | null {
    const repos = getRepositories();
    const discussion = repos.slackDiscussion
      .getActive('')
      .find((d) => d.channelId === channel && d.threadTs === threadTs);
    if (discussion?.projectPath) return discussion.projectPath;
    const projects = repos.projectRegistry.getAll();
    const channelProject = projects.find((p) => p.slackChannelId === channel);
    if (channelProject?.path) return channelProject.path;
    return projects.length === 1 ? projects[0].path : null;
  }

  private resolveReplyProjectSlug(
    channel: string,
    projectPathForTools: string | null,
  ): string | undefined {
    if (projectPathForTools) return basename(projectPathForTools);
    const repos = getRepositories();
    const projects = repos.projectRegistry.getAll();
    const match = projects.find((p) => p.slackChannelId === channel) ?? projects[0];
    return match ? basename(match.path) : undefined;
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
    // emoji every ~3rd message; non-facial every ~9th
    return humanizeSlackReply(raw, {
      allowEmoji: count % 3 === 0,
      allowNonFacialEmoji: count % 9 === 0,
      maxSentences: pickMaxSentences(),
      maxChars: 280 + Math.floor(Math.random() * 160), // 280-440
    });
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
    if (
      latest &&
      (latest.status === 'active' || Date.now() - latest.updatedAt < DISCUSSION_REPLAY_GUARD_MS)
    ) {
      return latest;
    }

    const personas = repos.agentPersona.getActive();
    const participants = getParticipatingPersonas(trigger.type, personas);

    const resolvedTrigger = { ...trigger };
    if (resolvedTrigger.type === 'pr_review' && !hasConcreteCodeContext(resolvedTrigger.context)) {
      const diffExcerpt = loadPrDiffExcerpt(resolvedTrigger.projectPath, resolvedTrigger.ref);
      if (diffExcerpt) {
        resolvedTrigger.context = `${resolvedTrigger.context}\n\n${diffExcerpt}`.slice(0, 5000);
      }
    }
    const channel = getChannelForProject(resolvedTrigger.projectPath, resolvedTrigger.channelId);

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
    await this.consensus.evaluateConsensus(
      discussion.id,
      resolvedTrigger,
      this.makeConsensusCallbacks(),
    );

    return repos.slackDiscussion.getById(discussion.id)!;
  }

  /**
   * Have a specific agent contribute to an existing discussion.
   */
  async contributeAsAgent(discussionId: string, persona: IAgentPersona): Promise<void> {
    const repos = getRepositories();
    const discussion = repos.slackDiscussion.getById(discussionId);
    if (!discussion || discussion.status !== 'active') return;

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
        await this.consensus.evaluateConsensus(
          discussion.id,
          {
            type: discussion.triggerType,
            projectPath: discussion.projectPath,
            ref: discussion.triggerRef,
            context: '',
          },
          this.makeConsensusCallbacks(),
        );
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
        /* optional */
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

  private makeConsensusCallbacks(): IConsensusCallbacks {
    return {
      runContributionRound: (discussionId, personas, trigger, context) =>
        this.runContributionRound(discussionId, personas, trigger, context),
      triggerPRRefinement: (discussionId, changesSummary, prNumber) =>
        this.triggerPRRefinement(discussionId, changesSummary, prNumber),
    };
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
      env: buildSubprocessEnv({
        NW_SLACK_FEEDBACK: feedback,
        NW_TARGET_PR: prNumber,
        ...(tsconfigPath ? { TSX_TSCONFIG_PATH: tsconfigPath } : {}),
      }),
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
    const boardConfig = projectPathForTools
      ? this.board.resolveBoardConfig(projectPathForTools)
      : null;
    const resolved = resolvePersonaAIConfig(persona, this.config);
    const useTools = Boolean(projectPathForTools && resolved.provider === 'anthropic');

    // For memory: best-effort — fall back to the channel's configured project or first registered
    const replyProjectSlug = this.resolveReplyProjectSlug(channel, projectPathForTools);
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
        if (replyMemory)
          log.info('memory injected for ad-hoc reply', {
            agent: persona.name,
            project: replyProjectSlug,
            chars: replyMemory.length,
          });
      } catch {
        /* optional */
      }
    }

    const codebaseGuidance = useTools
      ? `- You have a query_codebase tool. Before making any code claim, call it first. Then cite what you found using GitHub permalink format: \`path/to/file.ts#L42-L45\` with an inline snippet. Like a teammate who pulled it up in their editor.\n`
      : `- When referencing code, always include the file path: \`path/to/file.ts#L42-L45\`. No vague "in the auth module" — name the file.\n`;

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
   * After posting, 1-2 other personas reply in the thread to spark discussion.
   */
  async postProactiveMessage(
    channel: string,
    persona: IAgentPersona,
    projectContext: string,
    roadmapContext: string,
    projectSlug?: string,
  ): Promise<void> {
    // Fetch memory BEFORE generating so the agent knows what it already raised and won't repeat it.
    let memory: string | undefined;
    if (projectSlug) {
      try {
        memory = await this.memoryService.getMemory(persona.name, projectSlug);
      } catch {
        /* optional */
      }
    }

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
      `- If you don't have an exact PR/issue number, describe the pattern or location instead. "The retry logic in the queue worker has no backoff" is better than "we should think about resilience."\n` +
      `- When you reference code, use path format: \`path/to/file.ts#L42-L45\`.\n` +
      `- Your memory (in your system prompt) records what you've previously raised. Do NOT repeat a topic you already flagged — pick something fresh and different.\n` +
      `- If you genuinely have nothing useful to say, write exactly: SKIP\n\n` +
      `Write only your message. No name prefix.`;

    let message: string;
    try {
      message = await callAIForContribution(persona, this.config, prompt, undefined, memory);
    } catch {
      return; // Silently skip — proactive messages are optional
    }

    if (!message || message.trim().toUpperCase() === 'SKIP') {
      return;
    }

    const dummyTs = `${Date.now()}`;
    const finalMessage = this.humanizeForPost(channel, dummyTs, persona, message);
    if (finalMessage) {
      const posted = await this.slackClient.postAsAgent(channel, finalMessage, persona);
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

      // Trigger 1-2 other agents to reply in the thread — simulates natural team discussion.
      void this.triggerProactiveThreadReplies(
        channel,
        posted.ts,
        finalMessage,
        persona,
        projectContext,
      ).catch((err: unknown) =>
        log.warn('proactive thread replies failed', { error: String(err) }),
      );
    }
  }

  /**
   * After a proactive message is posted, have 1-2 other personas reply in the thread.
   * Simulates organic team engagement — someone always reacts to a teammate's observation.
   */
  private async triggerProactiveThreadReplies(
    channel: string,
    threadTs: string,
    proactiveMessage: string,
    originPersona: IAgentPersona,
    projectContext: string,
  ): Promise<void> {
    const repos = getRepositories();
    const personas = repos.agentPersona.getActive();
    const others = personas.filter((p) => p.id !== originPersona.id);
    if (others.length === 0) return;

    const shuffled = [...others].sort(() => Math.random() - 0.5);
    const responders = shuffled.slice(0, Math.min(shuffled.length, Math.random() < 0.45 ? 1 : 2));

    for (const responder of responders) {
      await sleep(humanDelay());
      const reply = await this.replyAsAgent(
        channel,
        threadTs,
        proactiveMessage,
        responder,
        projectContext,
      );
      log.info('proactive thread reply posted', { agent: responder.name, channel });
      // If the reply mentions another agent, let followAgentMentions handle it externally
      // (not wired here to avoid cascading loops in proactive context)
      if (!reply) break; // If agent had nothing to add, stop — no point forcing more
    }
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
    return this.board.analyzeCodeCandidate(fileContext, signalSummary, location);
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
    return this.board.handleAuditReport(report, projectName, projectPath, channel);
  }

  /**
   * Open a GitHub issue from a code_watch finding and post back to the thread.
   * Called automatically after an approved code_watch consensus.
   */
  async triggerIssueOpener(discussionId: string, trigger: IDiscussionTrigger): Promise<void> {
    return this.board.triggerIssueOpener(discussionId, trigger);
  }
}

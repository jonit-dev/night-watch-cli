/**
 * Deliberation Engine for Night Watch.
 * Orchestrates multi-agent Slack discussions when trigger events occur.
 * Agents discuss in threads, reach consensus, and drive PR actions.
 */

import { IAgentPersona, IDiscussionTrigger, ISlackDiscussion } from "../../shared/types.js";
import { SlackClient } from "./client.js";
import { compileSoul } from "../agents/soul-compiler.js";
import { getRepositories } from "../storage/repositories/index.js";
import { INightWatchConfig } from "../types.js";

const MAX_ROUNDS = 3;
const MESSAGE_DELAY_MS = 1500; // Rate limit: 1.5s between posts
const DISCUSSION_RESUME_DELAY_MS = 60_000;
const DISCUSSION_REPLAY_GUARD_MS = 30 * 60_000;
const MAX_HUMANIZED_SENTENCES = 2;

interface IHumanizeSlackReplyOptions {
  allowEmoji?: boolean;
  allowNonFacialEmoji?: boolean;
  maxSentences?: number;
}

const inFlightDiscussionStarts = new Map<string, Promise<ISlackDiscussion>>();

function discussionStartKey(trigger: IDiscussionTrigger): string {
  return `${trigger.projectPath}:${trigger.type}:${trigger.ref}`;
}

/**
 * Wait for the specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    default:
      return slack.channels.eng;
  }
}

/**
 * Find a persona by explicit name first, then by role keyword.
 */
function findPersona(
  personas: IAgentPersona[],
  names: string[],
  roleKeywords: string[],
): IAgentPersona | null {
  const byName = personas.find((p) => names.some((name) => p.name.toLowerCase() === name.toLowerCase()));
  if (byName) return byName;

  return (
    personas.find((p) => {
      const role = p.role.toLowerCase();
      return roleKeywords.some((keyword) => role.includes(keyword.toLowerCase()));
    }) ?? null
  );
}

function findDev(personas: IAgentPersona[]): IAgentPersona | null {
  return findPersona(personas, ["Dev"], ["implementer", "executor", "developer"]);
}

function findCarlos(personas: IAgentPersona[]): IAgentPersona | null {
  return findPersona(personas, ["Carlos"], ["tech lead", "architect", "lead"]);
}

/**
 * Determine which personas should participate based on trigger type.
 * Uses role-based fallback so renamed personas still participate.
 */
function getParticipatingPersonas(triggerType: string, personas: IAgentPersona[]): IAgentPersona[] {
  const dev = findDev(personas);
  const carlos = findCarlos(personas);
  const maya = findPersona(personas, ["Maya"], ["security reviewer", "security"]);
  const priya = findPersona(personas, ["Priya"], ["qa", "quality assurance", "test"]);

  const set = new Map<string, IAgentPersona>();
  const add = (persona: IAgentPersona | null): void => {
    if (persona) set.set(persona.id, persona);
  };

  switch (triggerType) {
    case 'pr_review':
      add(dev);
      add(carlos);
      add(maya);
      add(priya);
      break;
    case 'build_failure':
      add(dev);
      add(carlos);
      break;
    case 'prd_kickoff':
      add(dev);
      add(carlos);
      break;
    default:
      add(carlos);
      break;
  }

  if (set.size === 0 && personas[0]) {
    set.set(personas[0].id, personas[0]);
  }

  return Array.from(set.values());
}

interface IResolvedAIConfig {
  provider: 'anthropic' | 'openai';
  model: string;
  baseUrl: string;
  envVars: Record<string, string>;
  maxTokens: number;
  temperature: number;
}

function joinBaseUrl(baseUrl: string, route: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${route}`;
}

function resolveGlobalAIConfig(config: INightWatchConfig): IResolvedAIConfig {
  const globalEnv = config.providerEnv ?? {};

  if (config.provider === 'claude') {
    return {
      provider: 'anthropic',
      model: config.claudeModel === 'opus' ? 'claude-opus-4-6' : 'claude-sonnet-4-6',
      baseUrl: globalEnv.ANTHROPIC_BASE_URL ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
      envVars: globalEnv,
      maxTokens: 256,
      temperature: 0.8,
    };
  }

  return {
    provider: 'openai',
    model: globalEnv.OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4o',
    baseUrl: globalEnv.OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com',
    envVars: globalEnv,
    maxTokens: 256,
    temperature: 0.8,
  };
}

function resolvePersonaAIConfig(persona: IAgentPersona, config: INightWatchConfig): IResolvedAIConfig {
  const modelConfig = persona.modelConfig;
  if (!modelConfig) {
    return resolveGlobalAIConfig(config);
  }

  const globalEnv = config.providerEnv ?? {};
  const envVars = { ...globalEnv, ...(modelConfig.envVars ?? {}) };
  const isAnthropic = modelConfig.provider === 'anthropic';

  return {
    provider: isAnthropic ? 'anthropic' : 'openai',
    model: modelConfig.model,
    baseUrl: isAnthropic
      ? modelConfig.baseUrl ?? globalEnv.ANTHROPIC_BASE_URL ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'
      : modelConfig.baseUrl ?? globalEnv.OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com',
    envVars,
    maxTokens: modelConfig.maxTokens ?? 256,
    temperature: modelConfig.temperature ?? 0.8,
  };
}

/**
 * Generate the opening message text for a discussion
 */
function buildOpeningMessage(trigger: IDiscussionTrigger): string {
  switch (trigger.type) {
    case 'pr_review':
      return `Just opened a PR — ${trigger.ref}${trigger.prUrl ? ` ${trigger.prUrl}` : ''}. Ready for review. 🔨`;
    case 'build_failure':
      return `Build failure on ${trigger.ref}. Looking into it now 🔍\n\n${trigger.context.slice(0, 500)}`;
    case 'prd_kickoff':
      return `Picking up PRD: ${trigger.ref}. Starting implementation. 🚀`;
    default:
      return trigger.context.slice(0, 500);
  }
}

/**
 * Build the contribution prompt for an agent's AI call.
 * This is what gets sent to the AI provider to generate the agent's message.
 */
function buildContributionPrompt(
  persona: IAgentPersona,
  trigger: IDiscussionTrigger,
  threadHistory: string,
  round: number,
): string {
  return `You are ${persona.name}, ${persona.role}, participating in a Slack thread with your team.

## Thread Context
Trigger: ${trigger.type} — ${trigger.ref}
Round: ${round} of ${MAX_ROUNDS}

## Context
${trigger.context.slice(0, 2000)}

## Thread So Far
${threadHistory || '(No messages yet)'}

## Your Task
Review the above from your specific expertise angle. Post a SHORT Slack message (1-2 sentences max).
- This is Slack chat, not a document. Be concise.
- Sound like a teammate talking in-thread, not a general-purpose assistant.
- Speak only to your domain — don't repeat what others said.
- You can refer to teammates by name when handing off (e.g., "Maya should sanity-check auth").
- Emojis are optional; default to none. If used, use at most one.
- If everything looks fine from your angle, just say so briefly.
- If you have a concern, state it clearly with a specific fix suggestion.
- If you have no concerns and others seem satisfied, you can just react positively.
- No headings, bullet lists, or canned phrases like "Great question" / "I hope this helps".

Write ONLY your message, nothing else. Do not include your name or any prefix.`;
}

/**
 * Call the AI provider to generate an agent contribution.
 * Uses the persona's model config or falls back to global config.
 * Returns the generated text.
 */
async function callAIForContribution(
  persona: IAgentPersona,
  config: INightWatchConfig,
  contributionPrompt: string,
): Promise<string> {
  const soulPrompt = compileSoul(persona);
  const resolved = resolvePersonaAIConfig(persona, config);

  if (resolved.provider === 'anthropic') {
    const apiKey = resolved.envVars['ANTHROPIC_API_KEY'] ?? process.env.ANTHROPIC_API_KEY ?? '';

    const response = await fetch(joinBaseUrl(resolved.baseUrl, '/v1/messages'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: resolved.model,
        max_tokens: resolved.maxTokens,
        system: soulPrompt,
        messages: [{ role: 'user', content: contributionPrompt }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${error}`);
    }

    const data = await response.json() as { content: Array<{ type: string; text: string }> };
    return data.content[0]?.text?.trim() ?? '';

  } else if (resolved.provider === 'openai') {
    const apiKey = resolved.envVars['OPENAI_API_KEY'] ?? process.env.OPENAI_API_KEY ?? '';

    const response = await fetch(joinBaseUrl(resolved.baseUrl, '/v1/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: resolved.model,
        max_tokens: resolved.maxTokens,
        temperature: resolved.temperature,
        messages: [
          { role: 'system', content: soulPrompt },
          { role: 'user', content: contributionPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content?.trim() ?? '';
  }

  return `[${persona.name}: No AI provider configured]`;
}

const CANNED_PHRASE_PREFIXES = [
  /^great question[,.! ]*/i,
  /^of course[,.! ]*/i,
  /^certainly[,.! ]*/i,
  /^you['’]re absolutely right[,.! ]*/i,
  /^i hope this helps[,.! ]*/i,
];

function limitEmojiCount(text: string, maxEmojis: number): string {
  let seen = 0;
  return text.replace(/[\p{Extended_Pictographic}]/gu, (m) => {
    seen += 1;
    return seen <= maxEmojis ? m : '';
  });
}

function isFacialEmoji(char: string): boolean {
  return /[\u{1F600}-\u{1F64F}\u{1F910}-\u{1F92F}\u{1F970}-\u{1F97A}]/u.test(char);
}

function applyEmojiPolicy(
  text: string,
  allowEmoji: boolean,
  allowNonFacialEmoji: boolean,
): string {
  if (!allowEmoji) {
    return text.replace(/[\p{Extended_Pictographic}]/gu, '');
  }

  const emojis = Array.from(text.matchAll(/[\p{Extended_Pictographic}]/gu)).map((m) => m[0]);
  if (emojis.length === 0) return text;

  const chosenFacial = emojis.find((e) => isFacialEmoji(e));
  const chosen = chosenFacial ?? (allowNonFacialEmoji ? emojis[0] : null);
  if (!chosen) {
    return text.replace(/[\p{Extended_Pictographic}]/gu, '');
  }

  let kept = false;
  return text.replace(/[\p{Extended_Pictographic}]/gu, (e) => {
    if (!kept && e === chosen) {
      kept = true;
      return e;
    }
    return '';
  });
}

function trimToSentences(text: string, maxSentences: number): string {
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= maxSentences) return text.trim();
  return parts.slice(0, maxSentences).join(' ').trim();
}

export function humanizeSlackReply(raw: string, options: IHumanizeSlackReplyOptions = {}): string {
  const {
    allowEmoji = true,
    allowNonFacialEmoji = true,
    maxSentences = MAX_HUMANIZED_SENTENCES,
  } = options;

  let text = raw.trim();
  if (!text) return text;

  // Remove markdown formatting artifacts that look templated in chat.
  text = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip common assistant-y openers.
  for (const pattern of CANNED_PHRASE_PREFIXES) {
    text = text.replace(pattern, '').trim();
  }

  text = applyEmojiPolicy(text, allowEmoji, allowNonFacialEmoji);
  text = limitEmojiCount(text, 1);
  text = trimToSentences(text, maxSentences);

  if (text.length > 260) {
    text = `${text.slice(0, 257).trimEnd()}...`;
  }

  return text;
}

function buildCurrentCliInvocation(args: string[]): string[] | null {
  const cliEntry = process.argv[1];
  if (!cliEntry) return null;
  return [...process.execArgv, cliEntry, ...args];
}

function formatCommandForLog(bin: string, args: string[]): string {
  return [bin, ...args].map((part) => JSON.stringify(part)).join(' ');
}

export class DeliberationEngine {
  private readonly _slackClient: SlackClient;
  private readonly _config: INightWatchConfig;
  private readonly _humanResumeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly _emojiCadenceCounter = new Map<string, number>();

  constructor(slackClient: SlackClient, config: INightWatchConfig) {
    this._slackClient = slackClient;
    this._config = config;
  }

  private _humanizeForPost(
    channel: string,
    threadTs: string,
    persona: IAgentPersona,
    raw: string,
  ): string {
    const key = `${channel}:${threadTs}:${persona.id}`;
    const count = (this._emojiCadenceCounter.get(key) ?? 0) + 1;
    this._emojiCadenceCounter.set(key, count);

    // Human cadence:
    // - emoji roughly every 3rd message by same persona in same thread
    // - non-facial emoji much rarer (roughly every 9th message)
    const allowEmoji = count % 3 === 0;
    const allowNonFacialEmoji = count % 9 === 0;

    return humanizeSlackReply(raw, { allowEmoji, allowNonFacialEmoji, maxSentences: 2 });
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

    const startPromise = this._startDiscussionInternal(trigger);
    inFlightDiscussionStarts.set(key, startPromise);

    try {
      return await startPromise;
    } finally {
      if (inFlightDiscussionStarts.get(key) === startPromise) {
        inFlightDiscussionStarts.delete(key);
      }
    }
  }

  private async _startDiscussionInternal(trigger: IDiscussionTrigger): Promise<ISlackDiscussion> {
    const repos = getRepositories();
    const latest = repos
      .slackDiscussion
      .getLatestByTrigger(trigger.projectPath, trigger.type, trigger.ref);
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
      const project = projects.find(p => p.path === trigger.projectPath);
      if (project?.slackChannelId) {
        resolvedTrigger.channelId = project.slackChannelId;
      }
    }
    const channel = getChannelForTrigger(resolvedTrigger, this._config);

    if (!channel) {
      throw new Error(`No Slack channel configured for trigger type: ${trigger.type}`);
    }

    // Find the dev persona to open the thread
    const devPersona = findDev(participants) ?? participants[0];
    if (!devPersona) {
      throw new Error('No active agent personas found');
    }

    // Post opening message to start the thread
    const openingText = buildOpeningMessage(trigger);
    const openingMsg = await this._slackClient.postAsAgent(channel, openingText, devPersona);

    await sleep(MESSAGE_DELAY_MS);

    // Create discussion record
    const discussion = repos.slackDiscussion.create({
      projectPath: trigger.projectPath,
      triggerType: trigger.type,
      triggerRef: trigger.ref,
      channelId: channel,
      threadTs: openingMsg.ts,
      status: 'active',
      round: 1,
      participants: [devPersona.id],
      consensusResult: null,
    });

    // Run first round of contributions (excluding Dev who already posted)
    const reviewers = participants.filter((p) => p.id !== devPersona.id);

    await this._runContributionRound(discussion.id, reviewers, trigger, openingText);

    // Check consensus after first round
    await this._evaluateConsensus(discussion.id, trigger);

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
    const history = await this._slackClient.getChannelHistory(
      discussion.channelId,
      discussion.threadTs,
      10
    );
    const historyText = history.map(m => m.text).join('\n---\n');

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
      message = await callAIForContribution(persona, this._config, contributionPrompt);
    } catch (_err) {
      message = `[Contribution from ${persona.name} unavailable — AI provider not configured]`;
    }

    if (message) {
      const finalMessage = this._humanizeForPost(
        discussion.channelId,
        discussion.threadTs,
        persona,
        message,
      );
      await this._slackClient.postAsAgent(
        discussion.channelId,
        finalMessage,
        persona,
        discussion.threadTs,
      );
      repos.slackDiscussion.addParticipant(discussionId, persona.id);
      await sleep(MESSAGE_DELAY_MS);
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
    const discussion = activeDiscussions.find(d =>
      d.channelId === channel && d.threadTs === threadTs
    );

    if (!discussion) return;

    const existingTimer = this._humanResumeTimers.get(discussion.id);
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

        await this._slackClient.postAsAgent(
          channel,
          "Picking back up — let me summarize where we are and continue. 🏗️",
          carlos,
          threadTs,
        );
        await sleep(MESSAGE_DELAY_MS);
        await this._evaluateConsensus(discussion.id, {
          type: discussion.triggerType,
          projectPath: discussion.projectPath,
          ref: discussion.triggerRef,
          context: '',
        });
      })().finally(() => {
        this._humanResumeTimers.delete(discussion.id);
      });
    }, DISCUSSION_RESUME_DELAY_MS);

    this._humanResumeTimers.set(discussion.id, timer);
  }

  /**
   * Run a round of contributions from the given personas.
   */
  private async _runContributionRound(
    discussionId: string,
    personas: IAgentPersona[],
    trigger: IDiscussionTrigger,
    currentContext: string,
  ): Promise<void> {
    const repos = getRepositories();
    const discussion = repos.slackDiscussion.getById(discussionId);
    if (!discussion) return;

    // Get current thread history
    const history = await this._slackClient.getChannelHistory(
      discussion.channelId,
      discussion.threadTs,
      10,
    );
    let historyText = history.map(m => m.text).join('\n---\n') || currentContext;

    for (const persona of personas) {
      const updatedDiscussion = repos.slackDiscussion.getById(discussionId);
      if (!updatedDiscussion || updatedDiscussion.status !== 'active') break;

      const contributionPrompt = buildContributionPrompt(
        persona,
        trigger,
        historyText,
        updatedDiscussion.round,
      );

      let message: string;
      try {
        message = await callAIForContribution(persona, this._config, contributionPrompt);
      } catch (_err) {
        message = '';
      }

      if (message) {
        const finalMessage = this._humanizeForPost(
          discussion.channelId,
          discussion.threadTs,
          persona,
          message,
        );
        await this._slackClient.postAsAgent(
          discussion.channelId,
          finalMessage,
          persona,
          discussion.threadTs,
        );
        repos.slackDiscussion.addParticipant(discussionId, persona.id);
        historyText = historyText ? `${historyText}\n---\n${finalMessage}` : finalMessage;
        await sleep(MESSAGE_DELAY_MS);
      }
    }
  }

  /**
   * Evaluate whether consensus has been reached.
   * Lead agent (Carlos) decides: approve, request changes, or escalate.
   * Uses an iterative loop for multi-round handling (no recursion).
   */
  private async _evaluateConsensus(
    discussionId: string,
    trigger: IDiscussionTrigger,
  ): Promise<void> {
    const repos = getRepositories();

    // Re-check state each round; stop when consensus/blocked or discussion disappears.
    while (true) {
      const discussion = repos.slackDiscussion.getById(discussionId);
      if (!discussion || discussion.status !== 'active') return;

      const personas = repos.agentPersona.getActive();
      const carlos = findCarlos(personas);

      if (!carlos) {
        repos.slackDiscussion.updateStatus(discussionId, 'consensus', 'approved');
        return;
      }

      // Get thread history and let Carlos evaluate
      const history = await this._slackClient.getChannelHistory(
        discussion.channelId,
        discussion.threadTs,
        20,
      );
      const historyText = history.map(m => m.text).join('\n---\n');

      const consensusPrompt = `You are ${carlos.name}, ${carlos.role}.

Review this discussion thread and decide: are we ready to ship, do we need another round of review, or do we need a human?

Thread:
${historyText}

Round: ${discussion.round} of ${MAX_ROUNDS}

Respond with ONLY one of:
- APPROVE: [your short closing message, e.g., "LGTM 👍 Ship it 🚀"]
- CHANGES: [summary of what still needs to change — be specific]
- HUMAN: [why you need a human decision]`;

      let decision: string;
      try {
        decision = await callAIForContribution(carlos, this._config, consensusPrompt);
      } catch (_err) {
        decision = 'HUMAN: AI evaluation failed — needs manual review';
      }

      if (decision.startsWith('APPROVE')) {
        const message = decision.replace(/^APPROVE:\s*/, '').trim() || 'Ship it 🚀';
        await this._slackClient.postAsAgent(discussion.channelId, message, carlos, discussion.threadTs);
        repos.slackDiscussion.updateStatus(discussionId, 'consensus', 'approved');
        return;
      }

      if (decision.startsWith('CHANGES') && discussion.round < MAX_ROUNDS) {
        const changes = decision.replace(/^CHANGES:\s*/, '').trim();
        await this._slackClient.postAsAgent(
          discussion.channelId,
          `One more pass needed:\n${changes}`,
          carlos,
          discussion.threadTs,
        );
        await sleep(MESSAGE_DELAY_MS);

        // Increment round and start another contribution round, then loop back.
        const nextRound = discussion.round + 1;
        repos.slackDiscussion.updateRound(discussionId, nextRound);

        const participants = getParticipatingPersonas(trigger.type, personas);
        const devPersona = findDev(personas);
        const reviewers = participants.filter((p) => !devPersona || p.id !== devPersona.id);
        await this._runContributionRound(discussionId, reviewers, trigger, changes);
        continue;
      }

      if (decision.startsWith('CHANGES') && discussion.round >= MAX_ROUNDS) {
        // Max rounds reached — set changes_requested and optionally trigger PR refinement
        const changesSummary = decision.replace(/^CHANGES:\s*/, '').trim();
        await this._slackClient.postAsAgent(
          discussion.channelId,
          "3 rounds in — shipping what we have. Ship it 🚀",
          carlos,
          discussion.threadTs,
        );
        repos.slackDiscussion.updateStatus(discussionId, 'consensus', 'changes_requested');

        if (discussion.triggerType === 'pr_review') {
          await this.triggerPRRefinement(discussionId, changesSummary, discussion.triggerRef).catch(e =>
            console.warn('PR refinement trigger failed:', e)
          );
        }
        return;
      }

      // HUMAN or fallback
      await this._slackClient.postAsAgent(
        discussion.channelId,
        "This one needs a human call. Flagging for review. 🚩",
        carlos,
        discussion.threadTs,
      );
      repos.slackDiscussion.updateStatus(discussionId, 'blocked', 'human_needed');
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
      await this._slackClient.postAsAgent(
        discussion.channelId,
        `Got it. I'll send this back through review for PR #${prNumber}.`,
        carlos,
        discussion.threadTs,
      );
      await sleep(MESSAGE_DELAY_MS);
    }

    // Set NW_SLACK_FEEDBACK and trigger reviewer
    const feedback = JSON.stringify({ discussionId, prNumber, changes: changesSummary });
    const invocationArgs = buildCurrentCliInvocation(['review']);
    if (!invocationArgs) {
      console.warn(
        `[slack][job] triggerPRRefinement reviewer spawn failed via ${actor} pr=${prNumber}: CLI entry path unavailable`,
      );
      if (carlos) {
        await this._slackClient.postAsAgent(
          discussion.channelId,
          `I couldn't start the reviewer process right now. I'll fix that and rerun it.`,
          carlos,
          discussion.threadTs,
        );
      }
      return;
    }
    console.log(
      `[slack][job] triggerPRRefinement reviewer spawn via ${actor} pr=${prNumber} cmd=${formatCommandForLog(process.execPath, invocationArgs)}`,
    );

    // Spawn the reviewer as a detached process
    const { spawn } = await import('child_process');
    const reviewer = spawn(
      process.execPath,
      invocationArgs,
      {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, NW_SLACK_FEEDBACK: feedback, NW_TARGET_PR: prNumber },
      }
    );
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
  ): Promise<void> {
    let history: { text: string }[] = [];
    try {
      history = await this._slackClient.getChannelHistory(channel, threadTs, 10);
    } catch {
      // Ignore — reply with just the incoming text as context
    }

    const historyText = history.map((m) => m.text).join('\n---\n');

    const prompt =
      `You are ${persona.name}, ${persona.role}.\n` +
      (persona.soul?.whoIAm ? `About you: ${persona.soul.whoIAm}\n\n` : '') +
      (projectContext ? `Project context:\n${projectContext}\n\n` : '') +
      (historyText ? `Thread context:\n${historyText}\n\n` : '') +
      `Someone just said: "${incomingText}"\n\n` +
      `Reply concisely in your own voice. Keep it to 1-2 sentences unless detail is clearly needed. ` +
      `You can refer to teammates by name if a handoff helps. ` +
      `Sound like a real teammate in chat, not an assistant. Avoid canned phrases like "Great question", ` +
      `"Of course", or "I hope this helps". No headings or bullet lists. Emojis are optional; use at most one.`;

    let message: string;
    try {
      message = await callAIForContribution(persona, this._config, prompt);
    } catch {
      message = `[Reply from ${persona.name} unavailable — AI provider not configured]`;
    }

    if (message) {
      await this._slackClient.postAsAgent(
        channel,
        this._humanizeForPost(channel, threadTs, persona, message),
        persona,
        threadTs,
      );
    }
  }
}

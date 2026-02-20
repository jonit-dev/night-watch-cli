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
import { createBoardProvider } from "@/board/factory.js";

const MAX_ROUNDS = 3;
const HUMAN_DELAY_MIN_MS = 20_000; // Minimum pause between agent replies (20s)
const HUMAN_DELAY_MAX_MS = 60_000; // Maximum pause between agent replies (60s)
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
    case 'code_watch':
      add(dev);
      add(carlos);
      add(maya);
      add(priya);
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
      return `Opened ${trigger.ref}${trigger.prUrl ? ` — ${trigger.prUrl}` : ''}. Ready for eyes.`;
    case 'build_failure':
      return `Build broke on ${trigger.ref}. Looking into it.\n\n${trigger.context.slice(0, 500)}`;
    case 'prd_kickoff':
      return `Picking up ${trigger.ref}. Going to start carving out the implementation.`;
    case 'code_watch': {
      const CODE_WATCH_OPENERS = [
        'Something caught my eye during a scan — want to get a second opinion on this.',
        'Quick flag from the latest code scan. Might be nothing, might be worth patching.',
        'Scanner flagged this one. Thought it was worth surfacing before it bites us.',
        'Flagging something from the codebase — could be intentional, but it pinged the scanner.',
        'Spotted this during a scan. Curious if it\'s expected or something we should fix.',
      ];
      const hash = trigger.ref.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const opener = CODE_WATCH_OPENERS[hash % CODE_WATCH_OPENERS.length];
      return `${opener}\n\n${trigger.context.slice(0, 600)}`;
    }
    default:
      return trigger.context.slice(0, 500);
  }
}

/**
 * Parse the structured code_watch context string and derive a git-style issue title.
 */
function buildIssueTitleFromTrigger(trigger: IDiscussionTrigger): string {
  const signalMatch = trigger.context.match(/^Signal: (.+)$/m);
  const locationMatch = trigger.context.match(/^Location: (.+)$/m);
  const signal = signalMatch?.[1] ?? 'code signal';
  const location = locationMatch?.[1] ?? 'unknown location';
  return `fix: ${signal} at ${location}`;
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
  const isFirstRound = round === 1;
  const isFinalRound = round >= MAX_ROUNDS;

  return `You are ${persona.name}, ${persona.role}.
You're in a Slack thread with your teammates — Dev (implementer), Carlos (tech lead), Maya (security), and Priya (QA). This is a real conversation, not a report.

Trigger: ${trigger.type} — ${trigger.ref}
Round: ${round}/${MAX_ROUNDS}${isFinalRound ? ' (final round — wrap up)' : ''}

## Context
${trigger.context.slice(0, 2000)}

## Thread So Far
${threadHistory || '(Thread just started)'}

## How to respond
Write a short Slack message — 1 to 2 sentences. This is chat, not documentation.
${isFirstRound ? '- First round: give your initial take from your angle. Be specific.' : '- Follow-up round: respond to what others said. Agree, push back, or add something new.'}
- Talk like a teammate, not an assistant. No pleasantries, no filler.
- Stay in your lane — only comment on your domain unless something crosses into it.
- You can name-drop teammates when handing off ("Maya should look at the auth here").
- If nothing concerns you, a brief "nothing from me" or a short acknowledgment is fine.
- If you have a concern, name it specifically and suggest a direction.
- No markdown formatting. No bullet lists. No headings. Just a message.
- Emojis: use one only if it genuinely fits. Default to none.
- Never start with "Great question", "Of course", "I hope this helps", or similar.
- Never say "as an AI" or break character.
${isFinalRound ? '- Final round: be decisive. State your position clearly.' : ''}

Write ONLY your message. No name prefix, no labels.`;
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

    await sleep(humanDelay());

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
          "Ok, picking this back up. Let me see where we landed.",
          carlos,
          threadTs,
        );
        await sleep(humanDelay());
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
        await sleep(humanDelay());
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

      const consensusPrompt = `You are ${carlos.name}, ${carlos.role}. You're wrapping up a team discussion.

Thread:
${historyText}

Round: ${discussion.round}/${MAX_ROUNDS}

Make the call. Are we done, do we need another pass, or does a human need to weigh in?

Respond with EXACTLY one of these formats (include the prefix):
- APPROVE: [short closing message in your voice — e.g., "Clean. Let's ship it."]
- CHANGES: [what specifically still needs work — be concrete, not vague]
- HUMAN: [why this needs a human decision — be specific about what's ambiguous]

Write the prefix and your message. Nothing else.`;

      let decision: string;
      try {
        decision = await callAIForContribution(carlos, this._config, consensusPrompt);
      } catch (_err) {
        decision = 'HUMAN: AI evaluation failed — needs manual review';
      }

      if (decision.startsWith('APPROVE')) {
        const message = decision.replace(/^APPROVE:\s*/, '').trim() || 'Clean. Ship it.';
        await this._slackClient.postAsAgent(discussion.channelId, message, carlos, discussion.threadTs);
        repos.slackDiscussion.updateStatus(discussionId, 'consensus', 'approved');
        if (trigger.type === 'code_watch') {
          await this.triggerIssueOpener(discussionId, trigger)
            .catch((e: unknown) => console.warn('Issue opener failed:', String(e)));
        }
        return;
      }

      if (decision.startsWith('CHANGES') && discussion.round < MAX_ROUNDS) {
        const changes = decision.replace(/^CHANGES:\s*/, '').trim();
        await this._slackClient.postAsAgent(
          discussion.channelId,
          changes,
          carlos,
          discussion.threadTs,
        );
        await sleep(humanDelay());

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
          `We've been at this for ${MAX_ROUNDS} rounds. Sending it through with the remaining notes — Dev can address them in the next pass.`,
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
      const humanReason = decision.replace(/^HUMAN:\s*/, '').trim();
      await this._slackClient.postAsAgent(
        discussion.channelId,
        humanReason
          ? `Need a human on this one — ${humanReason}`
          : 'This needs a human call. Flagging it.',
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
      console.warn(
        `[slack][job] triggerPRRefinement reviewer spawn failed via ${actor} pr=${prNumber}: CLI entry path unavailable`,
      );
      if (carlos) {
        await this._slackClient.postAsAgent(
          discussion.channelId,
          `Can't start the reviewer right now — runtime issue. Will retry.`,
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
      `Your teammates: Dev (implementer), Carlos (tech lead), Maya (security), Priya (QA).\n\n` +
      (projectContext ? `Project context: ${projectContext}\n\n` : '') +
      (historyText ? `Thread so far:\n${historyText}\n\n` : '') +
      `Latest message: "${incomingText}"\n\n` +
      `Respond in your own voice. This is Slack — keep it to 1-2 sentences.\n` +
      `- Talk like a colleague, not a bot. No "Great question", "Of course", or "I hope this helps".\n` +
      `- You can tag teammates by name if someone else should weigh in.\n` +
      `- No markdown formatting, headings, or bullet lists.\n` +
      `- Emojis: one max, only if it fits naturally. Default to none.\n` +
      `- If the question is outside your domain, say so briefly and point to the right person.\n` +
      `- If you disagree, say why in one line. If you agree, keep it short.\n\n` +
      `Write only your reply. No name prefix.`;

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
      `- If you genuinely have nothing useful to say, write exactly: SKIP\n\n` +
      `Write only your message. No name prefix.`;

    let message: string;
    try {
      message = await callAIForContribution(persona, this._config, prompt);
    } catch {
      return; // Silently skip — proactive messages are optional
    }

    if (!message || message.trim().toUpperCase() === 'SKIP') {
      return;
    }

    const dummyTs = `${Date.now()}`;
    const finalMessage = this._humanizeForPost(channel, dummyTs, persona, message);
    if (finalMessage) {
      await this._slackClient.postAsAgent(channel, finalMessage, persona);
    }
  }

  /**
   * Generate a structured GitHub issue body written by the Dev persona.
   */
  private async _generateIssueBody(
    trigger: IDiscussionTrigger,
    devPersona: IAgentPersona,
  ): Promise<string> {
    const prompt = `You are ${devPersona.name}, ${devPersona.role}.
Write a concise GitHub issue body for the following code scan finding.
Use this structure exactly (GitHub Markdown):

## Problem
One sentence describing what was detected and why it's risky.

## Location
File and line where the issue exists.

## Code
\`\`\`
The offending snippet
\`\`\`

## Suggested Fix
2-3 bullet points on how to address it.

## Acceptance Criteria
- [ ] Checkbox items describing what "done" looks like

Keep it tight — this is a bug report, not a spec. No fluff, no greetings.

Context:
${trigger.context}`;

    const raw = await callAIForContribution(devPersona, this._config, prompt);
    return raw.trim();
  }

  /**
   * Open a GitHub issue from a code_watch finding and post back to the thread.
   * Called automatically after an approved code_watch consensus.
   */
  async triggerIssueOpener(
    discussionId: string,
    trigger: IDiscussionTrigger,
  ): Promise<void> {
    const repos = getRepositories();
    const discussion = repos.slackDiscussion.getById(discussionId);
    if (!discussion) return;

    const devPersona = findDev(repos.agentPersona.getActive());
    if (!devPersona) return;

    // Acknowledge before doing async work
    await this._slackClient.postAsAgent(
      discussion.channelId,
      'Agreed. Writing up an issue for this.',
      devPersona,
      discussion.threadTs,
    );

    const title = buildIssueTitleFromTrigger(trigger);
    const body = await this._generateIssueBody(trigger, devPersona);

    const boardConfig = this._config.boardProvider;
    if (boardConfig?.enabled) {
      try {
        const provider = createBoardProvider(boardConfig, trigger.projectPath);
        const issue = await provider.createIssue({ title, body, column: 'Ready' });
        await this._slackClient.postAsAgent(
          discussion.channelId,
          `Opened #${issue.number}: *${issue.title}* — ${issue.url}\n\nAnyone want to pick this up, or should I take a pass at it?`,
          devPersona,
          discussion.threadTs,
        );
      } catch (err) {
        console.warn('[issue_opener] board createIssue failed:', err);
        await this._slackClient.postAsAgent(
          discussion.channelId,
          `Couldn't open the issue automatically — board might not be configured. Here's the writeup:\n\n${body.slice(0, 600)}`,
          devPersona,
          discussion.threadTs,
        );
      }
    } else {
      // No board configured — post the writeup in thread so it's not lost
      await this._slackClient.postAsAgent(
        discussion.channelId,
        `No board configured, dropping the writeup here:\n\n${body.slice(0, 600)}`,
        devPersona,
        discussion.threadTs,
      );
    }
  }
}

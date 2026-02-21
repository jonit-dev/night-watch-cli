/**
 * CascadingReplyHandler — orchestrates all cascading reply logic:
 * agent-mention follow-ups, piggyback replies, multi-persona engagement,
 * thread history recovery, and human-response timing.
 *
 * Extracted from SlackInteractionListener to give it a single, testable concern.
 */

import type { IAgentPersona } from '@night-watch/core';
import { createLogger } from '@night-watch/core';
import type { SlackClient } from './client.js';
import type { DeliberationEngine } from './deliberation.js';
import { resolvePersonasByPlainName } from './personas.js';
import type { ThreadStateManager } from './thread-state-manager.js';
import { sleep } from './utils.js';

const log = createLogger('cascading-reply');

const HUMAN_REACTION_PROBABILITY = 0.65;
const RANDOM_REACTION_PROBABILITY = 0.25;
const REACTION_DELAY_MIN_MS = 180;
const REACTION_DELAY_MAX_MS = 1200;
const RESPONSE_DELAY_MIN_MS = 700;
const RESPONSE_DELAY_MAX_MS = 3400;
// Chance a second persona spontaneously chimes in after the first replies
const PIGGYBACK_REPLY_PROBABILITY = 0.4;
const PIGGYBACK_DELAY_MIN_MS = 4_000;
const PIGGYBACK_DELAY_MAX_MS = 15_000;

export class CascadingReplyHandler {
  constructor(
    private readonly slackClient: SlackClient,
    private readonly engine: DeliberationEngine,
    private readonly state: ThreadStateManager,
  ) {}

  /**
   * Expose RANDOM_REACTION_PROBABILITY so callers (e.g. SlackInteractionListener)
   * can apply the same threshold when deciding whether to fire a reaction.
   */
  get randomReactionProbability(): number {
    return RANDOM_REACTION_PROBABILITY;
  }

  /**
   * After an agent posts a reply, check if the text mentions other personas by plain name.
   * If so, trigger those personas to respond once (no further cascading — depth 1 only).
   * This enables natural agent-to-agent handoffs like "Carlos, what's the priority here?"
   */
  async followAgentMentions(
    postedText: string,
    channel: string,
    threadTs: string,
    personas: IAgentPersona[],
    projectContext: string,
    skipPersonaId: string,
  ): Promise<void> {
    if (!postedText) return;

    const mentioned = resolvePersonasByPlainName(postedText, personas).filter(
      (p) => p.id !== skipPersonaId && !this.state.isPersonaOnCooldown(channel, threadTs, p.id),
    );

    if (mentioned.length === 0) return;

    log.info('agent mention follow-up', {
      agents: mentioned.map((p) => p.name).join(', '),
      channel,
    });

    for (const persona of mentioned) {
      // Small human-like delay before the tagged persona responds
      await sleep(this.state.randomInt(RESPONSE_DELAY_MIN_MS * 2, RESPONSE_DELAY_MAX_MS * 3));
      // replyAsAgent fetches thread history internally so the persona sees the conversation
      await this.engine.replyAsAgent(channel, threadTs, postedText, persona, projectContext);
      this.state.markPersonaReply(channel, threadTs, persona.id);
      this.state.rememberAdHocThreadPersona(channel, threadTs, persona.id);
    }
  }

  /**
   * After a persona replies, spontaneously trigger a second persona to chime in.
   * Simulates the organic team dynamics where a teammate jumps in unprompted.
   * Fire-and-forget: call with `void` to avoid blocking the main reply path.
   */
  async maybePiggybackReply(
    channel: string,
    threadTs: string,
    text: string,
    personas: IAgentPersona[],
    projectContext: string,
    excludePersonaId: string,
  ): Promise<void> {
    if (Math.random() > PIGGYBACK_REPLY_PROBABILITY) return;

    const others = personas.filter(
      (p) => p.id !== excludePersonaId && !this.state.isPersonaOnCooldown(channel, threadTs, p.id),
    );
    if (others.length === 0) return;

    const persona = others[Math.floor(Math.random() * others.length)];
    await sleep(this.state.randomInt(PIGGYBACK_DELAY_MIN_MS, PIGGYBACK_DELAY_MAX_MS));

    const postedText = await this.engine.replyAsAgent(
      channel,
      threadTs,
      text,
      persona,
      projectContext,
    );
    this.state.markPersonaReply(channel, threadTs, persona.id);
    this.state.rememberAdHocThreadPersona(channel, threadTs, persona.id);
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
  async engageMultiplePersonas(
    channel: string,
    threadTs: string,
    messageTs: string,
    text: string,
    personas: IAgentPersona[],
    projectContext: string,
  ): Promise<void> {
    const available = personas.filter(
      (p) => !this.state.isPersonaOnCooldown(channel, threadTs, p.id),
    );
    if (available.length === 0) return;

    // Shuffle and pick 2-3 personas
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const count = Math.min(shuffled.length, this.state.randomInt(2, 3));
    const participants = shuffled.slice(0, count);

    let firstPostedPersonaId = '';
    for (let i = 0; i < participants.length; i++) {
      const persona = participants[i];
      if (i > 0) {
        // Stagger subsequent replies
        await sleep(this.state.randomInt(PIGGYBACK_DELAY_MIN_MS, PIGGYBACK_DELAY_MAX_MS));
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
      this.state.markPersonaReply(channel, threadTs, persona.id);
      this.state.rememberAdHocThreadPersona(channel, threadTs, persona.id);
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
  async recoverPersonaFromThreadHistory(
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

  /**
   * Add a reaction and apply a human-like response delay before the agent posts.
   */
  async applyHumanResponseTiming(
    channel: string,
    messageTs: string,
    persona: IAgentPersona,
  ): Promise<void> {
    await this.maybeReactToHumanMessage(channel, messageTs, persona);
    await sleep(this.state.randomInt(RESPONSE_DELAY_MIN_MS, RESPONSE_DELAY_MAX_MS));
  }

  /**
   * Randomly add an emoji reaction to a human message, simulating the persona
   * noticing and reacting before formulating a reply.
   */
  async maybeReactToHumanMessage(
    channel: string,
    messageTs: string,
    persona: IAgentPersona,
  ): Promise<void> {
    if (Math.random() > HUMAN_REACTION_PROBABILITY) {
      return;
    }

    const candidates = this.reactionCandidatesForPersona(persona);
    const reaction = candidates[this.state.randomInt(0, candidates.length - 1)];

    await sleep(this.state.randomInt(REACTION_DELAY_MIN_MS, REACTION_DELAY_MAX_MS));
    try {
      await this.slackClient.addReaction(channel, messageTs, reaction);
    } catch {
      // Ignore reaction failures (permissions, already reacted, etc.)
    }
  }

  /**
   * Return emoji reaction candidates appropriate for the persona's role.
   */
  reactionCandidatesForPersona(persona: IAgentPersona): string[] {
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
}

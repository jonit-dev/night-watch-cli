/**
 * AI-powered persona matcher — picks the most contextually suitable persona for a message.
 * Never posts to Slack; used only for routing decisions.
 */

import type { IAgentPersona, INightWatchConfig } from '@night-watch/core';
import { createLogger } from '@night-watch/core';
import { callSimpleAI } from './client.js';

const log = createLogger('persona-matcher');

const SYSTEM_PROMPT = `You are a routing agent for a software team's Slack bot.
Your only job is to select which team persona should respond to a message.
Output exactly one name from the provided list. No other text. No punctuation. No explanation.
If the message is ambiguous, pick the most likely domain match.`;

/**
 * Selects the most suitable persona for a given message using AI routing.
 * Returns null on any error or unrecognized response — callers must fall back to random.
 */
export async function matchPersonaToMessage(
  message: string,
  personas: IAgentPersona[],
  config: INightWatchConfig,
): Promise<IAgentPersona | null> {
  try {
    const personaList = personas
      .map((p) => {
        const expertise = p.soul?.expertise?.join(', ') || p.role;
        return `- ${p.name} (${p.role}) | expertise: ${expertise}`;
      })
      .join('\n');

    const userPrompt = `Available personas:\n${personaList}\n\nMessage (first 500 chars):\n"${message.trim().slice(0, 500)}"\n\nRespond with one name only.`;

    const raw = await callSimpleAI(SYSTEM_PROMPT, userPrompt, config, 64);
    const cleaned = raw.trim().split(/\s+/)[0] ?? '';
    const matched = personas.find((p) => p.name.toLowerCase() === cleaned.toLowerCase()) ?? null;

    if (!matched) {
      log.warn('persona-matcher returned unrecognized name', { raw, cleaned });
    }

    return matched;
  } catch (err) {
    log.warn('persona-matcher failed, falling back to random', { error: String(err) });
    return null;
  }
}

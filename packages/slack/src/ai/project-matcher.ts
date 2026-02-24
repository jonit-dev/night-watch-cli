/**
 * AI-powered project matcher — picks the most contextually suitable project for a message.
 * Used as a fallback when channel mapping and regex extraction both fail to resolve a project.
 */

import type { INightWatchConfig, IRegistryEntry } from '@night-watch/core';
import { createLogger } from '@night-watch/core';
import { callSimpleAI } from './client.js';
import { normalizeProjectRef } from '../utils.js';

const log = createLogger('project-matcher');

const SYSTEM_PROMPT = `You are a routing agent for a software team's Slack bot.
Your only job is to identify which registered project a message refers to.
Output exactly one project name from the provided list, or "none" if the message does not clearly refer to any project.
No other text. No punctuation. No explanation.`;

/**
 * Selects the most suitable project for a given message using AI routing.
 * Returns null on any error, unrecognized response, or when AI says "none".
 * Short-circuits to null when 0 projects exist, and returns the only project when there is 1.
 */
export async function matchProjectToMessage(
  message: string,
  projects: IRegistryEntry[],
  config: INightWatchConfig,
): Promise<IRegistryEntry | null> {
  if (projects.length === 0) return null;
  if (projects.length === 1) return projects[0];

  try {
    const projectList = projects.map((p) => `- ${p.name}`).join('\n');
    const userPrompt = `Registered projects:\n${projectList}\n\nMessage:\n"${message.trim().slice(0, 500)}"\n\nRespond with one project name or "none".`;

    const raw = await callSimpleAI(SYSTEM_PROMPT, userPrompt, config, 64);
    const cleaned = raw.trim().split(/\s+/)[0] ?? '';

    if (!cleaned || cleaned.toLowerCase() === 'none') return null;

    // Try exact match first, then fall back to normalized matching so partial names
    // like "night-watch-cli" resolve to "@jonit-dev/night-watch-cli".
    const cleanedNorm = normalizeProjectRef(cleaned);
    const matched =
      projects.find((p) => p.name.toLowerCase() === cleaned.toLowerCase()) ??
      projects.find((p) => normalizeProjectRef(p.name) === cleanedNorm) ??
      projects.find((p) => normalizeProjectRef(p.name).includes(cleanedNorm)) ??
      null;

    if (!matched) {
      log.warn('project-matcher returned unrecognized name', { raw, cleaned });
    }

    return matched;
  } catch (err) {
    log.warn('project-matcher failed, falling back to asking user', { error: String(err) });
    return null;
  }
}

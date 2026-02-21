/**
 * Persona resolution and scoring utilities.
 * Consolidated from deliberation.ts and interaction-listener.ts to eliminate DRY violations.
 */

import type { IAgentPersona } from '@night-watch/core';
import { normalizeHandle, normalizeText, stripSlackUserMentions } from './utils.js';

type TPersonaDomain = 'security' | 'qa' | 'lead' | 'dev' | 'general';

/**
 * Find a persona by explicit name first, then by role keyword.
 */
export function findPersona(
  personas: IAgentPersona[],
  names: string[],
  roleKeywords: string[],
): IAgentPersona | null {
  const byName = personas.find((p) =>
    names.some((name) => p.name.toLowerCase() === name.toLowerCase()),
  );
  if (byName) return byName;

  return (
    personas.find((p) => {
      const role = p.role.toLowerCase();
      return roleKeywords.some((keyword) => role.includes(keyword.toLowerCase()));
    }) ?? null
  );
}

/**
 * Find the Dev (implementer/executor) persona.
 */
export function findDev(personas: IAgentPersona[]): IAgentPersona | null {
  return findPersona(personas, ['Dev'], ['implementer', 'executor', 'developer']);
}

/**
 * Find the Carlos (tech lead/architect) persona.
 */
export function findCarlos(personas: IAgentPersona[]): IAgentPersona | null {
  return findPersona(personas, ['Carlos'], ['tech lead', 'architect', 'lead']);
}

/**
 * Find Maya (security reviewer) persona.
 */
export function findMaya(personas: IAgentPersona[]): IAgentPersona | null {
  return findPersona(personas, ['Maya'], ['security reviewer', 'security']);
}

/**
 * Find Priya (QA) persona.
 */
export function findPriya(personas: IAgentPersona[]): IAgentPersona | null {
  return findPersona(personas, ['Priya'], ['qa', 'quality assurance', 'test']);
}

/**
 * Determine which personas should participate based on trigger type.
 * Uses role-based fallback so renamed personas still participate.
 */
export function getParticipatingPersonas(
  triggerType: string,
  personas: IAgentPersona[],
): IAgentPersona[] {
  const dev = findDev(personas);
  const carlos = findCarlos(personas);
  const maya = findMaya(personas);
  const priya = findPriya(personas);

  const set = new Map<string, IAgentPersona>();
  const add = (persona: IAgentPersona | null): void => {
    if (persona) set.set(persona.id, persona);
  };

  switch (triggerType) {
    case 'pr_review':
    case 'code_watch':
      add(dev);
      add(carlos);
      add(maya);
      add(priya);
      break;
    case 'build_failure':
    case 'prd_kickoff':
      add(dev);
      add(carlos);
      break;
    case 'issue_review':
      add(carlos);
      add(maya);
      add(priya);
      add(dev);
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

/**
 * Determine the domain of a persona based on their role and expertise.
 */
export function getPersonaDomain(persona: IAgentPersona): TPersonaDomain {
  const role = persona.role.toLowerCase();
  const expertise = (persona.soul?.expertise ?? []).join(' ').toLowerCase();
  const blob = `${role} ${expertise}`;

  if (/\bsecurity|auth|pentest|owasp|crypt|vuln\b/.test(blob)) return 'security';
  if (/\bqa|quality|test|e2e\b/.test(blob)) return 'qa';
  if (/\blead|architect|architecture|systems\b/.test(blob)) return 'lead';
  if (/\bimplementer|developer|executor|engineer\b/.test(blob)) return 'dev';
  return 'general';
}

/**
 * Score a persona's relevance to a given text.
 * Higher scores indicate better fit for responding to the text.
 */
export function scorePersonaForText(text: string, persona: IAgentPersona): number {
  const normalized = normalizeText(stripSlackUserMentions(text), { preservePaths: true });
  if (!normalized) return 0;

  let score = 0;
  const domain = getPersonaDomain(persona);

  if (normalized.includes(persona.name.toLowerCase())) {
    score += 12;
  }

  const securitySignal =
    /\b(security|auth|vuln|owasp|xss|csrf|token|permission|exploit|threat)\b/.test(normalized);
  const qaSignal = /\b(qa|test|testing|bug|e2e|playwright|regression|flaky)\b/.test(normalized);
  const leadSignal =
    /\b(architecture|architect|design|scalability|performance|tech debt|tradeoff|strategy)\b/.test(
      normalized,
    );
  const devSignal = /\b(implement|implementation|code|build|fix|patch|ship|pr)\b/.test(normalized);

  if (securitySignal && domain === 'security') score += 8;
  if (qaSignal && domain === 'qa') score += 8;
  if (leadSignal && domain === 'lead') score += 8;
  if (devSignal && domain === 'dev') score += 8;

  const personaTokens = new Set([
    ...persona.role
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3),
    ...(persona.soul?.expertise ?? [])
      .flatMap((s) => s.toLowerCase().split(/[^a-z0-9]+/))
      .filter((t) => t.length >= 3),
  ]);

  const textTokens = normalized.split(/\s+/).filter((t) => t.length >= 3);
  for (const token of textTokens) {
    if (personaTokens.has(token)) {
      score += 2;
    }
  }

  return score;
}

/**
 * Select the best follow-up persona based on text relevance.
 * Defaults to continuity unless another persona is clearly a better fit.
 */
export function selectFollowUpPersona(
  preferred: IAgentPersona,
  personas: IAgentPersona[],
  text: string,
): IAgentPersona {
  if (personas.length === 0) return preferred;

  const preferredScore = scorePersonaForText(text, preferred);
  let best = preferred;
  let bestScore = preferredScore;

  for (const persona of personas) {
    const score = scorePersonaForText(text, persona);
    if (score > bestScore) {
      best = persona;
      bestScore = score;
    }
  }

  // Default to continuity unless another persona is clearly a better fit.
  if (best.id !== preferred.id && bestScore >= preferredScore + 4 && bestScore >= 8) {
    return best;
  }
  return preferred;
}

/**
 * Extract @handle mentions from raw Slack text.
 * Example: "@maya please check this" -> ["maya"]
 */
export function extractMentionHandles(text: string): string[] {
  const matches = text.match(/@([a-z0-9._-]{2,32})/gi) ?? [];
  const seen = new Set<string>();
  const handles: string[] = [];

  for (const match of matches) {
    const normalized = normalizeHandle(match.slice(1));
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    handles.push(normalized);
  }

  return handles;
}

/**
 * Resolve mention handles to active personas by display name.
 * Matches @-prefixed handles in text (e.g. "@maya").
 */
export function resolveMentionedPersonas(text: string, personas: IAgentPersona[]): IAgentPersona[] {
  const handles = extractMentionHandles(text);
  if (handles.length === 0) return [];

  const byHandle = new Map<string, IAgentPersona>();
  for (const persona of personas) {
    byHandle.set(normalizeHandle(persona.name), persona);
  }

  const resolved: IAgentPersona[] = [];
  const seenPersonaIds = new Set<string>();

  for (const handle of handles) {
    const persona = byHandle.get(handle);
    if (!persona || seenPersonaIds.has(persona.id)) {
      continue;
    }
    seenPersonaIds.add(persona.id);
    resolved.push(persona);
  }

  return resolved;
}

/**
 * Match personas whose name appears as a word in the text (case-insensitive, no @ needed).
 * Used for app_mention events where text looks like "<@BOTID> maya check this PR".
 */
export function resolvePersonasByPlainName(
  text: string,
  personas: IAgentPersona[],
): IAgentPersona[] {
  // Strip Slack user ID mentions like <@U12345678> to avoid false positives
  const stripped = text.replace(/<@[A-Z0-9]+>/g, '').toLowerCase();

  const resolved: IAgentPersona[] = [];
  const seenPersonaIds = new Set<string>();

  for (const persona of personas) {
    if (seenPersonaIds.has(persona.id)) continue;
    const nameLower = persona.name.toLowerCase();
    // Word-boundary match: persona name as a whole word
    const re = new RegExp(`\\b${nameLower}\\b`);
    if (re.test(stripped)) {
      resolved.push(persona);
      seenPersonaIds.add(persona.id);
    }
  }

  return resolved;
}

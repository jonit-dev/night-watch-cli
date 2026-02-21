/**
 * Builds role-flavored reflection and compaction prompts for agent persona memory.
 *
 * Role detection is keyword-based (case-insensitive) — no hardcoded persona names.
 */

import type { IAgentPersona, IReflectionContext } from '@/shared/types.js';

import { COMPACTION_TARGET_LINES } from './memory-constants.js';

/** Describe the trigger context as a human-readable string fragment. */
function describeContext(context: IReflectionContext): string {
  const filesNote =
    context.filesChanged && context.filesChanged.length > 0
      ? ` (files touched: ${context.filesChanged.join(', ')})`
      : '';
  return `a ${context.triggerType} event${filesNote} — outcome: ${context.outcome}. Summary: ${context.summary}`;
}

/** Return the role-flavored framing line based on keywords in persona.role. */
function roleFraming(role: string, contextDescription: string): string {
  const r = role.toLowerCase();

  if (r.includes('implementer') || r.includes('developer')) {
    return (
      `You just implemented/worked on ${contextDescription}. ` +
      'What patterns, pitfalls, or conventions should you remember? ' +
      'Think like a developer who wants to avoid repeating mistakes.'
    );
  }

  if (r.includes('tech lead') || r.includes('architect') || r.includes('lead')) {
    return (
      `You just reviewed ${contextDescription}. ` +
      'What architectural patterns, code quality issues, or decomposition lessons should you remember? ' +
      'Think like a tech lead tracking team patterns.'
    );
  }

  if (r.includes('qa') || r.includes('quality') || r.includes('test')) {
    return (
      `You just tested ${contextDescription}. ` +
      'What testing gaps, flaky patterns, or coverage lessons should you remember? ' +
      'Think like a QA engineer building institutional testing knowledge.'
    );
  }

  if (r.includes('security') || r.includes('reviewer')) {
    return (
      `You just reviewed ${contextDescription} for security. ` +
      'What vulnerability patterns, auth issues, or security lessons should you remember? ' +
      'Think like a security reviewer tracking threat patterns.'
    );
  }

  // Generic fallback
  return (
    `You just participated in ${contextDescription}. ` +
    'What lessons, patterns, or observations should you remember for future interactions?'
  );
}

/**
 * Build a role-flavored reflection prompt for a persona given an interaction context.
 * The LLM is instructed to respond with 1-5 categorized bullet points.
 */
export function buildReflectionPrompt(persona: IAgentPersona, context: IReflectionContext): string {
  const contextDescription = describeContext(context);
  const framing = roleFraming(persona.role, contextDescription);

  return (
    `You are ${persona.name}.\n\n` +
    `${framing}\n\n` +
    'Respond with 1-5 categorized bullet points. Each bullet MUST follow this format:\n' +
    '- [CATEGORY] lesson text (ref: path/to/file.ts#L42-L45)\n\n' +
    'Categories:\n' +
    '- PATTERN: recurring code pattern or convention discovered\n' +
    '- DECISION: architectural or design choice made and why\n' +
    '- OBSERVATION: something noticed that may need attention later\n' +
    '- HYPOTHESIS: untested theory about a potential issue\n' +
    '- TODO: concrete follow-up action needed\n\n' +
    'Examples of GOOD lessons:\n' +
    '- [PATTERN] Auth middleware validates JWT but skips expiry check on refresh tokens (ref: src/auth/middleware.ts#L23-L30)\n' +
    '- [DECISION] Chose event sourcing over simple logging for audit trail — compliance requires full replay (ref: src/events/store.ts#L5-L15)\n' +
    '- [OBSERVATION] The retry logic in queue-worker uses fixed 1s delay, no exponential backoff (ref: src/queue/worker.ts#L88-L95)\n\n' +
    'Examples of BAD lessons (too vague — never write these):\n' +
    '- Consider improving error handling\n' +
    '- The code could use better testing\n' +
    '- Security should be reviewed\n\n' +
    'If a file reference is unknown, omit the (ref: ...) part — but be as specific as possible about the location.\n' +
    'No preamble, no explanation outside the bullets.'
  );
}

/**
 * Build a compaction prompt asking the persona to condense their memory to the top lessons.
 * The LLM is instructed to respond with a compact markdown bullet list preserving category tags and refs.
 */
export function buildCompactionPrompt(persona: IAgentPersona, currentMemory: string): string {
  const maxBullets = Math.floor(COMPACTION_TARGET_LINES / 2);

  return (
    `You are ${persona.name}. Below is your accumulated memory log.\n\n` +
    `---\n${currentMemory}\n---\n\n` +
    `Condense this into your top lessons — at most ${String(maxBullets)} bullet points starting with "- ". ` +
    'Keep the most important, actionable insights. Drop redundant or low-value entries. ' +
    'Respond only with the bullet list, no headers, no preamble.\n\n' +
    'Rules for compaction:\n' +
    '- Keep all [CATEGORY] tags intact\n' +
    '- Preserve (ref: path#L42) references — these are the most valuable part\n' +
    '- Merge related lessons: if 3 bullets say similar things, combine into 1 rich bullet\n' +
    '- Drop entries that are vague or lack specifics\n' +
    '- Favor lessons that mention specific files, functions, or patterns'
  );
}

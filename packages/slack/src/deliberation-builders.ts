/**
 * Pure helper functions for building Slack messages and prompts used by the DeliberationEngine.
 * Extracted from deliberation.ts to separate message-construction concerns from orchestration logic.
 */

import { IAgentPersona, IDiscussionTrigger, getRepositories } from '@night-watch/core';
import { execFileSync } from 'node:child_process';
import { type ISlackMessage } from './client.js';
import { findCarlos } from './personas.js';

/** Maximum number of deliberation rounds per discussion. */
export const MAX_ROUNDS = 2;

/**
 * Generate the opening message text for a discussion
 */
export function buildOpeningMessage(trigger: IDiscussionTrigger): string {
  switch (trigger.type) {
    case 'pr_review': {
      const prRef = `#${trigger.ref}`;
      const prWithUrl = trigger.prUrl ? `${prRef} — ${trigger.prUrl}` : prRef;
      const openers = [
        `Opened ${prWithUrl}. Ready for eyes.`,
        `Just opened ${prWithUrl}. Anyone free to review?`,
        `${prWithUrl} is up. Tagging for review.`,
        `Opened ${prWithUrl}. Let me know if you spot anything.`,
      ];
      return openers[Math.floor(Math.random() * openers.length)];
    }
    case 'build_failure':
      return `Build broke on ${trigger.ref}. Looking into it.\n\n${trigger.context.slice(0, 500)}`;
    case 'prd_kickoff':
      return `Picking up ${trigger.ref}. Going to start carving out the implementation.`;
    case 'code_watch': {
      // Parse context fields to compose a natural message rather than dumping structured data.
      const locationMatch = trigger.context.match(/^Location: (.+)$/m);
      const signalMatch = trigger.context.match(/^Signal: (.+)$/m);
      const snippetMatch = trigger.context.match(/^Snippet: (.+)$/m);
      const location = locationMatch?.[1]?.trim() ?? '';
      const signal = signalMatch?.[1]?.trim() ?? '';
      const snippet = snippetMatch?.[1]?.trim() ?? '';

      if (location && signal) {
        const DETAIL_OPENERS = [
          `${location} — ${signal}.`,
          `Flagging ${location}: ${signal}.`,
          `Caught something in ${location}: ${signal}.`,
          `${location} pinged the scanner — ${signal}.`,
          `Noticed this in ${location}: ${signal}.`,
        ];
        const hash = trigger.ref.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const opener = DETAIL_OPENERS[hash % DETAIL_OPENERS.length];
        return snippet ? `${opener}\n\`\`\`\n${snippet}\n\`\`\`` : opener;
      }

      return trigger.context.slice(0, 600);
    }
    case 'issue_review': {
      const openers = [
        `Taking a look at ${trigger.ref} — what do we think?`,
        `Reviewing ${trigger.ref}. Sharing notes in a sec.`,
        `Got eyes on ${trigger.ref}. Let's figure out if this is real.`,
        `${trigger.ref} came up — quick review?`,
      ];
      const hash = trigger.ref.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      return openers[hash % openers.length];
    }
    default:
      return trigger.context.slice(0, 500);
  }
}

/**
 * Parse the structured code_watch context string and derive a git-style issue title.
 */
export function buildIssueTitleFromTrigger(trigger: IDiscussionTrigger): string {
  const signalMatch = trigger.context.match(/^Signal: (.+)$/m);
  const locationMatch = trigger.context.match(/^Location: (.+)$/m);
  const signal = signalMatch?.[1] ?? 'code signal';
  const location = locationMatch?.[1] ?? 'unknown location';
  return `fix: ${signal} at ${location}`;
}

export function hasConcreteCodeContext(context: string): boolean {
  return (
    /```/.test(context) ||
    /(^|\s)(src|test|scripts|web)\/[^\s:]+\.[A-Za-z0-9]+(?::\d+)?/.test(context) ||
    /\bdiff --git\b/.test(context) ||
    /@@\s[-+]\d+/.test(context) ||
    /\b(function|class|const|let|if\s*\(|try\s*{|catch\s*\()/.test(context)
  );
}

/**
 * Build the contribution prompt for an agent's AI call.
 * This is what gets sent to the AI provider to generate the agent's message.
 */
export function buildContributionPrompt(
  persona: IAgentPersona,
  trigger: IDiscussionTrigger,
  threadHistory: string,
  round: number,
  roadmapContext?: string,
): string {
  const isFirstRound = round === 1;
  const isFinalRound = round >= MAX_ROUNDS;

  const roadmapSection = roadmapContext ? `\n## Roadmap Priorities\n${roadmapContext}\n` : '';

  return `You are ${persona.name}, ${persona.role}.
You're in a Slack thread with your teammates — Dev (implementer), Carlos (tech lead), Maya (security), and Priya (QA). This is a real conversation, not a report.

Trigger: ${trigger.type} — ${trigger.ref}
Round: ${round}/${MAX_ROUNDS}${isFinalRound ? ' (final round — wrap up)' : ''}

## Context
${trigger.context.slice(0, 2000)}
${roadmapSection}
## Thread So Far
${threadHistory || '(Thread just started)'}

## Step 1 — Decide whether to speak
Ask yourself honestly:
1. Does this topic actually touch my domain (${persona.role})?
2. Is there something concrete and NEW I can add that hasn't already been said?
3. Do I have real evidence from the context (a file path, diff hunk, log line, or symbol)?

If you answer no to ALL three → reply with exactly: SKIP
If at least one is yes, speak — but stick to what you actually know.

Silence is the right call when: the trigger is outside your expertise, teammates already covered it, or you'd just be echoing someone else. Do not post to fill space.

## Step 2 — If you do have something worth saying
Write a short Slack message — 1 to 2 sentences max, under ~180 chars when possible.
${isFirstRound ? '- First round: give your initial take from your angle. Be specific.' : '- Follow-up round: respond to what others said. Agree, push back, or add something new.'}
- React to one specific point already in the thread (use teammate names when available).
- When referencing code, use GitHub permalink format: \`path/to/file.ts#L42-L45\` followed by a short inline snippet. Example: "\`src/auth/middleware.ts#L23-L25\` — the token check skips expiry validation."
- Every code claim MUST include a file path reference. No vague "the auth module" — name the exact file and line range.
- Talk like a teammate, not an assistant. No pleasantries, no filler.
- Stay in your lane — only comment on your domain unless something crosses into it.
- Ground your feedback in the project roadmap when relevant. If what you're raising isn't on the roadmap, say so explicitly ("Not on the roadmap, but...").
- Prioritize roadmap-aligned work over tangential improvements.
- You can name-drop teammates when handing off ("Maya should look at the auth here").
- No markdown formatting. No bullet lists. No headings. Just a message.
- Emojis: use one only if it genuinely fits. Default to none.
- Never start with "Great question", "Of course", "I hope this helps", or similar.
- Never say "as an AI" or break character.
- Only reference PR numbers, issue numbers, or URLs that appear in the Context or Thread above. Never invent or guess links.
${isFinalRound ? '- Final round: be decisive. State your position clearly.' : ''}
${
  trigger.type === 'issue_review'
    ? `
Issue Review Guidance:
- Is this issue actually valid? Does the codebase have this problem, or is it already fixed?
- Is it worth tracking? Consider: Ready (prioritize now), Draft (valid but not urgent), or Close (invalid/duplicate/won't fix).
- Use query_codebase to verify code claims before making them.
- End your message with a clear lean toward READY, CLOSE, or DRAFT.

Examples of good verdicts:
- "The N+1 query in \`src/api/users.ts#L88-L92\` is real — each list call fires 50 sub-selects. READY."
- "Already fixed in PR #42, merged last week. The pagination was added at \`src/api/list.ts#L30\`. CLOSE."
- "Valid concern but need to profile first — could be acceptable for our current scale. DRAFT."`
    : ''
}

Write ONLY your message or SKIP. No name prefix, no labels.`;
}

export function formatThreadHistory(messages: ISlackMessage[]): string {
  return messages
    .map((message) => {
      const body = message.text.replace(/\s+/g, ' ').trim();
      if (!body) return '';
      const speaker = message.username?.trim() || 'Teammate';
      return `${speaker}: ${body}`;
    })
    .filter(Boolean)
    .join('\n');
}

export const HUMAN_DELAY_MIN_MS = 20_000; // Minimum pause between agent replies (20s)
export const HUMAN_DELAY_MAX_MS = 60_000; // Maximum pause between agent replies (60s)

export function discussionStartKey(trigger: IDiscussionTrigger): string {
  return `${trigger.projectPath}:${trigger.type}:${trigger.ref}`;
}

/**
 * Return a random delay in the human-like range so replies don't arrive
 * in an obviously robotic cadence.
 */
export function humanDelay(): number {
  return HUMAN_DELAY_MIN_MS + Math.random() * (HUMAN_DELAY_MAX_MS - HUMAN_DELAY_MIN_MS);
}

/**
 * Resolve which Slack channel to use for a trigger.
 * All trigger types now route to the project's own channel.
 */
export function getChannelForProject(projectPath: string, channelIdOverride?: string): string {
  if (channelIdOverride) return channelIdOverride;
  const repos = getRepositories();
  const projects = repos.projectRegistry.getAll();
  const project = projects.find((p) => p.path === projectPath);
  return project?.slackChannelId ?? '';
}

export function loadPrDiffExcerpt(projectPath: string, ref: string): string {
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

export function countThreadReplies(messages: ISlackMessage[]): number {
  return Math.max(0, messages.length - 1);
}

/**
 * Vary sentence length naturally — some messages are punchy (1-2), others fuller (3).
 */
export function pickMaxSentences(): number {
  const roll = Math.random();
  if (roll < 0.35) return 1;
  if (roll < 0.6) return 2;
  return 3;
}

export function chooseRoundContributors(
  personas: IAgentPersona[],
  maxCount: number,
): IAgentPersona[] {
  if (maxCount <= 0) return [];
  const lead = findCarlos(personas);
  if (!lead) return personas.slice(0, maxCount);
  const nonLead = personas.filter((persona) => persona.id !== lead.id);
  const candidates = nonLead.length >= 2 ? nonLead : personas;
  return candidates.slice(0, maxCount);
}

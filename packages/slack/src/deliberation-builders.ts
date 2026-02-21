/**
 * Pure helper functions for building Slack messages and prompts used by the DeliberationEngine.
 * Extracted from deliberation.ts to separate message-construction concerns from orchestration logic.
 */

import { IAgentPersona, IDiscussionTrigger } from '@night-watch/core';
import { type ISlackMessage } from './client.js';

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
Write a short Slack message — 1 to 2 sentences max, under ~180 chars when possible.
${isFirstRound ? '- First round: give your initial take from your angle. Be specific.' : '- Follow-up round: respond to what others said. Agree, push back, or add something new.'}
- React to one specific point already in the thread (use teammate names when available).
- Never repeat a point that's already been made in similar words.
- Back your take with one concrete artifact from context (file path, symbol, diff hunk, or log line).
- If context lacks concrete code evidence, ask for the exact file/diff and use SKIP.
- If you have no new signal to add, reply with exactly: SKIP
- Talk like a teammate, not an assistant. No pleasantries, no filler.
- Stay in your lane — only comment on your domain unless something crosses into it.
- You can name-drop teammates when handing off ("Maya should look at the auth here").
- If nothing concerns you, use SKIP instead of posting filler.
- If you have a concern, name it specifically and suggest a direction.
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
- End your message with a clear lean toward READY, CLOSE, or DRAFT.`
    : ''
}

Write ONLY your message. No name prefix, no labels.`;
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

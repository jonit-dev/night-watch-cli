/**
 * Soul compiler for Night Watch agent personas.
 * Compiles SOUL + STYLE + SKILL JSON into a system prompt for the AI provider.
 */

import { IAgentPersona } from '@/shared/types.js';

const AIISH_WORDS_TO_AVOID = [
  'additionally',
  'moreover',
  'pivotal',
  'crucial',
  'landscape',
  'underscore',
  'testament',
  'showcase',
  'vibrant',
];

const CANNED_CHATBOT_PHRASES = [
  'great question',
  'of course',
  'certainly',
  "you're absolutely right",
  'i hope this helps',
  "let me know if you'd like",
];

/**
 * Compile an agent persona's soul layers into a system prompt string.
 * If systemPromptOverride is set, returns it directly.
 * If memory is provided and non-empty, appends a ## Memory section at the end.
 */
export function compileSoul(persona: IAgentPersona, memory?: string): string {
  if (persona.systemPromptOverride) {
    return persona.systemPromptOverride;
  }

  const { soul, style, skill } = persona;
  const lines: string[] = [];

  lines.push(`# ${persona.name} — ${persona.role}`);
  lines.push('');
  lines.push('## Who I Am');
  lines.push(soul.whoIAm || '');
  lines.push('');

  if (soul.worldview.length > 0) {
    lines.push('## Worldview');
    for (const belief of soul.worldview) {
      lines.push(`- ${belief}`);
    }
    lines.push('');
  }

  if (Object.keys(soul.opinions).length > 0) {
    lines.push('## Opinions');
    for (const [domain, takes] of Object.entries(soul.opinions)) {
      lines.push(`### ${domain}`);
      for (const take of takes) {
        lines.push(`- ${take}`);
      }
    }
    lines.push('');
  }

  if (soul.tensions.length > 0) {
    lines.push('## Tensions');
    for (const tension of soul.tensions) {
      lines.push(`- ${tension}`);
    }
    lines.push('');
  }

  if (soul.boundaries.length > 0) {
    lines.push('## Boundaries');
    for (const boundary of soul.boundaries) {
      lines.push(`- Won't: ${boundary}`);
    }
    lines.push('');
  }

  if (style.voicePrinciples || style.sentenceStructure || style.tone) {
    lines.push('## Voice & Style');
    if (style.voicePrinciples) {
      lines.push(`- Principles: ${style.voicePrinciples}`);
    }
    if (style.sentenceStructure) {
      lines.push(`- Rhythm: ${style.sentenceStructure}`);
    }
    if (style.tone) {
      lines.push(`- Tone: ${style.tone}`);
    }
    lines.push('');
  }

  if (style.rhetoricalMoves.length > 0) {
    lines.push('### Rhetorical Moves');
    for (const move of style.rhetoricalMoves) {
      lines.push(`- ${move}`);
    }
    lines.push('');
  }

  if (Object.keys(style.quickReactions).length > 0) {
    lines.push('### Quick Reactions');
    for (const [emotion, reaction] of Object.entries(style.quickReactions)) {
      lines.push(`- When ${emotion}: ${reaction}`);
    }
    lines.push('');
  }

  if (style.wordsUsed.length > 0) {
    lines.push(`### Words I Use: ${style.wordsUsed.join(', ')}`);
  }
  if (style.wordsAvoided.length > 0) {
    lines.push(`### Words I Never Use: ${style.wordsAvoided.join(', ')}`);
  }

  const emojiList = style.emojiUsage?.favorites?.join(' ') ?? '';
  lines.push(`### Emoji Use: ${style.emojiUsage.frequency}${emojiList ? ` (${emojiList})` : ''}`);
  if (style.emojiUsage.contextRules) {
    lines.push(`### Emoji Context: ${style.emojiUsage.contextRules}`);
  }
  lines.push('');

  if (style.antiPatterns.length > 0) {
    lines.push('### Anti-Patterns (Never Sound Like This)');
    for (const ap of style.antiPatterns) {
      lines.push(`- ❌ "${ap.example}" — ${ap.why}`);
    }
    lines.push('');
  }

  if (style.goodExamples.length > 0) {
    lines.push('### Examples of My Voice');
    for (const ex of style.goodExamples) {
      lines.push(`- ✅ "${ex}"`);
    }
    lines.push('');
  }

  lines.push('## How to Sound Human');
  lines.push('- You are a teammate in Slack. Write like one — short, direct, no performance.');
  lines.push(`- Never use these chatbot tells: ${CANNED_CHATBOT_PHRASES.join(', ')}.`);
  lines.push(`- Avoid AI filler words: ${AIISH_WORDS_TO_AVOID.join(', ')}.`);
  lines.push('- No formulaic rhetoric ("not just X, but Y"), no triads, no hype.');
  lines.push('- Contractions are normal. Sentence fragments are fine. Vary your rhythm.');
  lines.push(
    '- Say concrete things. "The auth middleware is missing rate limiting" beats "we should consider security improvements."',
  );
  lines.push("- If you have nothing to add, say so in 3 words or fewer. Don't pad.");
  lines.push(
    '- When uncertain, name exactly what\'s unclear. Don\'t hedge with "perhaps" or "might consider."',
  );
  lines.push('- No markdown formatting in Slack messages — no headings, no bullets, no bold.');
  lines.push('');

  lines.push('## Operating Rules');
  lines.push(
    '- Never break character. Never say "as an AI", "I don\'t have opinions", or "I\'m happy to help."',
  );
  lines.push('- You have opinions. Use them. If your worldview says something, say it.');
  lines.push('- Keep messages to 1-2 sentences. Only go longer if someone asked you for detail.');
  lines.push(
    '- Emojis: use sparingly. One max per message, only when it genuinely fits. Default to none.',
  );
  lines.push('- You can tag teammates by name when their expertise is relevant.');
  if (emojiList) {
    lines.push(`- If you do use an emoji, prefer: ${emojiList}`);
  }

  if (skill.additionalInstructions?.length > 0) {
    for (const instruction of skill.additionalInstructions) {
      lines.push(`- ${instruction}`);
    }
  }

  if (Object.keys(skill.modes ?? {}).length > 0) {
    lines.push('');
    lines.push('## Modes');
    for (const [mode, behavior] of Object.entries(skill.modes)) {
      lines.push(`- **${mode}**: ${behavior}`);
    }
  }

  if (memory && memory.trim()) {
    lines.push('');
    lines.push('## Memory');
    lines.push(memory.trim());
  }

  return lines.join('\n');
}

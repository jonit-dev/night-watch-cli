/**
 * Soul compiler for Night Watch agent personas.
 * Compiles SOUL + STYLE + SKILL JSON into a system prompt for the AI provider.
 */

import { IAgentPersona } from "../../shared/types.js";

/**
 * Compile an agent persona's soul layers into a system prompt string.
 * If systemPromptOverride is set, returns it directly.
 */
export function compileSoul(persona: IAgentPersona): string {
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

  if (style.voicePrinciples) {
    lines.push('## Voice & Style');
    lines.push(style.voicePrinciples);
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

  lines.push('## Operating Rules');
  lines.push('- Never break character. No "as an AI" or "I don\'t have opinions."');
  lines.push('- If unsure, reason from worldview. Flag uncertainty in-character.');

  const emojiList = style.emojiUsage?.favorites?.join(' ') ?? '';
  lines.push(`- Keep messages to 2-3 sentences. Use emojis naturally: ${emojiList}`);

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

  return lines.join('\n');
}

/**
 * Text humanization for Slack replies.
 * Makes AI-generated responses feel more natural and conversational.
 */

import { normalizeText } from './utils.js';

export const MAX_HUMANIZED_SENTENCES = Infinity;
export const MAX_HUMANIZED_CHARS = Infinity;

export interface IHumanizeSlackReplyOptions {
  allowEmoji?: boolean;
  allowNonFacialEmoji?: boolean;
  maxSentences?: number;
  maxChars?: number;
}

// Only strip if followed by generic continuation (comma + filler), not substantive content.
const CANNED_PHRASE_PREFIXES = [
  /^great question[,.! ]+(?=(?:i|we|let|the|this|here|so)\b)/i,
  /^of course[,.! ]+(?=(?:i|we|let|the|this|here|so)\b)/i,
  /^certainly[,.! ]+(?=(?:i|we|let|the|this|here|so)\b)/i,
  // eslint-disable-next-line sonarjs/duplicates-in-character-class
  /^you['']re absolutely right[,.! ]+/i,
  /^i hope this helps[,.! ]*/i,
];

/**
 * Check if the message is a SKIP sentinel.
 */
export function isSkipMessage(text: string): boolean {
  return text.trim().toUpperCase() === 'SKIP';
}

/**
 * Remove repeated duplicate sentences from text.
 */
export function dedupeRepeatedSentences(text: string): string {
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return text;

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const normalized = normalizeText(part);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(part);
  }
  return unique.join(' ');
}

/**
 * Limit emoji count in text, keeping only the first N emojis.
 */
export function limitEmojiCount(text: string, maxEmojis: number): string {
  let seen = 0;
  return text.replace(/\p{Extended_Pictographic}/gu, (m) => {
    seen += 1;
    return seen <= maxEmojis ? m : '';
  });
}

/**
 * Check if a character is a facial emoji (smileys, expressions).
 */
export function isFacialEmoji(char: string): boolean {
  return /[\u{1F600}-\u{1F64F}\u{1F910}-\u{1F92F}\u{1F970}-\u{1F97A}]/u.test(char);
}

/**
 * Apply emoji policy: strip all, keep only facial, or allow all.
 */
export function applyEmojiPolicy(
  text: string,
  allowEmoji: boolean,
  allowNonFacialEmoji: boolean,
): string {
  if (!allowEmoji) {
    return text.replace(/\p{Extended_Pictographic}/gu, '');
  }

  const emojis = Array.from(text.matchAll(/\p{Extended_Pictographic}/gu)).map((m) => m[0]);
  if (emojis.length === 0) return text;

  const chosenFacial = emojis.find((e) => isFacialEmoji(e));
  const chosen = chosenFacial ?? (allowNonFacialEmoji ? emojis[0] : null);
  if (!chosen) {
    return text.replace(/\p{Extended_Pictographic}/gu, '');
  }

  let kept = false;
  return text.replace(/\p{Extended_Pictographic}/gu, (e) => {
    if (!kept && e === chosen) {
      kept = true;
      return e;
    }
    return '';
  });
}

/**
 * Trim text to a maximum number of sentences.
 */
export function trimToSentences(text: string, maxSentences: number): string {
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= maxSentences) return text.trim();
  return parts.slice(0, maxSentences).join(' ').trim();
}

/**
 * Humanize a Slack reply from AI-generated text.
 * Removes bot-like patterns, limits length, and normalizes emoji usage.
 */
export function humanizeSlackReply(raw: string, options: IHumanizeSlackReplyOptions = {}): string {
  const {
    allowEmoji = true,
    allowNonFacialEmoji = true,
    maxSentences = MAX_HUMANIZED_SENTENCES,
    maxChars = MAX_HUMANIZED_CHARS,
  } = options;

  let text = raw.trim();
  if (!text) return text;
  if (isSkipMessage(text)) return 'SKIP';

  // Remove markdown formatting artifacts that look templated in chat.
  text = text
    .replace(/^#{1,6}\s+/gm, '')
    // eslint-disable-next-line sonarjs/slow-regex
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip common assistant-y openers.
  for (const pattern of CANNED_PHRASE_PREFIXES) {
    text = text.replace(pattern, '').trim();
  }

  text = dedupeRepeatedSentences(text);
  text = applyEmojiPolicy(text, allowEmoji, allowNonFacialEmoji);
  text = limitEmojiCount(text, 1);
  text = trimToSentences(text, maxSentences);

  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars - 3).trimEnd()}...`;
  }

  return text;
}

export const MAX_MEMORY_LINES = 150;
export const COMPACTION_TARGET_LINES = 50;
export const MEMORY_CHAR_BUDGET = 8000; // ~2000 tokens
export const NIGHT_WATCH_DIR = '.night-watch';

/**
 * System prompt used when asking a persona to compact their own memory.
 * Keep it minimal — the full instruction lives in buildCompactionPrompt().
 */
export const COMPACTION_SYSTEM_PROMPT =
  'You are a memory compaction assistant. Respond only with bullet points, no preamble.';

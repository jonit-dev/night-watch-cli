export const MAX_MEMORY_LINES = 150;
export const COMPACTION_TARGET_LINES = 60;
export const MEMORY_CHAR_BUDGET = 8000; // ~2000 tokens
export const CORE_CHAR_BUDGET = 4000;
export const WORKING_CHAR_BUDGET = 8000;
export const NIGHT_WATCH_DIR = '.night-watch';

/**
 * System prompt used when asking a persona to compact their working memory.
 * Keep it minimal — the full instruction lives in buildCompactionPrompt().
 */
export const COMPACTION_SYSTEM_PROMPT = `You are a memory compaction assistant. Your job is to condense working memory while preserving actionable insights.
Rules:
- Preserve lessons with specific file references (path#L42-L45)
- Merge related lessons into single, richer bullets
- Keep category tags ([OBSERVATION], [HYPOTHESIS], [TODO]) intact
- Drop vague entries that lack specifics
- Respond only with categorized bullet points, no preamble.`;

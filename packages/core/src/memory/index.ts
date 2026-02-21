export { MemoryService } from './memory-service.js';
export {
  COMPACTION_SYSTEM_PROMPT,
  COMPACTION_TARGET_LINES,
  CORE_CHAR_BUDGET,
  MAX_MEMORY_LINES,
  MEMORY_CHAR_BUDGET,
  NIGHT_WATCH_DIR,
  WORKING_CHAR_BUDGET,
} from './memory-constants.js';
export { buildCompactionPrompt, buildReflectionPrompt } from './reflection-prompts.js';
export { CORE_CATEGORIES, WORKING_CATEGORIES } from './memory-types.js';
export type { IMemoryTier, MemoryCategory } from './memory-types.js';

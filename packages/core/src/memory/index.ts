export { MemoryService } from './memory-service.js';
export {
  COMPACTION_SYSTEM_PROMPT,
  COMPACTION_TARGET_LINES,
  MAX_MEMORY_LINES,
  MEMORY_CHAR_BUDGET,
  NIGHT_WATCH_DIR,
} from './memory-constants.js';
export { buildCompactionPrompt, buildReflectionPrompt } from './reflection-prompts.js';

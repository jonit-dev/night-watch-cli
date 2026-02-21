export type MemoryCategory = 'PATTERN' | 'DECISION' | 'ARCHITECTURE' | 'OBSERVATION' | 'HYPOTHESIS' | 'TODO';
export const CORE_CATEGORIES: MemoryCategory[] = ['PATTERN', 'DECISION', 'ARCHITECTURE'];
export const WORKING_CATEGORIES: MemoryCategory[] = ['OBSERVATION', 'HYPOTHESIS', 'TODO'];

export interface IMemoryTier {
  core: string;    // from core.md
  working: string; // from working.md
}

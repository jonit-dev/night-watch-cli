/**
 * Shared helpers for server route modules.
 */

import { IAgentPersona } from '../../shared/types.js';
import { createBoardProvider } from '../board/factory.js';
import { INightWatchConfig } from '../types.js';

// ==================== Validation ====================

/**
 * Validate PRD name to prevent path traversal.
 */
export function validatePrdName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+(\.md)?$/.test(name) && !name.includes('..');
}

/**
 * Mask persona model env var values before returning API payloads.
 */
export function maskPersonaSecrets(persona: IAgentPersona): IAgentPersona {
  const modelConfig = persona.modelConfig;
  const envVars = modelConfig?.envVars;
  if (!modelConfig || !envVars) return persona;

  return {
    ...persona,
    modelConfig: {
      ...modelConfig,
      envVars: Object.fromEntries(
        Object.keys(envVars).map((key) => [key, '***']),
      ),
    },
  };
}

// ==================== Board Cache ====================

interface IBoardCache {
  data: unknown;
  timestamp: number;
}

const BOARD_CACHE_TTL_MS = 60_000; // 60 seconds
const boardCacheMap = new Map<string, IBoardCache>();

export function getCachedBoardData(projectDir: string): unknown | null {
  const entry = boardCacheMap.get(projectDir);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > BOARD_CACHE_TTL_MS) {
    boardCacheMap.delete(projectDir);
    return null;
  }
  return entry.data;
}

export function setCachedBoardData(projectDir: string, data: unknown): void {
  boardCacheMap.set(projectDir, { data, timestamp: Date.now() });
}

export function invalidateBoardCache(projectDir: string): void {
  boardCacheMap.delete(projectDir);
}

// ==================== Board Provider ====================

export function getBoardProvider(
  config: INightWatchConfig,
  projectDir: string,
) {
  if (!config.boardProvider?.enabled || !config.boardProvider?.projectNumber) {
    return null;
  }
  return createBoardProvider(config.boardProvider, projectDir);
}

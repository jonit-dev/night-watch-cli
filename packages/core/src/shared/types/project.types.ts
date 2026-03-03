/**
 * Project-related type definitions for Night Watch CLI.
 */

import type { IArticleStylePreferences } from './article.types.js';

// ==================== Project Content Preferences ====================

/**
 * Content preferences stored at the project level.
 * These serve as defaults for new campaigns created under this project.
 * Extends IArticleStylePreferences to inherit all style preference fields.
 */
export type IProjectContentPreferences = IArticleStylePreferences;

/**
 * Project record type with content preferences.
 */
export interface IProject {
  id: string;
  name: string;
  /** JSON-stored content preferences that serve as campaign defaults */
  content_preferences: IProjectContentPreferences | null;
  created_at: number;
  updated_at: number;
}
